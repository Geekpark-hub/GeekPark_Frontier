/**
 * 按飞书「会员档案」表同步 joinedAt / expiresAt（按姓名匹配普通会员）
 * 用法：node scripts/sync-member-dates-from-sheet.js [path/to/member-sheet.json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../src/prisma.js';
import { allocateInviteCode } from '../src/utils/inviteCode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREATE_MISSING =
  process.argv.includes('--create') ||
  process.env.SYNC_CREATE === '1' ||
  process.env.SYNC_CREATE === 'true';
const PERMANENT = new Date('2999-12-31T00:00:00+08:00');

function parseYmd(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/) || s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

/** 北京日历日 00:00+08 */
function ymdToDate({ y, mo, d }) {
  return new Date(Date.UTC(y, mo - 1, d) - 8 * 3600 * 1000);
}

function parsePeriodEnd(period) {
  const s = String(period || '').trim();
  if (!s) return { end: null, note: 'empty' };
  const parts = s.split(/\s*[-–—]\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) {
    const only = parseYmd(parts[0] || s);
    return { end: only ? ymdToDate(only) : null, note: only ? 'single' : 'unparsed' };
  }
  const start = parseYmd(parts[0]);
  let end = parseYmd(parts[parts.length - 1]);
  if (!end) return { end: null, note: 'unparsed' };
  if (start) {
    const startT = Date.UTC(start.y, start.mo - 1, start.d);
    let endT = Date.UTC(end.y, end.mo - 1, end.d);
    if (endT < startT) {
      // 常见笔误：结束年少写一年，或 2017 写成了该写 2027
      const tryNext = { ...end, y: start.y + 1 };
      const tryNextT = Date.UTC(tryNext.y, tryNext.mo - 1, tryNext.d);
      if (tryNextT >= startT) {
        end = tryNext;
        return { end: ymdToDate(end), note: 'fixed+1y' };
      }
      const try10 = { ...end, y: end.y + 10 };
      const try10T = Date.UTC(try10.y, try10.mo - 1, try10.d);
      if (try10T >= startT) {
        end = try10;
        return { end: ymdToDate(end), note: 'fixed+10y' };
      }
    }
  }
  return { end: ymdToDate(end), note: 'ok' };
}

function dayISO(d) {
  if (!d) return null;
  // 展示用北京日期
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bj.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  const positional = process.argv
    .slice(2)
    .map((a) => String(a).replace(/\r/g, ''))
    .filter((a) => a && !a.startsWith('--'));
  const sheetPath = positional[0]
    ? path.resolve(positional[0])
    : path.resolve(__dirname, '../../deploy/member-sheet.json');
  const raw = fs.readFileSync(sheetPath, 'utf8').replace(/^\uFEFF/, '');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('sheet json must be array');

  const members = await prisma.member.findMany({
    where: { isAdmin: false, isSuperAdmin: false },
    select: { id: true, name: true, company: true, joinedAt: true, expiresAt: true },
  });
  const byName = new Map();
  for (const m of members) {
    const key = String(m.name || '').trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(m);
  }

  const report = {
    updated: 0,
    created: 0,
    skipped: 0,
    missing: [],
    ambiguous: [],
    details: [],
  };

  for (const row of rows) {
    const name = String(row.name || '').trim();
    if (!name) continue;
    const list = byName.get(name) || [];
    const { end, note } = parsePeriodEnd(row.period);
    let joinedAt = null;
    if (row.joinedAt) {
      const joined = new Date(`${String(row.joinedAt).slice(0, 10)}T00:00:00+08:00`);
      if (!Number.isNaN(joined.getTime())) joinedAt = joined;
    }

    if (!list.length) {
      if (!CREATE_MISSING) {
        report.missing.push(name);
        continue;
      }
      const inviteCode = await allocateInviteCode(name);
      const created = await prisma.member.create({
        data: {
          name,
          company: String(row.company || '').trim(),
          title: String(row.title || '').trim(),
          joinedAt,
          expiresAt: end || PERMANENT,
          status: 'active',
          inviteCode,
        },
      });
      report.created += 1;
      report.details.push({
        name,
        action: 'create',
        inviteCode,
        joinedAt: dayISO(created.joinedAt),
        expiresAt: dayISO(created.expiresAt),
        periodNote: note,
      });
      continue;
    }

    let target = list[0];
    if (list.length > 1) {
      const company = String(row.company || '').trim();
      const hit = list.find((m) => company && String(m.company || '').includes(company.slice(0, 4)));
      if (!hit) {
        report.ambiguous.push(name);
        continue;
      }
      target = hit;
    }

    const data = {};
    if (joinedAt) data.joinedAt = joinedAt;
    if (end) data.expiresAt = end;

    if (!Object.keys(data).length) {
      report.skipped += 1;
      continue;
    }

    await prisma.member.update({ where: { id: target.id }, data });
    report.updated += 1;
    report.details.push({
      name,
      action: 'update',
      joinedAt: dayISO(data.joinedAt) || dayISO(target.joinedAt),
      expiresAt: dayISO(data.expiresAt) || dayISO(target.expiresAt),
      periodNote: note,
    });
  }

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

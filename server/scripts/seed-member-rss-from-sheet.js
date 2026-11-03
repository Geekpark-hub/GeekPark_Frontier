/**
 * 按表格导入/更新会员：姓名+公司+职位+Google News RSS。
 * 新建时用占位手机号 1908xxxxxxx（后续可后台改成真实号）。
 * 用法: node scripts/seed-member-rss-from-sheet.js [jsonPath]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../src/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultJson = path.join(__dirname, '../data/rss-sheet-export.json');
const jsonPath = process.argv[2] || defaultJson;

const PERMANENT = new Date('2999-12-31T00:00:00.000Z');

function keywordsOf(row) {
  return [row.nameKeywords, row.companyKeywords]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('; ');
}

async function nextPlaceholderPhone(used) {
  for (let i = 1; i <= 999; i += 1) {
    const phone = `1908${String(i).padStart(7, '0')}`;
    if (used.has(phone)) continue;
    const hit = await prisma.member.findUnique({ where: { phone }, select: { id: true } });
    if (!hit) {
      used.add(phone);
      return phone;
    }
    used.add(phone);
  }
  throw new Error('占位手机号耗尽');
}

const raw = fs.readFileSync(jsonPath, 'utf8');
const data = JSON.parse(raw);
const members = Array.isArray(data.members) ? data.members : [];

const usedPhones = new Set(
  (await prisma.member.findMany({ select: { phone: true } })).map((m) => m.phone)
);

let created = 0;
let updated = 0;

for (const row of members) {
  const name = String(row.name || '').trim();
  if (!name) continue;

  const payload = {
    company: String(row.company || '').trim(),
    title: String(row.title || '').trim(),
    status: 'active',
    expiresAt: PERMANENT,
    rssKeywords: keywordsOf(row),
    googleNewsRssZh: String(row.googleNewsZh || '').trim(),
    googleNewsRssEn: String(row.googleNewsEn || '').trim(),
    isAdmin: false,
    isSuperAdmin: false,
  };

  const existing = await prisma.member.findFirst({
    where: { name, isAdmin: false, isSuperAdmin: false },
  });

  if (existing) {
    await prisma.member.update({
      where: { id: existing.id },
      data: payload,
    });
    updated += 1;
    console.log(`upd ${name} ${existing.phone}`);
  } else {
    const phone = await nextPlaceholderPhone(usedPhones);
    await prisma.member.create({
      data: { name, phone, ...payload },
    });
    created += 1;
    console.log(`new ${name} ${phone}`);
  }
}

console.log(JSON.stringify({ created, updated, total: members.length }, null, 2));
await prisma.$disconnect();

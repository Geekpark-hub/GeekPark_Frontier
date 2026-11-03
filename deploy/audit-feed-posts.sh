#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
node --input-type=module <<'JS'
import { prisma } from './src/prisma.js';

function bj(d) {
  if (!d) return null;
  return new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

const posts = await prisma.feedPost.findMany({
  include: {
    relatedMember: { select: { name: true, company: true } },
  },
  orderBy: [{ status: 'asc' }, { publishedAt: 'desc' }],
});

const now = Date.now();
const rows = posts.map((p) => {
  const pub = p.publishedAt ? new Date(p.publishedAt).getTime() : null;
  const created = p.createdAt ? new Date(p.createdAt).getTime() : null;
  const future = pub != null && pub > now + 86400000;
  const old = pub != null && now - pub > 40 * 86400000;
  const driftHours =
    pub != null && created != null ? Math.round((created - pub) / 3600000) : null;
  const content = String(p.content || '').replace(/\s+/g, ' ').trim();
  const title = String(p.title || '').replace(/\s+/g, ' ').trim();
  // 正文里常见日期痕迹
  const dateHints = [...content.matchAll(/(\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}|\d{1,2}月\d{1,2}日)/g)]
    .map((m) => m[1])
    .slice(0, 4);
  return {
    id: p.id,
    status: p.status,
    member: p.relatedMember ? `${p.relatedMember.name}/${p.relatedMember.company}` : '-',
    title: title.slice(0, 60),
    publishedAt: bj(p.publishedAt),
    createdAt: bj(p.createdAt),
    driftHours,
    flags: [
      future ? 'FUTURE' : null,
      old ? 'OLD>40d' : null,
      !p.sourceUrl ? 'NO_URL' : null,
      content.length < 40 ? 'THIN' : null,
    ].filter(Boolean),
    dateHints,
    sourceUrl: (p.sourceUrl || '').slice(0, 120),
    contentPreview: content.slice(0, 120),
  };
});

const published = rows.filter((r) => r.status === 'published');
const pending = rows.filter((r) => r.status === 'pending');
const flagged = rows.filter((r) => r.flags.length);

console.log(JSON.stringify({
  summary: {
    total: rows.length,
    published: published.length,
    pending: pending.length,
    draft: rows.filter((r) => r.status === 'draft').length,
    flagged: flagged.length,
    future: rows.filter((r) => r.flags.includes('FUTURE')).length,
    old: rows.filter((r) => r.flags.includes('OLD>40d')).length,
  },
  published,
  pending,
}, null, 2));

await prisma.$disconnect();
JS
REMOTE

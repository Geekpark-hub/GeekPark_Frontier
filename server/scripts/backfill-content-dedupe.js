/**
 * 为历史 FeedPost 回填 contentDedupeKey（按标题+正文指纹）。
 * 用法: node scripts/backfill-content-dedupe.js
 */
import { prisma } from '../src/prisma.js';
import { contentDedupeKeyFrom } from '../src/jobs/aiFeed.js';

const rows = await prisma.feedPost.findMany({
  where: { OR: [{ contentDedupeKey: null }, { contentDedupeKey: '' }] },
  select: { id: true, title: true, content: true },
  orderBy: { createdAt: 'asc' },
});

let updated = 0;
let skipped = 0;
let conflict = 0;

for (const row of rows) {
  const key = contentDedupeKeyFrom({ title: row.title, content: row.content });
  if (!key) {
    skipped += 1;
    continue;
  }
  try {
    await prisma.feedPost.update({
      where: { id: row.id },
      data: { contentDedupeKey: key },
    });
    updated += 1;
  } catch (err) {
    if (err.code === 'P2002') {
      // 已有相同内容指纹：保留较早那条，本条跳过写字段
      conflict += 1;
    } else {
      throw err;
    }
  }
}

console.log(JSON.stringify({ total: rows.length, updated, skipped, conflict }, null, 2));
await prisma.$disconnect();

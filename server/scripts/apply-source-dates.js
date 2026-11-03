/**
 * 应用本机拉到的源站发布时间。
 * 用法: node scripts/apply-source-dates.js /path/to/source-dates.json
 */
import fs from 'fs';
import { prisma } from '../src/prisma.js';

const file = process.argv[2];
if (!file) {
  console.error('need source-dates.json');
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
let updated = 0;
let skipped = 0;
for (const row of rows) {
  if (!row.id || !row.newPublishedAt) {
    skipped += 1;
    continue;
  }
  await prisma.feedPost.update({
    where: { id: row.id },
    data: { publishedAt: new Date(row.newPublishedAt) },
  });
  updated += 1;
  console.log(`upd ${row.id} ${row.newPublishedAt}`);
}
console.log(JSON.stringify({ updated, skipped, total: rows.length }, null, 2));
await prisma.$disconnect();

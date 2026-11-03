/**
 * 按源站页面重新解析发布时间，回填 FeedPost.publishedAt。
 * 不看正文叙述日期，只采信 meta / JSON-LD / time / 文章信息区相对时间（如「6个月前」）。
 * 用法: node scripts/backfill-source-published-at.js
 */
import { prisma } from '../src/prisma.js';
import { fetchArticlePage, pickSourcePublishedAt } from '../src/services/pageFetch.js';

const posts = await prisma.feedPost.findMany({
  where: { sourceUrl: { not: '' } },
  select: { id: true, title: true, sourceUrl: true, publishedAt: true },
  orderBy: { createdAt: 'desc' },
});

let updated = 0;
let unchanged = 0;
let failed = 0;

for (const post of posts) {
  const page = await fetchArticlePage(post.sourceUrl, { timeoutMs: 12000 });
  const next = pickSourcePublishedAt(page.ok ? page.publishedAt : null);
  if (!next) {
    failed += 1;
    console.log(`miss ${post.id} ${post.title.slice(0, 36)}`);
    continue;
  }
  const prev = post.publishedAt ? new Date(post.publishedAt).getTime() : 0;
  if (Math.abs(prev - next.getTime()) < 60_000) {
    unchanged += 1;
    console.log(`same ${post.id}`);
    continue;
  }
  await prisma.feedPost.update({
    where: { id: post.id },
    data: { publishedAt: next },
  });
  updated += 1;
  console.log(
    `upd  ${post.id} ${new Date(prev).toISOString()} -> ${next.toISOString()} | ${post.title.slice(0, 40)}`
  );
}

console.log(JSON.stringify({ total: posts.length, updated, unchanged, failed }, null, 2));
await prisma.$disconnect();

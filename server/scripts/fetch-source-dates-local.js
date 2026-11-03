/**
 * 本机拉取源站发布时间（galaxy 出网常被拦），输出 JSON 供线上回填。
 * 用法:
 *   node scripts/fetch-source-dates-local.js posts.json > source-dates.json
 *   node scripts/fetch-source-dates-local.js < posts.json > source-dates.json
 *   DATABASE_URL=... node scripts/fetch-source-dates-local.js   # 读本地库
 */
import fs from 'fs';
import { fetchArticlePage, pickSourcePublishedAt } from '../src/services/pageFetch.js';

async function readPosts() {
  const fileArg = process.argv[2];
  if (fileArg) {
    return JSON.parse(fs.readFileSync(fileArg, 'utf8'));
  }
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (raw) return JSON.parse(raw);
  }
  const { prisma } = await import('../src/prisma.js');
  const posts = await prisma.feedPost.findMany({
    where: { sourceUrl: { not: '' } },
    select: { id: true, title: true, sourceUrl: true, publishedAt: true },
  });
  await prisma.$disconnect();
  return posts;
}

const posts = await readPosts();

const out = [];
for (const post of posts) {
  const page = await fetchArticlePage(post.sourceUrl, { timeoutMs: 15000 });
  const next = pickSourcePublishedAt(page.ok ? page.publishedAt : null);
  out.push({
    id: post.id,
    title: post.title,
    sourceUrl: post.sourceUrl,
    oldPublishedAt: post.publishedAt || null,
    newPublishedAt: next ? next.toISOString() : null,
    pageOk: Boolean(page.ok),
    reason: page.reason || null,
  });
  console.error(
    `${next ? 'ok' : 'miss'} ${post.id} ${(post.title || '').slice(0, 36)} -> ${next ? next.toISOString() : '-'}`
  );
}

process.stdout.write(JSON.stringify(out, null, 2));

import 'dotenv/config';
import { prisma } from '../src/prisma.js';
import { isBlockedSourceUrl, looksLikeSpamText } from '../src/services/urlQuality.js';

const posts = await prisma.feedPost.findMany({
  where: { sourceType: 'auto' },
  select: { id: true, title: true, sourceUrl: true, content: true, aiReason: true },
});

const badIds = posts
  .filter((p) => {
    if (!p.sourceUrl || isBlockedSourceUrl(p.sourceUrl)) return true;
    if ((p.aiReason || '').includes('mock：')) return true;
    if (looksLikeSpamText(p.title, p.content, p.sourceUrl, p.aiReason)) return true;
    if ((p.sourceUrl || '').includes('example.com')) return true;
    return false;
  })
  .map((p) => p.id);

if (!badIds.length) {
  console.log('nothing to clean');
} else {
  const result = await prisma.feedPost.deleteMany({ where: { id: { in: badIds } } });
  console.log('deleted bad auto posts:', result.count);
}

await prisma.$disconnect();

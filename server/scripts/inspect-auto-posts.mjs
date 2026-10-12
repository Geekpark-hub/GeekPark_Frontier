import 'dotenv/config';
import { prisma } from '../src/prisma.js';

const posts = await prisma.feedPost.findMany({
  where: { sourceType: 'auto' },
  orderBy: { createdAt: 'desc' },
  take: 15,
  include: { relatedMember: { select: { name: true, company: true } } },
});

for (const p of posts) {
  console.log('---');
  console.log(p.status, p.relatedMember?.name, '/', p.relatedMember?.company);
  console.log('title:', p.title);
  console.log('url:', p.sourceUrl);
  console.log('reason:', (p.aiReason || '').slice(0, 100));
}

await prisma.$disconnect();

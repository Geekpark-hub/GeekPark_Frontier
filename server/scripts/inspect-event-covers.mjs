import { prisma } from '../src/prisma.js';

const events = await prisma.event.findMany({
  select: { id: true, title: true, coverUrl: true },
  orderBy: { startAt: 'desc' },
});
console.log(JSON.stringify(events, null, 2));
await prisma.$disconnect();

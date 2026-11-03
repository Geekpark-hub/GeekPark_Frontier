import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const now = new Date();
const rows = await p.event.findMany({
  where: { title: { contains: '测试' } },
  orderBy: { startAt: 'desc' },
  take: 8,
  include: {
    registrations: {
      take: 5,
      select: { id: true, status: true, name: true, memberId: true },
    },
  },
});
for (const e of rows) {
  console.log(
    JSON.stringify({
      id: e.id,
      title: e.title,
      status: e.status,
      startAt: e.startAt,
      endAt: e.endAt,
      started: e.startAt <= now,
      ended: e.endAt < now || e.status === 'closed',
      canCancelLogic: e.startAt > now && e.endAt >= now && e.status !== 'closed',
      regs: e.registrations,
    })
  );
}
await p.$disconnect();

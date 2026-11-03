/**
 * 清理演示/Mock 业务数据，仅保留真实超管账号（默认 17611294568）。
 * 用法：
 *   DATABASE_URL=file:./data/prod.db node scripts/clean-mock-data.mjs
 *   KEEP_PHONE=17611294568 node scripts/clean-mock-data.mjs
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const KEEP_PHONE = String(process.env.KEEP_PHONE || '17611294568').trim();

async function main() {
  const keep = await prisma.member.findUnique({ where: { phone: KEEP_PHONE } });
  if (!keep) {
    throw new Error(`保留账号不存在: ${KEEP_PHONE}，中止清理以免误删全部管理员`);
  }

  console.log('keep admin:', keep.id, keep.name, keep.phone);

  // 业务表先清（有外键依赖）
  await prisma.vote.deleteMany();
  await prisma.pollOption.deleteMany();
  await prisma.poll.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.event.deleteMany();
  await prisma.request.deleteMany();
  await prisma.feedPost.deleteMany();
  if (prisma.activityEvent?.deleteMany) {
    await prisma.activityEvent.deleteMany();
  }
  if (prisma.jobLog?.deleteMany) {
    await prisma.jobLog.deleteMany();
  }

  const deletedMembers = await prisma.member.deleteMany({
    where: { phone: { not: KEEP_PHONE } },
  });

  // 确保保留账号仍是超管、无演示 openid 脏数据
  await prisma.member.update({
    where: { id: keep.id },
    data: {
      isAdmin: true,
      isSuperAdmin: true,
      status: 'active',
      name: keep.name || '管理员',
    },
  });

  const left = await prisma.member.count();
  console.log('deleted other members:', deletedMembers.count);
  console.log('members left:', left);
  console.log('cleared: votes/polls/events/registrations/requests/feed/activity');
  console.log('done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

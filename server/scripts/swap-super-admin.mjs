import 'dotenv/config';
import { prisma } from '../src/prisma.js';
import { ROOT_SUPER_ADMIN_PHONE } from '../src/constants.js';

const OLD_PHONE = '13800000000';

const oldAdmin = await prisma.member.findUnique({ where: { phone: OLD_PHONE } });
let root = await prisma.member.findUnique({ where: { phone: ROOT_SUPER_ADMIN_PHONE } });

if (!root) {
  root = await prisma.member.create({
    data: {
      name: '超级管理员',
      company: '前沿社',
      title: '超级管理员',
      phone: ROOT_SUPER_ADMIN_PHONE,
      status: 'active',
      isAdmin: true,
      isSuperAdmin: true,
      expiresAt: new Date('2099-12-31'),
    },
  });
  console.log('created root super admin', root.phone);
} else {
  root = await prisma.member.update({
    where: { id: root.id },
    data: {
      isAdmin: true,
      isSuperAdmin: true,
      status: 'active',
      expiresAt: new Date('2099-12-31'),
    },
  });
  console.log('updated root super admin', root.phone);
}

if (oldAdmin) {
  // 把旧超管产生的内容挂到新超管，避免删人失败
  await prisma.feedPost.updateMany({
    where: { authorId: oldAdmin.id },
    data: { authorId: root.id },
  });
  await prisma.feedPost.updateMany({
    where: { relatedMemberId: oldAdmin.id },
    data: { relatedMemberId: root.id },
  });
  await prisma.vote.deleteMany({ where: { memberId: oldAdmin.id } });
  await prisma.registration.deleteMany({ where: { memberId: oldAdmin.id } });
  await prisma.request.deleteMany({ where: { memberId: oldAdmin.id } });
  await prisma.member.delete({ where: { id: oldAdmin.id } });
  console.log('deleted old super admin', OLD_PHONE);
} else {
  console.log('old super admin already gone', OLD_PHONE);
}

const check = await prisma.member.findMany({
  where: { phone: { in: [OLD_PHONE, ROOT_SUPER_ADMIN_PHONE] } },
  select: { phone: true, name: true, isSuperAdmin: true },
});
console.log('members now', check);

await prisma.$disconnect();

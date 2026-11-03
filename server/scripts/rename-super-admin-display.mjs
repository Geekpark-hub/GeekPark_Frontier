import 'dotenv/config';
import { prisma } from '../src/prisma.js';

const members = await prisma.member.updateMany({
  where: { OR: [{ name: '超级管理员' }, { title: '超级管理员' }] },
  data: { name: '管理员', title: '管理员' },
});
const regs = await prisma.registration.updateMany({
  where: { name: '超级管理员' },
  data: { name: '管理员' },
});
const root = await prisma.member.findFirst({
  where: { isSuperAdmin: true },
  select: { phone: true, name: true, title: true, inviteCode: true },
});
console.log(JSON.stringify({ members: members.count, regs: regs.count, root }, null, 2));
await prisma.$disconnect();

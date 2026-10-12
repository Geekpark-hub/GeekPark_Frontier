import 'dotenv/config';
import { prisma } from '../src/prisma.js';
import { ROOT_SUPER_ADMIN_PHONE } from '../src/constants.js';

const m = await prisma.member.update({
  where: { phone: ROOT_SUPER_ADMIN_PHONE },
  data: {
    name: '超级管理员',
    company: '前沿社',
    title: '超级管理员',
    isAdmin: true,
    isSuperAdmin: true,
    status: 'active',
  },
});
console.log(m.phone, m.name, m.isSuperAdmin);
const old = await prisma.member.findUnique({ where: { phone: '13800000000' } });
console.log('old 13800000000 exists:', !!old);
await prisma.$disconnect();

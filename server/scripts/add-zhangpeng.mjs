import 'dotenv/config';
import { prisma } from '../src/prisma.js';

const phone = '13800000003';
const existing = await prisma.member.findFirst({
  where: {
    OR: [{ phone }, { name: '张鹏', company: '极客公园' }],
  },
});

const data = {
  name: '张鹏',
  company: '极客公园',
  title: 'CEO',
  phone,
  status: 'active',
  isAdmin: false,
  isSuperAdmin: false,
  wechatMp: '极客公园',
};

const member = existing
  ? await prisma.member.update({ where: { id: existing.id }, data })
  : await prisma.member.create({ data });

console.log(existing ? 'updated' : 'created', {
  id: member.id,
  name: member.name,
  company: member.company,
  title: member.title,
  phone: member.phone,
});

await prisma.$disconnect();

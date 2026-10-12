/**
 * 确保开发调试用会员手机号存在（不清空现有数据）
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const demos = [
  {
    phone: '13800000001',
    name: '张三',
    company: '星河智能',
    title: '创始人 & CEO',
    status: 'active',
    expiresAt: new Date('2027-12-31'),
  },
  {
    phone: '13800000002',
    name: '李四',
    company: '深蓝机器人',
    title: '联合创始人',
    status: 'active',
    expiresAt: new Date('2027-12-31'),
  },
  {
    phone: '13900000000',
    name: '未开通占位',
    company: '',
    title: '',
    status: 'pending',
    expiresAt: null,
    // 仅用于「模拟未开通」：实际上 mock 用的是库里不存在的号；此条可选
    skip: true,
  },
];

async function main() {
  for (const item of demos) {
    if (item.skip) continue;
    const { phone, ...data } = item;
    const existing = await prisma.member.findUnique({ where: { phone } });
    if (existing) {
      await prisma.member.update({
        where: { phone },
        data: {
          status: 'active',
          name: existing.name || data.name,
          company: existing.company || data.company,
          title: existing.title || data.title,
          expiresAt: existing.expiresAt || data.expiresAt,
        },
      });
      console.log('updated', phone, existing.name);
    } else {
      await prisma.member.create({
        data: {
          phone,
          openid: null,
          ...data,
        },
      });
      console.log('created', phone, data.name);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

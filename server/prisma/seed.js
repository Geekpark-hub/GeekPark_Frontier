import pkg from '@prisma/client';

const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
  await prisma.vote.deleteMany();
  await prisma.pollOption.deleteMany();
  await prisma.poll.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.event.deleteMany();
  await prisma.request.deleteMany();
  await prisma.feedPost.deleteMany();
  await prisma.member.deleteMany();

  const admin = await prisma.member.create({
    data: {
      openid: null,
      name: '管理员',
      company: '前沿社',
      title: '管理员',
      phone: '17611294568',
      status: 'active',
      isAdmin: true,
      isSuperAdmin: true,
      expiresAt: new Date('2999-12-31'),
    },
  });

  await prisma.member.create({
    data: {
      openid: null,
      name: '运营管理员',
      company: '前沿社',
      title: '运营',
      phone: '13800000009',
      status: 'active',
      isAdmin: true,
      isSuperAdmin: false,
      adminMenus: JSON.stringify(['members', 'feed', 'polls', 'events', 'requests']),
      expiresAt: new Date('2027-12-31'),
    },
  });

  const memberA = await prisma.member.create({
    data: {
      openid: null,
      name: '张三',
      company: '星河智能',
      title: '创始人 & CEO',
      phone: '13800000001',
      status: 'active',
      expiresAt: new Date('2026-12-31'),
      linkedin: 'https://linkedin.com',
    },
  });

  const memberB = await prisma.member.create({
    data: {
      openid: null,
      name: '李四',
      company: '深蓝机器人',
      title: '联合创始人',
      phone: '13800000002',
      status: 'active',
      expiresAt: new Date('2026-10-31'),
    },
  });

  await prisma.member.create({
    data: {
      openid: null,
      name: '张鹏',
      company: '极客公园',
      title: 'CEO',
      phone: '13800000003',
      status: 'active',
      expiresAt: new Date('2027-12-31'),
      wechatMp: '极客公园',
    },
  });

  const now = new Date();
  const day = 24 * 60 * 60 * 1000;

  await prisma.feedPost.createMany({
    data: [
      {
        title: '星河智能发布新一代 AI Agent 产品',
        content:
          '星河智能今日正式发布面向企业场景的新一代 AI Agent 产品。该产品聚焦自动化工作流与多工具协作，主要面向技术团队与运营团队。此次发布包含开放 API 与企业私有化部署方案，值得关注其在实际业务中的落地能力。',
        publishedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        sourceUrl: 'https://example.com/news/xinghe-agent',
        status: 'published',
        sourceType: 'manual',
        authorId: admin.id,
      },
      {
        title: '深蓝机器人完成新一轮融资',
        content:
          '深蓝机器人宣布完成新一轮融资，资金将用于核心技术研发与海外市场拓展。公司目前聚焦工业与仓储场景的机器人解决方案。本轮融资进一步确认了市场对具身智能与机器人落地的持续关注。',
        publishedAt: new Date(now.getTime() - day),
        sourceUrl: 'https://example.com/news/shenlan-funding',
        status: 'published',
        sourceType: 'manual',
        authorId: admin.id,
      },
      {
        title: '张三接受行业播客访谈，谈 AI 创业',
        content:
          '星河智能创始人张三近日接受公开播客访谈，分享了从研究到产品化的路径，以及团队在 Agent 方向上的长期判断。访谈内容涵盖技术选型、客户验证与组织建设，适合关注 AI 创业的会员参考。',
        publishedAt: new Date(now.getTime() - 2 * day),
        sourceUrl: 'https://example.com/podcast/zhangsan',
        status: 'published',
        sourceType: 'manual',
        authorId: admin.id,
      },
    ],
  });

  await prisma.poll.create({
    data: {
      title: '是否邀请新嘉宾参加下季度闭门分享？',
      description: '请结合嘉宾背景与社群匹配度投票，结果将作为运营决策参考。',
      multiSelect: false,
      startAt: new Date(now.getTime() - day),
      endAt: new Date(now.getTime() + 7 * day),
      status: 'published',
      showVoters: false,
      options: {
        create: [
          { text: '同意', sort: 0 },
          { text: '不同意', sort: 1 },
          { text: '暂缓', sort: 2 },
        ],
      },
    },
  });

  await prisma.event.create({
    data: {
      title: '前沿社 · 旧金山 Tech Week 会员晚餐',
      coverUrl: '',
      description: '面向在旧金山出差的会员，组织小型晚餐交流，聚焦 AI Agent 与 Robotics。',
      location: 'San Francisco',
      agenda: '18:30 签到\n19:00 开场\n19:20 自由交流\n21:00 结束',
      guests: '特邀嘉宾：当地投资人与创业者',
      startAt: new Date(now.getTime() + 14 * day),
      endAt: new Date(now.getTime() + 14 * day + 3 * 60 * 60 * 1000),
      registerDeadline: new Date(now.getTime() + 10 * day),
      status: 'published',
    },
  });

  await prisma.event.create({
    data: {
      title: '前沿社 · 北京季度会员沙龙',
      description: '回顾季度动态，分享会员近期进展。',
      location: 'Beijing',
      agenda: '主题分享 + 圆桌讨论',
      guests: '',
      startAt: new Date(now.getTime() - 20 * day),
      endAt: new Date(now.getTime() - 20 * day + 2 * 60 * 60 * 1000),
      registerDeadline: new Date(now.getTime() - 22 * day),
      status: 'closed',
    },
  });

  await prisma.request.create({
    data: {
      memberId: memberA.id,
      content: '10 月将在旧金山参加 Tech Week，希望认识当地 AI Agent 和 Robotics 方向的创业者。',
      startAt: new Date('2026-10-03'),
      endAt: new Date('2026-10-07'),
      location: 'San Francisco',
      connectWith: 'AI Founder, Robotics Founder',
      status: 'processing',
      adminNote: '已初步筛选 3 位可能匹配的会员',
    },
  });

  console.log('Seed completed.');
  console.log('Login phones:');
  console.log('  super admin : 17611294568');
  console.log('  ops admin   : 13800000009');
  console.log('  member      : 13800000001 / 13800000002');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

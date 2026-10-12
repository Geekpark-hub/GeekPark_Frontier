/**
 * 向 Feed 追加 10 条模拟已发布动态（不清理现有数据）
 * 用法：node scripts/seed-demo-feed.mjs
 */
import { prisma } from '../src/prisma.js';

const day = 24 * 60 * 60 * 1000;
const now = Date.now();

const samples = [
  {
    title: '极客公园完成新一轮内容产品升级，强化科技深度报道',
    content:
      '极客公园近期对内容产品矩阵进行升级，强化科技深度报道与产业访谈能力。团队表示将继续服务创业者与科技从业者，提供更高质量的信息与连接。前沿社会员可关注后续相关活动与公开分享。',
    daysAgo: 0.3,
  },
  {
    title: '张鹏谈 AI 时代的创业者学习方式：社群比课程更重要',
    content:
      '在近期公开分享中，张鹏谈到创业者在 AI 时代的学习路径。他认为优秀创业者需要与同水平的科学家、企业家互相刷新认知，而不是被动接受总结后的理论。这与前沿社一直强调的学习机制高度一致。',
    daysAgo: 1,
  },
  {
    title: '深蓝机器人宣布新一轮融资，加码工业与仓储场景',
    content:
      '深蓝机器人宣布完成新一轮融资，资金将用于核心技术研发与海外市场拓展。公司目前聚焦工业与仓储场景的机器人解决方案，本轮融资进一步确认了市场对具身智能落地的持续关注。',
    daysAgo: 1.5,
  },
  {
    title: '星河智能发布 Agent 产品进展，进入更多企业试用',
    content:
      '星河智能近日公布 Agent 产品商业化进展，已在多个企业场景开展试点。创始人张三表示，团队将继续打磨任务编排与工具调用能力，并在客户验证中迭代产品边界。',
    daysAgo: 2,
  },
  {
    title: '前沿社会员沙龙回顾：具身智能的落地窗口正在打开',
    content:
      '上一场北京会员沙龙围绕具身智能展开讨论。多位会员分享了从实验室到场景验证的经验，也谈到供应链、安全与组织能力等现实约束。完整纪要已同步至会员社群。',
    daysAgo: 3,
  },
  {
    title: '云帆科技与高校实验室达成合作，推进多模态感知研究',
    content:
      '云帆科技宣布与国内高校实验室建立联合研究合作，重点方向包括多模态感知与端侧推理优化。双方计划在未来一年内产出可验证的原型系统，并探索产业落地路径。',
    daysAgo: 4,
  },
  {
    title: '硅谷见闻：AI Infra 创业公司融资节奏有所放缓但仍分化',
    content:
      '据会员海外观察，AI Infra 赛道融资节奏整体放缓，但具备明确客户付费与成本优势的项目仍能获得关注。估值分化加剧，团队质量与真实收入成为更重要的筛选指标。',
    daysAgo: 5,
  },
  {
    title: '李四接受访谈：谈机器人公司如何做早期客户验证',
    content:
      '深蓝机器人联合创始人李四在公开访谈中分享了早期客户验证方法：先锁定高频刚需场景，用小规模部署验证 ROI，再扩展交付体系。她强调“场景选择比算法参数更决定生死”。',
    daysAgo: 6,
  },
  {
    title: '前沿社超频之旅开放意向征集，聚焦全球科技地标参访',
    content:
      '运营团队启动新一期超频之旅意向征集，计划覆盖海外科技企业、实验室与产业园区。会员可提交希望拜访的方向与时间窗口，便于统一协调行程与嘉宾对接。',
    daysAgo: 8,
  },
  {
    title: '行业周报：大模型应用从“能用”转向“好用且可控”',
    content:
      '本周行业动态显示，大模型应用正从演示能力转向稳定性、成本与权限控制。企业采购更关注可审计、可回滚与私有化部署选项。对创业团队而言，垂直场景的可靠性将成为下一阶段竞争重点。',
    daysAgo: 10,
  },
];

const admin = await prisma.member.findFirst({
  where: { OR: [{ isSuperAdmin: true }, { isAdmin: true }] },
  orderBy: { isSuperAdmin: 'desc' },
});

const created = await prisma.feedPost.createMany({
  data: samples.map((s, i) => ({
    title: s.title,
    content: s.content,
    publishedAt: new Date(now - s.daysAgo * day),
    sourceUrl: `https://example.com/demo/feed-${Date.now()}-${i}`,
    status: 'published',
    sourceType: 'manual',
    authorId: admin?.id || null,
    dedupeKey: `demo-feed-${Date.now()}-${i}`,
  })),
});

const total = await prisma.feedPost.count({ where: { status: 'published' } });
console.log(`已新增 ${created.count} 条模拟动态，当前已发布共 ${total} 条`);
await prisma.$disconnect();

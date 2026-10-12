import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAdmin, requireMenu, requireSuperAdmin } from '../middleware/auth.js';
import { getAiFeedRunState, startAiFeedAsync } from '../jobs/aiFeed.js';
import { runMaintenance } from '../jobs/maintenance.js';
import { getSearchStatus } from '../services/search.js';
import { getLlmStatus } from '../services/llm.js';
import { getNotifyStatus } from '../services/notify.js';
import { isRootSuperAdmin, ROOT_SUPER_ADMIN_PHONE } from '../constants.js';
import {
  hasMenuAccess,
  parseAdminMenus,
  resolveAdminMenus,
  serializeAdminMenus,
} from '../menus.js';
import {
  getAnalyticsOverview,
  getMemberActivityDetail,
  getMemberActivityRanks,
} from '../services/analytics.js';

const router = Router();
router.use(requireAdmin);

function deny(res, status, error) {
  return res.status(status).json({ error });
}

function staffTarget(memberOrBody) {
  return Boolean(memberOrBody?.isAdmin || memberOrBody?.isSuperAdmin);
}

// ---------- Members / Users ----------
router.get('/members', async (req, res) => {
  const role = String(req.query.role || '').trim(); // member | admin | ''
  // admin = 后台用户（不含超级管理员）
  const menuKey = role === 'admin' ? 'users' : 'members';
  if (role && !hasMenuAccess(req.member, menuKey)) {
    return deny(res, 403, '无此菜单权限');
  }
  if (!role && !hasMenuAccess(req.member, 'members') && !hasMenuAccess(req.member, 'users')) {
    return deny(res, 403, '无此菜单权限');
  }

  const where = {};
  if (role === 'member') {
    where.isAdmin = false;
    where.isSuperAdmin = false;
  } else if (role === 'admin') {
    where.isAdmin = true;
    where.isSuperAdmin = false;
  }
  const members = await prisma.member.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  const shaped = members.map((m) => ({
    ...m,
    adminMenus: resolveAdminMenus(m),
  }));
  res.json({
    members: shaped,
    me: {
      isSuperAdmin: req.member.isSuperAdmin,
      adminMenus: resolveAdminMenus(req.member),
    },
  });
});

router.post('/members', async (req, res) => {
  try {
    const creatingStaff = staffTarget(req.body);
    if (!hasMenuAccess(req.member, creatingStaff ? 'users' : 'members')) {
      return deny(res, 403, '无此菜单权限');
    }
    const data = pickMember(req.body, req.member);
    if (!data.name) return deny(res, 400, '姓名必填');
    if (!data.phone) return deny(res, 400, '手机号必填（会员以此验证身份）');
    if (!/^1\d{10}$/.test(data.phone)) return deny(res, 400, '手机号格式不正确');
    if ((data.isAdmin || data.isSuperAdmin) && !req.member.isSuperAdmin) {
      return deny(res, 403, '仅超级管理员可创建后台用户');
    }
    if (data.isAdmin && !data.isSuperAdmin) {
      const menus = parseAdminMenus(req.body.adminMenus);
      if (!menus.length) return deny(res, 400, '请至少勾选一个菜单权限');
      data.adminMenus = serializeAdminMenus(menus);
    }
    const member = await prisma.member.create({ data });
    res.json({ member: { ...member, adminMenus: resolveAdminMenus(member) } });
  } catch (err) {
    if (err.code === 'P2002') {
      return deny(res, 400, '手机号或微信绑定冲突');
    }
    if (err.status) return deny(res, err.status, err.message);
    throw err;
  }
});

router.put('/members/:id', async (req, res) => {
  try {
    const existing = await prisma.member.findUnique({ where: { id: req.params.id } });
    if (!existing) return deny(res, 404, '记录不存在');

    const editingStaff = staffTarget(existing) || staffTarget(req.body);
    if (!hasMenuAccess(req.member, editingStaff ? 'users' : 'members')) {
      return deny(res, 403, '无此菜单权限');
    }
    if (existing.isSuperAdmin) {
      return deny(res, 403, '超级管理员不在用户管理中维护');
    }

    const data = pickMember(req.body, req.member, existing);
    if (data.phone && !/^1\d{10}$/.test(data.phone)) {
      return deny(res, 400, '手机号格式不正确');
    }

    const member = await prisma.member.update({ where: { id: req.params.id }, data });
    res.json({ member: { ...member, adminMenus: resolveAdminMenus(member) } });
  } catch (err) {
    if (err.code === 'P2025') return deny(res, 404, '记录不存在');
    if (err.code === 'P2002') return deny(res, 400, '手机号或微信绑定冲突');
    if (err.status) return deny(res, err.status, err.message);
    throw err;
  }
});

router.delete('/members/:id', async (req, res) => {
  if (req.params.id === req.member.id) {
    return deny(res, 400, '不能删除自己');
  }
  const existing = await prisma.member.findUnique({ where: { id: req.params.id } });
  if (!existing) return deny(res, 404, '记录不存在');
  if (isRootSuperAdmin(existing) || existing.isSuperAdmin) {
    return deny(res, 400, '超级管理员不可删除');
  }
  const deletingStaff = staffTarget(existing);
  if (!hasMenuAccess(req.member, deletingStaff ? 'users' : 'members')) {
    return deny(res, 403, '无此菜单权限');
  }
  if (deletingStaff && !req.member.isSuperAdmin) {
    return deny(res, 403, '仅超级管理员可删除后台用户');
  }
  await prisma.member.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.post('/members/:id/unbind-wechat', async (req, res) => {
  const existing = await prisma.member.findUnique({ where: { id: req.params.id } });
  if (!existing) return deny(res, 404, '记录不存在');
  if (existing.isSuperAdmin) {
    return deny(res, 403, '超级管理员请通过其他方式处理绑定');
  }
  const menuKey = staffTarget(existing) ? 'users' : 'members';
  if (!hasMenuAccess(req.member, menuKey)) {
    return deny(res, 403, '无此菜单权限');
  }
  if (!req.member.isSuperAdmin) {
    return deny(res, 403, '仅超级管理员可解绑微信');
  }
  const member = await prisma.member.update({
    where: { id: req.params.id },
    data: { openid: null },
  });
  res.json({ member });
});

function pickMember(body = {}, actor, existing = null) {
  const data = {};
  const fields = [
    'name', 'company', 'title', 'phone', 'status',
    'linkedin', 'wechatMp', 'xAccount', 'youtube', 'bilibili',
  ];
  for (const f of fields) {
    if (body[f] !== undefined) data[f] = typeof body[f] === 'string' ? body[f].trim() : body[f];
  }
  if (body.expiresAt !== undefined) {
    data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }

  if (existing && isRootSuperAdmin(existing)) {
    const err = new Error('超级管理员不在用户管理中维护');
    err.status = 403;
    throw err;
  }

  if (body.openid === null && actor.isSuperAdmin) {
    data.openid = null;
  }

  const wantsAdmin = body.isAdmin !== undefined;
  const wantsSuper = body.isSuperAdmin !== undefined;
  const wantsMenus = body.adminMenus !== undefined;

  if (wantsAdmin || wantsSuper || wantsMenus) {
    if (!actor.isSuperAdmin) {
      const err = new Error('仅超级管理员可设置后台权限');
      err.status = 403;
      throw err;
    }
    // 用户管理页不允许授予/保留超管
    if (wantsSuper && body.isSuperAdmin) {
      const err = new Error('不可通过用户管理设置超级管理员');
      err.status = 400;
      throw err;
    }
    if (wantsAdmin) data.isAdmin = Boolean(body.isAdmin);
    if (wantsSuper) data.isSuperAdmin = false;
    if (data.isAdmin === false) {
      data.isSuperAdmin = false;
      data.adminMenus = '[]';
    }
    if (wantsMenus || (wantsAdmin && body.isAdmin)) {
      const menus = parseAdminMenus(body.adminMenus);
      if (data.isAdmin !== false && (existing?.isAdmin || body.isAdmin)) {
        if (!menus.length) {
          const err = new Error('请至少勾选一个菜单权限');
          err.status = 400;
          throw err;
        }
        data.adminMenus = serializeAdminMenus(menus);
        data.isAdmin = true;
        data.isSuperAdmin = false;
      }
    }
  }

  return data;
}

// ---------- Feed ----------
router.use('/feed', requireMenu('feed'));
router.get('/feed', async (req, res) => {
  const { status, sourceType } = req.query;
  const where = {};
  if (status) where.status = status;
  if (sourceType) where.sourceType = sourceType;
  const posts = await prisma.feedPost.findMany({
    where,
    include: {
      relatedMember: { select: { id: true, name: true, company: true } },
    },
    orderBy: { publishedAt: 'desc' },
  });
  res.json({ posts });
});

router.post('/feed', async (req, res) => {
  const { title, content, publishedAt, sourceUrl = '', status = 'draft' } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: '标题和内容必填' });
  const post = await prisma.feedPost.create({
    data: {
      title,
      content,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      sourceUrl,
      status,
      sourceType: 'manual',
      authorId: req.member.id,
    },
  });
  res.json({ post });
});

router.put('/feed/:id', async (req, res) => {
  const { title, content, publishedAt, sourceUrl, status } = req.body || {};
  const data = {};
  if (title !== undefined) data.title = title;
  if (content !== undefined) data.content = content;
  if (sourceUrl !== undefined) data.sourceUrl = sourceUrl;
  if (status !== undefined) data.status = status;
  if (publishedAt !== undefined) data.publishedAt = new Date(publishedAt);
  const post = await prisma.feedPost.update({ where: { id: req.params.id }, data });
  res.json({ post });
});

router.delete('/feed/:id', async (req, res) => {
  await prisma.feedPost.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------- AI / Jobs ----------
// 状态接口：有 feed 或 ai 权限即可（布局轮询）
router.get('/ai/status', (req, res, next) => {
  if (hasMenuAccess(req.member, 'ai') || hasMenuAccess(req.member, 'feed')) return next();
  return deny(res, 403, '无此菜单权限');
}, async (_req, res) => {
  const recent = await prisma.jobLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const pendingAuto = await prisma.feedPost.count({
    where: { status: 'pending', sourceType: 'auto' },
  });
  res.json({
    search: getSearchStatus(),
    llm: getLlmStatus(),
    notify: getNotifyStatus(),
    pendingAuto,
    currentRun: getAiFeedRunState(),
    recentJobs: recent,
  });
});

router.post('/ai/run-feed', requireMenu('ai'), async (req, res) => {
  try {
    const memberId = req.body?.memberId || null;
    const limitPerMember = Number(req.body?.limitPerMember || 2);
    const asyncMode = req.body?.async !== false; // 默认异步，避免前端 15s 超时
    if (!asyncMode) {
      const { runAiFeed } = await import('../jobs/aiFeed.js');
      const result = await runAiFeed({ memberId, limitPerMember });
      return res.json({ ok: true, async: false, result });
    }
    const started = startAiFeedAsync({ memberId, limitPerMember });
    res.json({
      ok: true,
      async: true,
      started: started.started,
      reason: started.reason || null,
      run: started.run,
      message: started.started
        ? '已在后台开始抓取，可离开页面；完成后请到待审核查看'
        : '已有抓取任务在进行中，请稍候',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'AI 抓取失败' });
  }
});

router.post('/jobs/maintenance', requireMenu('ai'), async (_req, res) => {
  try {
    const result = await runMaintenance();
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '维护任务失败' });
  }
});

router.get('/jobs/logs', requireMenu('ai'), async (req, res) => {
  const take = Math.min(Number(req.query.limit || 50), 200);
  const logs = await prisma.jobLog.findMany({
    orderBy: { createdAt: 'desc' },
    take,
  });
  res.json({ logs });
});

// ---------- Polls ----------
router.use('/polls', requireMenu('polls'));
router.get('/polls', async (req, res) => {
  const polls = await prisma.poll.findMany({
    include: {
      options: { orderBy: { sort: 'asc' } },
      _count: { select: { votes: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ polls });
});

router.post('/polls', async (req, res) => {
  const {
    title, description = '', multiSelect = false,
    startAt, endAt, status = 'draft', showVoters = false, options = [],
  } = req.body || {};
  if (!title || !startAt || !endAt) {
    return res.status(400).json({ error: '标题与时间必填' });
  }
  if (!Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: '至少两个选项' });
  }
  const poll = await prisma.poll.create({
    data: {
      title,
      description,
      multiSelect: Boolean(multiSelect),
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      status,
      showVoters: Boolean(showVoters),
      options: {
        create: options.map((text, i) => ({
          text: typeof text === 'string' ? text : text.text,
          sort: i,
        })),
      },
    },
    include: { options: true },
  });
  res.json({ poll });
});

router.put('/polls/:id', async (req, res) => {
  const {
    title, description, multiSelect, startAt, endAt, status, showVoters, options,
  } = req.body || {};

  const data = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (multiSelect !== undefined) data.multiSelect = Boolean(multiSelect);
  if (startAt !== undefined) data.startAt = new Date(startAt);
  if (endAt !== undefined) data.endAt = new Date(endAt);
  if (status !== undefined) data.status = status;
  if (showVoters !== undefined) data.showVoters = Boolean(showVoters);

  await prisma.poll.update({ where: { id: req.params.id }, data });

  if (Array.isArray(options)) {
    const existingVotes = await prisma.vote.count({ where: { pollId: req.params.id } });
    if (existingVotes === 0) {
      await prisma.pollOption.deleteMany({ where: { pollId: req.params.id } });
      await prisma.pollOption.createMany({
        data: options.map((text, i) => ({
          pollId: req.params.id,
          text: typeof text === 'string' ? text : text.text,
          sort: i,
        })),
      });
    }
  }

  const poll = await prisma.poll.findUnique({
    where: { id: req.params.id },
    include: { options: { orderBy: { sort: 'asc' } } },
  });
  res.json({ poll });
});

router.get('/polls/:id/results', async (req, res) => {
  const poll = await prisma.poll.findUnique({
    where: { id: req.params.id },
    include: {
      options: { orderBy: { sort: 'asc' } },
      votes: { include: { member: true, option: true } },
    },
  });
  if (!poll) return res.status(404).json({ error: '投票不存在' });

  const totalMembers = await prisma.member.count({ where: { status: 'active' } });
  const voterIds = new Set(poll.votes.map((v) => v.memberId));
  const results = {
    totalVotes: poll.votes.length,
    votedCount: voterIds.size,
    unvotedCount: Math.max(totalMembers - voterIds.size, 0),
    options: poll.options.map((o) => {
      const count = poll.votes.filter((v) => v.optionId === o.id).length;
      return {
        id: o.id,
        text: o.text,
        count,
        ratio: voterIds.size ? Math.round((count / voterIds.size) * 100) : 0,
      };
    }),
  };

  // 管理后台始终返回投票人明细；showVoters 仅控制是否向小程序会员公开
  const voters = poll.votes.map((v) => ({
    memberId: v.memberId,
    name: v.member.name,
    company: v.member.company,
    optionText: v.option.text,
    createdAt: v.createdAt,
  }));

  res.json({ poll: { id: poll.id, title: poll.title, status: poll.status, showVoters: poll.showVoters }, results, voters });
});


router.delete('/polls/:id', async (req, res) => {
  await prisma.poll.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------- Events ----------
router.use('/events', requireMenu('events'));
router.use('/registrations', requireMenu('events'));
router.get('/events', async (req, res) => {
  const events = await prisma.event.findMany({
    include: { _count: { select: { registrations: true } } },
    orderBy: { startAt: 'desc' },
  });
  res.json({ events });
});

router.post('/events', async (req, res) => {
  const data = pickEvent(req.body);
  if (!data.title || !data.startAt || !data.endAt) {
    return res.status(400).json({ error: '名称与时间必填' });
  }
  const event = await prisma.event.create({ data });
  res.json({ event });
});

router.put('/events/:id', async (req, res) => {
  const data = pickEvent(req.body);
  const event = await prisma.event.update({ where: { id: req.params.id }, data });
  res.json({ event });
});

router.delete('/events/:id', async (req, res) => {
  await prisma.event.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.get('/events/:id/registrations', async (req, res) => {
  const registrations = await prisma.registration.findMany({
    where: { eventId: req.params.id },
    include: { member: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ registrations });
});

router.put('/registrations/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: '缺少状态' });
  const registration = await prisma.registration.update({
    where: { id: req.params.id },
    data: { status },
  });
  res.json({ registration });
});

function pickEvent(body = {}) {
  const data = {};
  for (const f of ['title', 'coverUrl', 'description', 'location', 'agenda', 'guests', 'status']) {
    if (body[f] !== undefined) data[f] = body[f];
  }
  if (body.startAt !== undefined) data.startAt = new Date(body.startAt);
  if (body.endAt !== undefined) data.endAt = new Date(body.endAt);
  if (body.registerDeadline !== undefined) {
    data.registerDeadline = body.registerDeadline ? new Date(body.registerDeadline) : null;
  }
  return data;
}

// ---------- Requests ----------
router.use('/requests', requireMenu('requests'));
router.get('/requests', async (req, res) => {
  const items = await prisma.request.findMany({
    include: { member: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ requests: items });
});

router.put('/requests/:id', async (req, res) => {
  const { status, adminNote } = req.body || {};
  const data = {};
  if (status !== undefined) data.status = status;
  if (adminNote !== undefined) data.adminNote = adminNote;
  const request = await prisma.request.update({
    where: { id: req.params.id },
    data,
    include: { member: true },
  });
  res.json({ request });
});

// ---------- Analytics（仅超级管理员） ----------
router.use('/analytics', requireSuperAdmin);

router.get('/analytics/overview', async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const overview = await getAnalyticsOverview(days);
    res.json({ overview });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取概览失败' });
  }
});

router.get('/analytics/members', async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const limit = Number(req.query.limit) || 50;
    const members = await getMemberActivityRanks(days, limit);
    res.json({ members, days });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取活跃会员失败' });
  }
});

router.get('/analytics/members/:id', async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const limit = Number(req.query.limit) || 80;
    const detail = await getMemberActivityDetail(req.params.id, { days, limit });
    if (!detail) return deny(res, 404, '会员不存在');
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取会员活跃详情失败' });
  }
});

export default router;

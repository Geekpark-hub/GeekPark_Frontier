import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireAdmin, requireMenu } from '../middleware/auth.js';
import { getAiFeedRunState, startAiFeedAsync } from '../jobs/aiFeed.js';
import { runMaintenance } from '../jobs/maintenance.js';
import { getSearchStatus } from '../services/search.js';
import { getLlmStatus } from '../services/llm.js';
import { getNotifyStatus, getMembersSubscribeQuotaMap, getMemberSubscribeQuota } from '../services/notify.js';
import {
  ensureDefaultNewsSources,
  fetchOneFeed,
  getRssStatus,
  invalidateRssCache,
  listNewsSourcesFromDb,
} from '../services/rss.js';
import { isRootSuperAdmin, ROOT_SUPER_ADMIN_PHONE } from '../constants.js';
import {
  hasMenuAccess,
  parseAdminMenus,
  resolveAdminMenus,
  serializeAdminMenus,
} from '../menus.js';
import {
  isValidCnMobile,
  mergePhoneIntoMember,
  normalizePhone,
  parsePhonesExtra,
  stringifyPhonesExtra,
} from '../utils/phones.js';
import {
  EVENT_LABELS,
  buildAnalyticsCsv,
  getAnalyticsExportBundle,
  getAnalyticsOverview,
  getMemberActivityDetail,
  getMemberActivityRanks,
  resolveAnalyticsRange,
} from '../services/analytics.js';
import { listNotifyLogs } from '../services/notifyLog.js';
import { pageResult, parsePageQuery } from '../utils/pagination.js';
import { adminAuditMiddleware } from '../services/adminAudit.js';
import { getFeedHeroSetting, setFeedHeroSetting } from '../services/appSettings.js';
import { allocateInviteCode, ensureMemberInviteCode } from '../utils/inviteCode.js';
import { generateWxaCode } from '../wx.js';
import {
  ensureWxUrlLink,
  stableShareUrl,
  WX_URL_LINK_DAYS,
} from '../services/shareLink.js';
import multer from 'multer';
import { importBriefFromFile, normalizeHtml } from '../services/briefImport.js';
import { getQiniuStatus, uploadBufferToQiniu } from '../services/qiniu.js';

function normalizeQrWidth(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 430;
  return Math.min(Math.max(Math.round(n), 280), 1280);
}

async function buildSharePayload({ kind, pagePath, id, title, width, hyaline, forceRefresh }) {
  const path = String(pagePath || '').replace(/^\//, '');
  const query = `id=${id}`;
  const miniPath = `/${path}?${query}`;
  const shareKind = kind === 'poll' ? 'poll' : kind === 'brief' ? 'brief' : 'event';
  // 对外始终返回固定短链；微信链缓存在库里
  const urlLink = stableShareUrl(shareKind, id);
  const qrWidth = normalizeQrWidth(width);
  // 默认官方透明圆形；hyaline=false 时为白底方图（含白边）
  const qrHyaline = hyaline === undefined || hyaline === null
    ? true
    : !(hyaline === false || hyaline === 'false' || hyaline === 0 || hyaline === '0');
  let envVersion = 'release';
  let urlLinkError = '';
  let wxExpiresAt = null;
  let wxUrlLink = '';
  try {
    const ensured = await ensureWxUrlLink({
      kind: shareKind,
      id,
      pagePath: path,
      forceRefresh: Boolean(forceRefresh),
    });
    wxUrlLink = ensured.wxUrlLink;
    wxExpiresAt = ensured.wxUrlLinkExpireAt;
    envVersion = ensured.envVersion || envVersion;
  } catch (err) {
    // 85079：微信规定 URL Link 必须已有正式版，仅上传体验版不够
    urlLinkError =
      err.detail?.errcode === 85079
        ? '外部分享短链需要小程序已发布正式版。体验版请先用下方小程序码（仅体验成员可打开）。'
        : err.message || '生成分享短链失败';
    envVersion = 'trial';
    console.warn('[share/urllink]', err.detail || err.message || err);
  }
  let qrcodeDataUrl = '';
  let qrcodeError = '';
  try {
    const qr = await generateWxaCode({
      path: `${path}?${query}`,
      scene: String(id),
      width: qrWidth,
      envVersion,
      hyaline: qrHyaline,
    });
    const mime = qr.contentType || 'image/png';
    qrcodeDataUrl = `data:${mime};base64,${qr.buffer.toString('base64')}`;
    envVersion = qr.envVersion || envVersion;
  } catch (qrErr) {
    qrcodeError = qrErr.message || '生成小程序码失败';
    console.warn('[share/qrcode]', qrErr.detail || qrErr.message || qrErr);
  }
  // 对外短链始终返回固定地址；微信链失败时仍可复制短链（打开会提示）
  return {
    urlLink,
    urlLinkError,
    wxUrlLink: urlLinkError ? '' : wxUrlLink,
    wxExpiresAt: urlLinkError ? null : wxExpiresAt,
    envVersion,
    path: miniPath,
    qrcodeDataUrl,
    qrcodeError,
    qrcodeWidth: qrWidth,
    qrcodeHyaline: qrHyaline,
    expireDays: WX_URL_LINK_DAYS,
    title: title || '',
  };
}

const router = Router();
router.use(requireAdmin);
router.use(adminAuditMiddleware);

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
  const q = String(req.query.q || '').trim();
  if (q) {
    const code = q.toUpperCase().replace(/[\s\-]/g, '');
    where.OR = [
      { name: { contains: q } },
      { company: { contains: q } },
      { title: { contains: q } },
      { phone: { contains: q } },
      { phonesExtra: { contains: q } },
      ...(code ? [{ inviteCode: { contains: code } }] : []),
    ];
  }
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const [total, members] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  const shaped = [];
  for (const m of members) {
    const ensured = await ensureMemberInviteCode(m);
    shaped.push({ ...ensured, adminMenus: resolveAdminMenus(ensured) });
  }

  // 会员/后台用户列表附带订阅推送余量（授权 − 已成功发送）
  let subscribeTemplates = getNotifyStatus().templates;
  if ((role === 'member' || role === 'admin') && shaped.length) {
    try {
      const { templates, byMember } = await getMembersSubscribeQuotaMap(shaped.map((m) => m.id));
      subscribeTemplates = templates;
      for (const row of shaped) {
        row.subscribeQuota = byMember[row.id] || null;
      }
    } catch (err) {
      console.error('[admin/members] subscribe quota', err);
    }
  }

  res.json({
    ...pageResult({ page, pageSize, total, rowsKey: 'members', rows: shaped }),
    subscribeTemplates,
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
    // 后台管理员仍需手机号登录；普通会员可只用用户码
    if (creatingStaff) {
      if (!data.phone) return deny(res, 400, '管理员手机号必填');
      if (!/^1\d{10}$/.test(data.phone)) return deny(res, 400, '手机号格式不正确');
    } else if (data.phone && !/^1\d{10}$/.test(data.phone)) {
      return deny(res, 400, '手机号格式不正确');
    }
    // 普通会员到期日必填；永久会员用 2999-12-31
    if (!creatingStaff && !data.expiresAt) {
      return deny(res, 400, '到期日必填；永久会员请设为 2999-12-31');
    }
    if (data.isSuperAdmin) {
      return deny(res, 403, '不可通过用户管理创建超级管理员');
    }
    if (data.isAdmin) {
      const menus = parseAdminMenus(req.body.adminMenus);
      if (!menus.length) return deny(res, 400, '请至少勾选一个菜单权限');
      data.adminMenus = serializeAdminMenus(menus);
      data.isSuperAdmin = false;
    }
    if (!data.inviteCode) {
      data.inviteCode = await allocateInviteCode(data.name || '');
    }
    const member = await prisma.member.create({ data });
    res.json({ member: { ...member, adminMenus: resolveAdminMenus(member) } });
  } catch (err) {
    if (err.code === 'P2002') {
      return deny(res, 400, '手机号、用户码或微信绑定冲突');
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
    if (staffTarget(existing) || staffTarget(data)) {
      const nextPhone = data.phone !== undefined ? data.phone : existing.phone;
      if (!nextPhone) return deny(res, 400, '管理员手机号必填');
    }
    if (!staffTarget(existing) && !staffTarget(data)) {
      const nextExpires = data.expiresAt !== undefined ? data.expiresAt : existing.expiresAt;
      if (!nextExpires) {
        return deny(res, 400, '到期日必填；永久会员请设为 2999-12-31');
      }
    }
    const member = await prisma.member.update({ where: { id: req.params.id }, data });
    res.json({ member: { ...member, adminMenus: resolveAdminMenus(member) } });
  } catch (err) {
    if (err.code === 'P2025') return deny(res, 404, '记录不存在');
    if (err.code === 'P2002') return deny(res, 400, '手机号、用户码或微信绑定冲突');
    if (err.status) return deny(res, err.status, err.message);
    throw err;
  }
});

/** 重新生成用户码（旧码立即失效） */
router.post('/members/:id/invite-code', async (req, res) => {
  const existing = await prisma.member.findUnique({ where: { id: req.params.id } });
  if (!existing) return deny(res, 404, '记录不存在');
  if (existing.isSuperAdmin) {
    if (!req.member?.isSuperAdmin) {
      return deny(res, 403, '仅超级管理员可重置超管用户码');
    }
  } else {
    const menuKey = staffTarget(existing) ? 'users' : 'members';
    if (!hasMenuAccess(req.member, menuKey)) {
      return deny(res, 403, '无此菜单权限');
    }
  }
  const inviteCode = await allocateInviteCode(existing.name, existing.id);
  const member = await prisma.member.update({
    where: { id: req.params.id },
    data: { inviteCode },
  });
  res.json({ member: { ...member, adminMenus: resolveAdminMenus(member) } });
});

/** 会员活动报名记录 */
router.get('/members/:id/subscribe-quota', async (req, res) => {
  if (!hasMenuAccess(req.member, 'members')) {
    return deny(res, 403, '无此菜单权限');
  }
  try {
    const member = await prisma.member.findUnique({ where: { id: req.params.id } });
    if (!member) return deny(res, 404, '会员不存在');
    const quota = await getMemberSubscribeQuota(member.id);
    res.json({ memberId: member.id, name: member.name, ...quota });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '查询推送余量失败' });
  }
});

router.get('/members/:id/registrations', async (req, res) => {
  const existing = await prisma.member.findUnique({ where: { id: req.params.id } });
  if (!existing) return deny(res, 404, '记录不存在');
  const menuKey = staffTarget(existing) ? 'users' : 'members';
  if (!hasMenuAccess(req.member, menuKey)) {
    return deny(res, 403, '无此菜单权限');
  }
  const registrations = await prisma.registration.findMany({
    where: { memberId: req.params.id },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          startAt: true,
          endAt: true,
          location: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ registrations });
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
  await prisma.member.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.post('/members/:id/unbind-wechat', async (req, res) => {
  const existing = await prisma.member.findUnique({ where: { id: req.params.id } });
  if (!existing) return deny(res, 404, '记录不存在');
  // 超管微信仅超管可解绑（含本人）
  if (existing.isSuperAdmin) {
    if (!req.member?.isSuperAdmin) {
      return deny(res, 403, '仅超级管理员可解绑超管微信');
    }
  } else {
    const menuKey = staffTarget(existing) ? 'users' : 'members';
    if (!hasMenuAccess(req.member, menuKey)) {
      return deny(res, 403, '无此菜单权限');
    }
  }
  const openid = existing.openid || '';
  const member = await prisma.member.update({
    where: { id: req.params.id },
    data: { openid: null },
  });
  if (openid) {
    try {
      await prisma.wxEntry.updateMany({
        where: { openid },
        data: {
          status: 'pending',
          boundMemberId: null,
          boundAt: null,
          lastSeenAt: new Date(),
        },
      });
    } catch {
      // WxEntry 表未迁移时忽略
    }
  }
  res.json({ member });
});

function maskOpenid(openid) {
  const s = String(openid || '');
  if (s.length <= 10) return s ? `${s.slice(0, 2)}****` : '';
  return `${s.slice(0, 6)}****${s.slice(-4)}`;
}

/** 微信进入登记列表（待绑 / 已绑 / 已忽略） */
router.get('/wx-entries', requireMenu('wx-entries'), async (req, res) => {
  const { page, pageSize, skip } = parsePageQuery(req.query);
  const status = String(req.query.status || 'pending').trim();
  const q = String(req.query.q || '').trim();
  // 默认隐藏仅打开、未填昵称的记录；includeEmptyNick=1 时全部展示
  const includeEmptyNick =
    req.query.includeEmptyNick === '1' ||
    req.query.includeEmptyNick === 'true' ||
    req.query.includeEmptyNick === true;
  const where = {};
  if (status && status !== 'all') where.status = status;
  if (!includeEmptyNick) {
    // WxEntry.wxNickname 为非空字符串字段，只过滤空串
    where.wxNickname = { not: '' };
  }
  if (q) {
    where.OR = [
      { wxNickname: { contains: q } },
      { openid: { contains: q } },
    ];
  }
  const [total, rows] = await Promise.all([
    prisma.wxEntry.count({ where }),
    prisma.wxEntry.findMany({
      where,
      orderBy: [{ lastSeenAt: 'desc' }],
      skip,
      take: pageSize,
    }),
  ]);
  const memberIds = [...new Set(rows.map((r) => r.boundMemberId).filter(Boolean))];
  const members = memberIds.length
    ? await prisma.member.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, name: true, company: true, inviteCode: true },
      })
    : [];
  const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));
  res.json(
    pageResult({
      page,
      pageSize,
      total,
      rowsKey: 'entries',
      rows: rows.map((r) => ({
        ...r,
        openidMasked: maskOpenid(r.openid),
        boundMember: r.boundMemberId ? memberMap[r.boundMemberId] || null : null,
      })),
    })
  );
});

/** 将微信进入记录绑定 / 更换绑定到会员 */
router.post('/wx-entries/:id/bind', requireMenu('wx-entries'), async (req, res) => {
  const entry = await prisma.wxEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return deny(res, 404, '记录不存在');
  const memberId = String(req.body?.memberId || '').trim();
  if (!memberId) return deny(res, 400, '请选择会员');

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return deny(res, 404, '会员不存在');
  if (member.openid && member.openid !== entry.openid) {
    return deny(res, 409, '该会员已绑定其他微信，请先解绑');
  }
  const occupied = entry.openid
    ? await prisma.member.findUnique({ where: { openid: entry.openid } })
    : null;
  if (occupied && occupied.id !== member.id) {
    if (occupied.isSuperAdmin && !req.member?.isSuperAdmin) {
      return deny(res, 403, '仅超级管理员可更换超管微信绑定');
    }
    // 更换绑定：先解绑原会员
    await prisma.member.update({
      where: { id: occupied.id },
      data: { openid: null },
    });
  }

  const now = new Date();
  const data = {
    openid: entry.openid,
  };
  if (entry.wxNickname && !member.wxNickname) {
    data.wxNickname = entry.wxNickname;
    data.wxNickAskedAt = now;
    data.wxNickResult = 'accept';
  }
  // 微信进入授权手机号：无主号且未被占用 → 写主号；否则记入备号（不覆盖主号）
  const entryPhone = normalizePhone(entry.phone);
  if (isValidCnMobile(entryPhone)) {
    const merged = mergePhoneIntoMember(member, entryPhone);
    if (merged.kind === 'primary') {
      const phoneTaken = await prisma.member.findUnique({ where: { phone: entryPhone } });
      if (!phoneTaken || phoneTaken.id === member.id) {
        data.phone = entryPhone;
        data.phoneAuthAskedAt = member.phoneAuthAskedAt || now;
        data.phoneAuthResult = 'accept';
      } else {
        // 主号已被他人占用：仍记入备号，方便运营对照
        const extras = parsePhonesExtra(member.phonesExtra);
        if (!extras.includes(entryPhone)) {
          data.phonesExtra = stringifyPhonesExtra([...extras, entryPhone]);
        }
      }
    } else if (merged.kind === 'extra') {
      data.phonesExtra = merged.phonesExtra;
      data.phoneAuthAskedAt = member.phoneAuthAskedAt || now;
      data.phoneAuthResult = 'accept';
    }
  }

  const updatedMember = await prisma.member.update({
    where: { id: member.id },
    data,
  });
  const updatedEntry = await prisma.wxEntry.update({
    where: { id: entry.id },
    data: {
      status: 'bound',
      boundMemberId: member.id,
      boundAt: now,
      lastSeenAt: now,
      ...(isValidCnMobile(entryPhone) ? { phone: entryPhone } : {}),
    },
  });
  res.json({
    ok: true,
    entry: { ...updatedEntry, openidMasked: maskOpenid(updatedEntry.openid) },
    member: updatedMember,
  });
});

/** 解绑：清除会员 openid，记录回到待绑定（不删除） */
router.post('/wx-entries/:id/unbind', requireMenu('wx-entries'), async (req, res) => {
  const entry = await prisma.wxEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return deny(res, 404, '记录不存在');

  const bound = entry.openid
    ? await prisma.member.findUnique({ where: { openid: entry.openid } })
    : null;
  if (bound?.isSuperAdmin && !req.member?.isSuperAdmin) {
    return deny(res, 403, '仅超级管理员可解绑超管微信');
  }
  if (bound) {
    await prisma.member.update({
      where: { id: bound.id },
      data: { openid: null },
    });
  }
  const updated = await prisma.wxEntry.update({
    where: { id: entry.id },
    data: {
      status: 'pending',
      boundMemberId: null,
      boundAt: null,
      lastSeenAt: new Date(),
    },
  });
  res.json({
    ok: true,
    entry: { ...updated, openidMasked: maskOpenid(updated.openid) },
    unboundMemberId: bound?.id || null,
  });
});

router.post('/wx-entries/:id/ignore', requireMenu('wx-entries'), async (req, res) => {
  const entry = await prisma.wxEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return deny(res, 404, '记录不存在');
  const updated = await prisma.wxEntry.update({
    where: { id: entry.id },
    data: { status: 'ignored' },
  });
  res.json({ ok: true, entry: { ...updated, openidMasked: maskOpenid(updated.openid) } });
});

/** 删除微信进入记录；若已绑会员则同时解绑该微信 openid（便于重新测试进入） */
router.delete('/wx-entries/:id', requireMenu('wx-entries'), async (req, res) => {
  const entry = await prisma.wxEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return deny(res, 404, '记录不存在');

  const bound = entry.openid
    ? await prisma.member.findUnique({ where: { openid: entry.openid } })
    : null;
  if (bound?.isSuperAdmin && !req.member?.isSuperAdmin) {
    return deny(res, 403, '仅超级管理员可删除已绑超管的微信进入记录');
  }

  if (bound) {
    await prisma.member.update({
      where: { id: bound.id },
      data: { openid: null },
    });
  }
  await prisma.wxEntry.delete({ where: { id: entry.id } });
  res.json({ ok: true, unboundMemberId: bound?.id || null });
});

function pickMember(body = {}, actor, existing = null) {
  const data = {};
  const fields = [
    'name', 'company', 'title', 'phone', 'status',
    'linkedin', 'wechatMp', 'xAccount', 'youtube', 'bilibili',
    'rssKeywords', 'googleNewsRssZh', 'googleNewsRssEn',
  ];
  for (const f of fields) {
    if (body[f] !== undefined) data[f] = typeof body[f] === 'string' ? body[f].trim() : body[f];
  }
  // 空手机号存 null，避免唯一约束把多个空串撞车
  if (data.phone === '') data.phone = null;
  if (body.phonesExtra !== undefined) {
    const primary = normalizePhone(data.phone !== undefined ? data.phone : existing?.phone);
    const extras = parsePhonesExtra(
      Array.isArray(body.phonesExtra) ? JSON.stringify(body.phonesExtra) : body.phonesExtra,
    ).filter((p) => p !== primary);
    data.phonesExtra = stringifyPhonesExtra(extras);
  }
  if (body.expiresAt !== undefined) {
    data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }
  if (body.joinedAt !== undefined) {
    data.joinedAt = body.joinedAt ? new Date(body.joinedAt) : null;
  }
  if (body.birthday !== undefined) {
    data.birthday = body.birthday ? new Date(body.birthday) : null;
  }

  if (existing && isRootSuperAdmin(existing)) {
    const err = new Error('超级管理员不在用户管理中维护');
    err.status = 403;
    throw err;
  }

  if (body.openid === null && (actor.isSuperAdmin || hasMenuAccess(actor, 'users'))) {
    data.openid = null;
  }

  const wantsAdmin = body.isAdmin !== undefined;
  const wantsSuper = body.isSuperAdmin !== undefined;
  const wantsMenus = body.adminMenus !== undefined;

  if (wantsAdmin || wantsSuper || wantsMenus) {
    // 有「用户管理」菜单即可维护普通管理员；不可授予超管
    if (!actor.isSuperAdmin && !hasMenuAccess(actor, 'users')) {
      const err = new Error('无用户管理权限，无法设置后台账号');
      err.status = 403;
      throw err;
    }
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
router.get('/feed/member-options', async (_req, res) => {
  const members = await prisma.member.findMany({
    where: { isAdmin: false, isSuperAdmin: false },
    select: { id: true, name: true, company: true, status: true },
    orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ members });
});
router.get('/feed/hero', async (_req, res) => {
  const hero = await getFeedHeroSetting();
  res.json({ hero });
});
router.put('/feed/hero', async (req, res) => {
  const { enabled, url } = req.body || {};
  const hero = await setFeedHeroSetting({
    enabled,
    url,
  });
  res.json({ hero });
});
router.get('/feed', async (req, res) => {
  const { status, sourceType } = req.query;
  const where = {};
  if (status) where.status = status;
  if (sourceType) where.sourceType = sourceType;
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const [total, posts] = await Promise.all([
    prisma.feedPost.count({ where }),
    prisma.feedPost.findMany({
      where,
      include: {
        relatedMember: { select: { id: true, name: true, company: true } },
      },
      orderBy: { publishedAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json(pageResult({ page, pageSize, total, rowsKey: 'posts', rows: posts }));
});

router.post('/feed', async (req, res) => {
  const {
    title,
    content,
    publishedAt,
    sourceUrl = '',
    status = 'draft',
    relatedMemberId = null,
  } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: '标题和内容必填' });
  let relatedId = relatedMemberId ? String(relatedMemberId).trim() : null;
  if (relatedId) {
    const m = await prisma.member.findUnique({ where: { id: relatedId }, select: { id: true } });
    if (!m) return res.status(400).json({ error: '关联会员不存在' });
  } else {
    relatedId = null;
  }
  const post = await prisma.feedPost.create({
    data: {
      title,
      content,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      sourceUrl,
      status,
      sourceType: 'manual',
      authorId: req.member.id,
      relatedMemberId: relatedId,
    },
    include: {
      relatedMember: { select: { id: true, name: true, company: true } },
    },
  });
  res.json({ post });
});

router.put('/feed/:id', async (req, res) => {
  const { title, content, publishedAt, sourceUrl, status, relatedMemberId } = req.body || {};
  const data = {};
  if (title !== undefined) data.title = title;
  if (content !== undefined) data.content = content;
  if (sourceUrl !== undefined) data.sourceUrl = sourceUrl;
  if (status !== undefined) data.status = status;
  if (publishedAt !== undefined) data.publishedAt = new Date(publishedAt);
  if (relatedMemberId !== undefined) {
    const relatedId = relatedMemberId ? String(relatedMemberId).trim() : null;
    if (relatedId) {
      const m = await prisma.member.findUnique({ where: { id: relatedId }, select: { id: true } });
      if (!m) return res.status(400).json({ error: '关联会员不存在' });
      data.relatedMemberId = relatedId;
    } else {
      data.relatedMemberId = null;
    }
  }
  const post = await prisma.feedPost.update({
    where: { id: req.params.id },
    data,
    include: {
      relatedMember: { select: { id: true, name: true, company: true } },
    },
  });
  res.json({ post });
});

router.delete('/feed/:id', async (req, res) => {
  await prisma.feedPost.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.post('/feed/batch-delete', async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];
  if (!ids.length) return deny(res, 400, '请选择要删除的动态');
  if (ids.length > 200) return deny(res, 400, '单次最多删除 200 条');
  const result = await prisma.feedPost.deleteMany({ where: { id: { in: ids } } });
  res.json({ ok: true, deleted: result.count });
});

// ---------- AI / Jobs ----------
// 状态接口：有 feed 或 ai 权限即可（布局轮询）
router.get('/ai/status', (req, res, next) => {
  if (hasMenuAccess(req.member, 'ai') || hasMenuAccess(req.member, 'feed')) return next();
  return deny(res, 403, '无此菜单权限');
}, async (req, res) => {
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const [totalJobs, recent] = await Promise.all([
    prisma.jobLog.count(),
    prisma.jobLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  const pendingAuto = await prisma.feedPost.count({
    where: { status: 'pending', sourceType: 'auto' },
  });
  res.json({
    search: getSearchStatus(),
    llm: getLlmStatus(),
    rss: getRssStatus(),
    notify: getNotifyStatus(),
    pendingAuto,
    currentRun: getAiFeedRunState(),
    recentJobs: recent,
    total: totalJobs,
    page,
    pageSize,
  });
});

router.post('/ai/run-feed', requireMenu('ai'), async (req, res) => {
  try {
    const memberId = req.body?.memberId || null;
    const limitPerMember = Number(req.body?.limitPerMember || process.env.AI_FEED_LIMIT_PER_MEMBER || 10);
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

// ---------- 信息源（RSS）----------
function canManageSources(req, res, next) {
  if (hasMenuAccess(req.member, 'sources') || hasMenuAccess(req.member, 'ai')) return next();
  return deny(res, 403, '无此菜单权限');
}

router.get('/ai/sources', canManageSources, async (req, res) => {
  try {
    const all = await listNewsSourcesFromDb();
    const { page, pageSize, skip, take } = parsePageQuery(req.query);
    const total = all.length;
    const sources = all.slice(skip, skip + take);
    res.json({
      ...pageResult({ page, pageSize, total, rowsKey: 'sources', rows: sources }),
      rss: getRssStatus(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '获取信息源失败' });
  }
});

router.post('/ai/sources', canManageSources, async (req, res) => {
  try {
    await ensureDefaultNewsSources();
    const name = String(req.body?.name || '').trim();
    const url = String(req.body?.url || '').trim();
    const enabled = req.body?.enabled !== false;
    if (!name) return res.status(400).json({ error: '请填写名称' });
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: '请填写合法的 http(s) RSS 地址' });
    }
    const maxSort = await prisma.newsSource.aggregate({ _max: { sort: true } });
    const source = await prisma.newsSource.create({
      data: {
        name,
        url,
        enabled,
        sort: (maxSort._max.sort ?? -1) + 1,
      },
    });
    invalidateRssCache();
    res.json({ source });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: '该 RSS 地址已存在' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || '添加失败' });
  }
});

router.put('/ai/sources/:id', canManageSources, async (req, res) => {
  try {
    const id = req.params.id;
    const data = {};
    if (req.body?.name !== undefined) data.name = String(req.body.name || '').trim();
    if (req.body?.url !== undefined) {
      const url = String(req.body.url || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: '请填写合法的 http(s) RSS 地址' });
      }
      data.url = url;
    }
    if (req.body?.enabled !== undefined) data.enabled = Boolean(req.body.enabled);
    if (req.body?.sort !== undefined) data.sort = Number(req.body.sort) || 0;
    if (data.name === '') return res.status(400).json({ error: '名称不能为空' });
    const source = await prisma.newsSource.update({ where: { id }, data });
    invalidateRssCache();
    res.json({ source });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: '该 RSS 地址已存在' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: '信息源不存在' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || '更新失败' });
  }
});

router.delete('/ai/sources/:id', canManageSources, async (req, res) => {
  try {
    await prisma.newsSource.delete({ where: { id: req.params.id } });
    invalidateRssCache();
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: '信息源不存在' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || '删除失败' });
  }
});

router.post('/ai/sources/:id/probe', canManageSources, async (req, res) => {
  try {
    const row = await prisma.newsSource.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: '信息源不存在' });
    const result = await fetchOneFeed({
      id: row.key || row.id,
      dbId: row.id,
      name: row.name,
      url: row.url,
    });
    res.json({
      ok: result.ok,
      count: result.items.length,
      error: result.error,
      sample: result.items.slice(0, 3).map((x) => ({ title: x.title, url: x.url })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '探测失败' });
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
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const [total, logs] = await Promise.all([
    prisma.jobLog.count(),
    prisma.jobLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json(pageResult({ page, pageSize, total, rowsKey: 'logs', rows: logs }));
});

// ---------- Polls ----------
router.use('/polls', requireMenu('polls'));
router.get('/polls', async (req, res) => {
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const [total, polls] = await Promise.all([
    prisma.poll.count({ where }),
    prisma.poll.findMany({
      where,
      include: {
        options: { orderBy: { sort: 'asc' } },
        _count: { select: { votes: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json(pageResult({ page, pageSize, total, rowsKey: 'polls', rows: polls }));
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

/** 生成投票分享：URL Link + 小程序码（落地页 pages/poll/share） */
router.post('/polls/:id/share-link', async (req, res) => {
  try {
    const poll = await prisma.poll.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true, status: true },
    });
    if (!poll) return res.status(404).json({ error: '投票不存在' });
    const payload = await buildSharePayload({
      kind: 'poll',
      pagePath: 'pages/poll/share',
      id: poll.id,
      title: poll.title,
      width: req.body?.width,
      hyaline: req.body?.hyaline,
      forceRefresh: Boolean(req.body?.forceRefresh),
    });
    res.json(payload);
  } catch (err) {
    console.error('[polls/share-link]', err.detail || err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || '生成分享链接失败' });
  }
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

/** 生成活动分享：URL Link + 小程序码（落地页 pages/events/share） */
router.post('/events/:id/share-link', async (req, res) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true, status: true },
    });
    if (!event) return res.status(404).json({ error: '活动不存在' });
    const payload = await buildSharePayload({
      kind: 'event',
      pagePath: 'pages/events/share',
      id: event.id,
      title: event.title,
      width: req.body?.width,
      hyaline: req.body?.hyaline,
      forceRefresh: Boolean(req.body?.forceRefresh),
    });
    res.json(payload);
  } catch (err) {
    console.error('[events/share-link]', err.detail || err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || '生成分享链接失败' });
  }
});

router.get('/events', async (req, res) => {
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const [total, events] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      include: { _count: { select: { registrations: true } } },
      orderBy: { startAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json(pageResult({ page, pageSize, total, rowsKey: 'events', rows: events }));
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
  const where = { eventId: req.params.id };
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const [total, registrations] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({
      where,
      include: { member: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json(pageResult({ page, pageSize, total, rowsKey: 'registrations', rows: registrations }));
});

router.put('/registrations/:id', async (req, res) => {
  const { status, attended } = req.body || {};
  const data = {};
  if (status !== undefined) data.status = status;
  if (attended !== undefined) {
    data.attended = attended === null || attended === '' ? null : Boolean(attended);
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: '缺少更新字段' });
  const registration = await prisma.registration.update({
    where: { id: req.params.id },
    data,
  });
  res.json({ registration });
});

function pickEvent(body = {}) {
  const data = {};
  for (const f of ['title', 'coverUrl', 'description', 'location', 'agenda', 'guests', 'status']) {
    if (body[f] !== undefined) data[f] = body[f];
  }
  if (body.locationLat !== undefined) {
    const n = Number(body.locationLat);
    data.locationLat = body.locationLat === '' || body.locationLat == null || !Number.isFinite(n) ? null : n;
  }
  if (body.locationLng !== undefined) {
    const n = Number(body.locationLng);
    data.locationLng = body.locationLng === '' || body.locationLng == null || !Number.isFinite(n) ? null : n;
  }
  if (body.showInFeed !== undefined) data.showInFeed = Boolean(body.showInFeed);
  if (body.showCoverInFeed !== undefined) data.showCoverInFeed = Boolean(body.showCoverInFeed);
  if (body.feedPin !== undefined) data.feedPin = Boolean(body.feedPin);
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
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const [total, items] = await Promise.all([
    prisma.request.count({ where }),
    prisma.request.findMany({
      where,
      include: { member: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json(pageResult({ page, pageSize, total, rowsKey: 'requests', rows: items }));
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

// ---------- 操作记录（仅超级管理员） ----------
router.get('/audit-logs', async (req, res) => {
  if (!req.member?.isSuperAdmin) return deny(res, 403, '需要超级管理员权限');
  try {
    const where = {};
    if (req.query.actorId) where.actorId = String(req.query.actorId);
    if (req.query.method) where.method = String(req.query.method).toUpperCase();
    if (req.query.q) {
      const q = String(req.query.q).trim();
      if (q) {
        where.OR = [
          { action: { contains: q } },
          { path: { contains: q } },
          { actorName: { contains: q } },
          { actorPhone: { contains: q } },
          { targetId: { contains: q } },
        ];
      }
    }
    const { page, pageSize, skip, take } = parsePageQuery(req.query);
    const [total, logs] = await Promise.all([
      prisma.adminAuditLog.count({ where }),
      prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);
    res.json(pageResult({ page, pageSize, total, rowsKey: 'logs', rows: logs }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取操作记录失败' });
  }
});

// ---------- 消息中心（通知日志） ----------
router.get('/notify-logs', async (req, res) => {
  if (!req.member?.isSuperAdmin && !hasMenuAccess(req.member, 'notify')) {
    return deny(res, 403, '无权限查看消息中心');
  }
  try {
    const where = await listNotifyLogs(req.query);
    const { page, pageSize, skip, take } = parsePageQuery(req.query);
    const [total, logs] = await Promise.all([
      prisma.notifyLog.count({ where }),
      prisma.notifyLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);
    res.json(pageResult({ page, pageSize, total, rowsKey: 'logs', rows: logs }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取消息日志失败' });
  }
});

// ---------- Analytics（仅超级管理员） ----------
router.use('/analytics', requireMenu('analytics'));

router.get('/analytics/overview', async (req, res) => {
  try {
    const range = resolveAnalyticsRange(req.query);
    const overview = await getAnalyticsOverview(range);
    res.json({ overview });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || '获取概览失败' });
  }
});

router.get('/analytics/members', async (req, res) => {
  try {
    const range = resolveAnalyticsRange(req.query);
    const limit = Number(req.query.limit) || 50;
    const members = await getMemberActivityRanks(range, limit);
    res.json({ members, rangeLabel: range.label, from: range.since, to: range.until });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || '获取活跃会员失败' });
  }
});

router.get('/analytics/members/:id', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 80;
    const detail = await getMemberActivityDetail(req.params.id, {
      days: req.query.days,
      from: req.query.from,
      to: req.query.to,
      limit,
    });
    if (!detail) return deny(res, 404, '会员不存在');
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || '获取会员活跃详情失败' });
  }
});

router.get('/analytics/export', async (req, res) => {
  try {
    const bundle = await getAnalyticsExportBundle(req.query);
    const format = String(req.query.format || 'csv').toLowerCase();
    if (format === 'json') {
      return res.json({
        ...bundle,
        eventLabels: EVENT_LABELS,
      });
    }
    const csv = buildAnalyticsCsv(bundle);
    const stamp = new Date().toISOString().slice(0, 10);
    const label = String(bundle.range?.label || 'range')
      .replace(/[^\w\u4e00-\u9fa5\-~\s]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 40);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="frontier-analytics-${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(`前沿社活跃明细_${label}_${stamp}.csv`)}`
    );
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || '导出数据失败' });
  }
});

// ---------- Briefs（内参）----------
const briefUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const ok =
      name.endsWith('.docx') ||
      name.endsWith('.pdf') ||
      mime.includes('wordprocessingml') ||
      mime === 'application/pdf';
    if (!ok) {
      cb(new Error('仅支持上传 .docx 或 .pdf'));
      return;
    }
    cb(null, true);
  },
});

router.use('/briefs', requireMenu('briefs'));

router.get('/briefs', async (req, res) => {
  const status = String(req.query.status || '').trim();
  const where = status ? { status } : {};
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const [total, briefs] = await Promise.all([
    prisma.brief.count({ where }),
    prisma.brief.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
  ]);
  res.json(pageResult({ rowsKey: 'briefs', rows: briefs, total, page, pageSize }));
});

router.post('/briefs/import', (req, res) => {
  briefUpload.single('file')(req, res, async (err) => {
    if (err) return deny(res, 400, err.message || '上传失败');
    if (!req.file) return deny(res, 400, '请选择 Word 或 PDF 文件');
    try {
      const parsed = await importBriefFromFile({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
      });
      let sourceFileUrl = '';
      const qiniu = getQiniuStatus();
      if (qiniu.ready) {
        try {
          const up = await uploadBufferToQiniu({
            buffer: req.file.buffer,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
          });
          sourceFileUrl = up.url || '';
        } catch (e) {
          console.warn('[briefs/import] source upload skipped', e.message || e);
        }
      }
      const brief = await prisma.brief.create({
        data: {
          title: parsed.title,
          guestName: parsed.guestName,
          summary: parsed.summary,
          contentHtml: parsed.contentHtml,
          status: 'draft',
          sourceType: parsed.sourceType,
          sourceFileUrl,
        },
      });
      res.json({ brief, textPreview: parsed.textPreview });
    } catch (e) {
      console.error('[briefs/import]', e);
      res.status(e.status || 500).json({ error: e.message || '导入失败' });
    }
  });
});

router.post('/briefs', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) return deny(res, 400, '标题必填');
  const brief = await prisma.brief.create({
    data: {
      title,
      guestName: String(req.body?.guestName || '').trim(),
      summary: String(req.body?.summary || '').trim(),
      contentHtml: normalizeHtml(String(req.body?.contentHtml || '')),
      status: req.body?.status === 'published' ? 'published' : 'draft',
      sourceType: 'manual',
      publishedAt: req.body?.status === 'published' ? new Date() : null,
    },
  });
  res.json({ brief });
});

router.put('/briefs/:id', async (req, res) => {
  const existing = await prisma.brief.findUnique({ where: { id: req.params.id } });
  if (!existing) return deny(res, 404, '记录不存在');
  const data = {};
  for (const key of ['title', 'guestName', 'summary', 'contentHtml', 'status']) {
    if (req.body?.[key] !== undefined) data[key] = String(req.body[key] ?? '').trim();
  }
  if (data.contentHtml !== undefined) data.contentHtml = normalizeHtml(data.contentHtml);
  if (data.title === '') return deny(res, 400, '标题必填');
  if (data.status && !['draft', 'published', 'archived'].includes(data.status)) {
    return deny(res, 400, '状态无效');
  }
  if (data.status === 'published' && existing.status !== 'published') {
    data.publishedAt = existing.publishedAt || new Date();
  }
  if (data.status === 'draft' || data.status === 'archived') {
    // keep publishedAt for history
  }
  const brief = await prisma.brief.update({ where: { id: existing.id }, data });
  res.json({ brief });
});

router.post('/briefs/:id/share-link', async (req, res) => {
  try {
    const brief = await prisma.brief.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true, status: true },
    });
    if (!brief) return deny(res, 404, '内参不存在');
    const payload = await buildSharePayload({
      kind: 'brief',
      pagePath: 'pages/briefs/share',
      id: brief.id,
      title: brief.title,
      width: req.body?.width,
      hyaline: req.body?.hyaline,
      forceRefresh: Boolean(req.body?.forceRefresh),
    });
    res.json(payload);
  } catch (err) {
    console.error('[briefs/share-link]', err.detail || err);
    res.status(err.status || 500).json({ error: err.message || '生成分享链接失败' });
  }
});

router.delete('/briefs/:id', async (req, res) => {
  const existing = await prisma.brief.findUnique({ where: { id: req.params.id } });
  if (!existing) return deny(res, 404, '记录不存在');
  await prisma.brief.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

export default router;

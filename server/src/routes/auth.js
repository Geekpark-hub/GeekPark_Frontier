import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';
import { isStaff, requireAuth, requireAdmin, signToken, signVisitorToken } from '../middleware/auth.js';
import { resolveAdminMenus } from '../menus.js';
import { codeToOpenid, phoneCodeToNumber } from '../wx.js';
import { normalizeInviteCode } from '../utils/inviteCode.js';
import {
  hasAdminPassword,
  hashAdminPassword,
  verifyAdminPassword,
} from '../utils/adminPassword.js';
import { mergePhoneIntoMember, parsePhonesExtra, stringifyPhonesExtra } from '../utils/phones.js';

const router = Router();

function jwtSecret() {
  return process.env.JWT_SECRET || 'dev-secret';
}

/** 仅当显式 ALLOW_MOCK_LOGIN=true 时开放 mock（正式环境务必关闭） */
function mockLoginAllowed() {
  return String(process.env.ALLOW_MOCK_LOGIN || '').toLowerCase() === 'true';
}

function sanitizeMember(member) {
  let adminMenus = [];
  try {
    adminMenus = resolveAdminMenus(member);
  } catch {
    adminMenus = member?.isSuperAdmin
      ? ['members', 'users', 'feed', 'briefs', 'polls', 'events', 'requests', 'analytics', 'notify', 'audit', 'ai', 'sources']
      : [];
  }
  const phone = member.phone || '';
  return {
    id: member.id,
    openid: member.openid,
    name: member.name,
    company: member.company,
    title: member.title,
    phone,
    inviteCode: member.inviteCode || '',
    status: member.status,
    expiresAt: member.expiresAt,
    isAdmin: isStaff(member),
    isSuperAdmin: Boolean(member.isSuperAdmin),
    adminMenus,
    hasAdminPassword: hasAdminPassword(member),
    linkedin: member.linkedin,
    wechatMp: member.wechatMp,
    xAccount: member.xAccount,
    youtube: member.youtube,
    bilibili: member.bilibili,
    phoneAuthAsked: Boolean(member.phoneAuthAskedAt),
    phoneAuthResult: member.phoneAuthResult || '',
    needPhoneAuth: false,
    wxNickname: member.wxNickname || '',
    wxNickAsked: Boolean(member.wxNickAskedAt),
    wxNickResult: member.wxNickResult || '',
    needWxNick: false,
  };
}

async function touchWxEntry(openid) {
  if (!openid) return null;
  const now = new Date();
  const existing = await prisma.wxEntry.findUnique({ where: { openid } });
  if (existing) {
    return prisma.wxEntry.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: now,
        // 已忽略的再次进入重新进入待绑队列
        status: existing.status === 'ignored' ? 'pending' : existing.status,
      },
    });
  }
  return prisma.wxEntry.create({
    data: { openid, firstSeenAt: now, lastSeenAt: now, status: 'pending' },
  });
}

async function markWxEntryBound(openid, memberId) {
  if (!openid) return;
  const now = new Date();
  const existing = await prisma.wxEntry.findUnique({ where: { openid } });
  if (!existing) {
    await prisma.wxEntry.create({
      data: {
        openid,
        status: 'bound',
        boundMemberId: memberId,
        boundAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    return;
  }
  await prisma.wxEntry.update({
    where: { id: existing.id },
    data: {
      status: 'bound',
      boundMemberId: memberId,
      boundAt: now,
      lastSeenAt: now,
    },
  });
}

async function bindOpenidToMember(member, openid) {
  if (!openid) return member;
  if (member.openid && member.openid !== openid) {
    const err = new Error('该会员已绑定其他微信，请联系前沿社运营重置');
    err.status = 403;
    err.code = 'MEMBER_BOUND';
    err.phone = member.phone || '';
    throw err;
  }
  if (!member.openid) {
    const occupied = await prisma.member.findUnique({ where: { openid } });
    if (occupied && occupied.id !== member.id) {
      const err = new Error('该微信已绑定其他会员，请联系前沿社运营处理');
      err.status = 403;
      err.code = 'OPENID_BOUND';
      err.phone = member.phone || '';
      throw err;
    }
    return prisma.member.update({
      where: { id: member.id },
      data: { openid },
    });
  }
  return member;
}

/** 本地调试：会员 / 游客（默认关闭） */
router.post('/mock-login', async (req, res) => {
  if (!mockLoginAllowed()) {
    return res.status(404).json({ error: '接口不存在' });
  }
  try {
    const { phone, asVisitor } = req.body || {};
    if (asVisitor) {
      return res.json({
        status: 'visitor',
        openid: 'mock_visitor_openid',
        message: '该手机号未匹配到会员信息，请联系前沿社运营开通',
      });
    }
    if (!phone) return res.status(400).json({ error: '请提供手机号' });
    const member = await prisma.member.findUnique({ where: { phone: String(phone).trim() } });
    if (!member) {
      return res.json({
        status: 'visitor',
        openid: null,
        phone: String(phone).trim(),
        message: '该手机号未匹配到会员信息，请更换手机号重试，或联系前沿社运营开通',
      });
    }
    const token = signToken(member);
    res.json({ status: 'member', token, member: sanitizeMember(member) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '登录失败' });
  }
});

router.post('/admin-login', async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    if (!phone) return res.status(400).json({ error: '请输入手机号' });
    const member = await prisma.member.findUnique({ where: { phone: String(phone).trim() } });
    if (!member || !isStaff(member)) {
      return res.status(403).json({ error: '管理员账号不存在' });
    }
    if (hasAdminPassword(member)) {
      const ok = await verifyAdminPassword(member, password);
      if (!ok) return res.status(403).json({ error: '密码错误' });
    }
    const token = signToken(member);
    res.json({
      token,
      member: sanitizeMember(member),
      needSetPassword: !hasAdminPassword(member),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '登录失败' });
  }
});

/** 设置 / 修改后台登录密码（需已登录管理员） */
router.post('/admin-password', requireAdmin, async (req, res) => {
  try {
    const { password, oldPassword } = req.body || {};
    const fresh = await prisma.member.findUnique({ where: { id: req.member.id } });
    if (!fresh) return res.status(404).json({ error: '账号不存在' });
    if (hasAdminPassword(fresh)) {
      const ok = await verifyAdminPassword(fresh, oldPassword);
      if (!ok) return res.status(403).json({ error: '原密码错误' });
    }
    const adminPasswordHash = await hashAdminPassword(password);
    const updated = await prisma.member.update({
      where: { id: fresh.id },
      data: { adminPasswordHash },
    });
    res.json({ ok: true, member: sanitizeMember(updated) });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || '设置密码失败' });
  }
});

/**
 * 进入小程序：永远可进
 * - 已是会员：返回 token
 * - 非会员：返回 visitor（前端展示开通提示）
 */
router.post('/wechat-login', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: '缺少 code' });

    const openid = await codeToOpenid(code);
    const member = await prisma.member.findUnique({ where: { openid } });
    if (member) {
      const token = signToken(member);
      return res.json({ status: 'member', token, member: sanitizeMember(member) });
    }

    const entry = await touchWxEntry(openid);
    const nickOk = Boolean(entry?.wxNickname && entry?.nickAskedAt);
    if (nickOk) {
      const token = signVisitorToken({ openid, entryId: entry.id });
      return res.json({
        status: 'pending',
        token,
        openid,
        wxEntry: {
          id: entry.id,
          wxNickname: entry.wxNickname || '',
          nickAsked: true,
          status: entry.status,
        },
        message: '已进入前沿社，运营绑定会员后可使用「我的」。',
      });
    }

    return res.json({
      status: 'visitor',
      openid,
      wxEntry: entry
        ? {
            id: entry.id,
            wxNickname: entry.wxNickname || '',
            nickAsked: Boolean(entry.nickAskedAt),
            status: entry.status,
          }
        : null,
      message: '请选用微信昵称后进入。',
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || '微信登录失败', detail: err.detail });
  }
});

/**
 * 授权微信昵称后进入（待运营人工绑定会员；可先浏览动态/活动）
 * 可选 phoneCode：确认进入时拉起手机号，用户可拒绝；同意则写入 WxEntry.phone 方便运营识别。
 */
router.post('/bind-wx-nick', async (req, res) => {
  try {
    const { loginCode, nickname, phoneCode, mockOpenid, mockPhone } = req.body || {};
    const nick = String(nickname || '').trim().slice(0, 32);
    if (!nick) {
      return res.status(400).json({ error: '请填写微信昵称' });
    }

    let openid = null;
    if (mockOpenid && mockLoginAllowed()) {
      openid = String(mockOpenid);
    } else {
      if (!loginCode) return res.status(400).json({ error: '缺少登录凭证，请重试' });
      openid = await codeToOpenid(loginCode);
    }

    // 若该微信已是会员，直接进
    const existingMember = await prisma.member.findUnique({ where: { openid } });
    if (existingMember) {
      const token = signToken(existingMember);
      return res.json({
        status: 'member',
        token,
        member: sanitizeMember(existingMember),
      });
    }

    // 手机号可选：解码失败不阻断进入
    let phone = '';
    if (mockPhone && mockLoginAllowed()) {
      phone = String(mockPhone).replace(/\D/g, '').slice(-11);
    } else if (phoneCode) {
      try {
        phone = await phoneCodeToNumber(phoneCode);
      } catch (e) {
        console.warn('bind-wx-nick phone decode skipped', e?.message || e);
        phone = '';
      }
    }
    if (phone && !/^1\d{10}$/.test(phone)) phone = '';

    const now = new Date();
    let entry = await touchWxEntry(openid);
    entry = await prisma.wxEntry.update({
      where: { id: entry.id },
      data: {
        wxNickname: nick,
        ...(phone ? { phone } : {}),
        nickAskedAt: now,
        lastSeenAt: now,
        status: entry.status === 'ignored' ? 'pending' : entry.status,
      },
    });

    const token = signVisitorToken({ openid, entryId: entry.id });
    res.json({
      status: 'pending',
      token,
      openid,
      wxEntry: {
        id: entry.id,
        wxNickname: entry.wxNickname || '',
        phone: entry.phone || '',
        nickAsked: true,
        status: entry.status,
      },
      message: '已进入前沿社，运营绑定会员后可使用「我的」。',
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || '保存微信昵称失败',
      detail: err.detail,
    });
  }
});

/**
 * 手机号认证（昵称可选）：按手机号匹配会员库并绑定 openid，成功即可进入。
 * 微信已不支持一键拉取真实昵称，昵称尽力写入即可。
 */
router.post('/bind-wx-auth', async (req, res) => {
  try {
    const { loginCode, phoneCode, nickname, mockOpenid, mockPhone } = req.body || {};
    const nick = String(nickname || '').trim().slice(0, 32);

    let openid = null;
    let phone = null;
    if (mockOpenid && mockPhone && mockLoginAllowed()) {
      openid = String(mockOpenid);
      phone = String(mockPhone).trim();
    } else {
      if (!loginCode || !phoneCode) {
        return res.status(400).json({ error: '缺少授权参数' });
      }
      openid = await codeToOpenid(loginCode);
      phone = await phoneCodeToNumber(phoneCode);
    }

    if (!/^1\d{10}$/.test(phone)) {
      return res.status(400).json({ error: '手机号无效' });
    }

    const now = new Date();
    await touchWxEntry(openid);

    const member = await prisma.member.findUnique({ where: { phone } });
    if (!member) {
      // 未匹配：写入进入登记，方便运营在「微信进入」里人工绑
      const entry = await prisma.wxEntry.findUnique({ where: { openid } });
      if (entry) {
        await prisma.wxEntry.update({
          where: { id: entry.id },
          data: {
            wxNickname: nick,
            phone,
            nickAskedAt: now,
            lastSeenAt: now,
            status: entry.status === 'bound' ? 'pending' : entry.status,
            boundMemberId: null,
            boundAt: null,
          },
        });
      }
      return res.json({
        status: 'visitor',
        openid,
        phone,
        message: '该手机号未匹配到会员，请联系前沿社运营开通',
      });
    }

    let bound = await bindOpenidToMember(member, openid);
    bound = await prisma.member.update({
      where: { id: bound.id },
      data: {
        ...(nick
          ? { wxNickname: nick, wxNickAskedAt: now, wxNickResult: 'accept' }
          : { wxNickAskedAt: now, wxNickResult: nick ? 'accept' : 'reject' }),
        phoneAuthAskedAt: now,
        phoneAuthResult: 'accept',
      },
    });
    await markWxEntryBound(openid, bound.id);
    try {
      await prisma.wxEntry.updateMany({
        where: { openid },
        data: {
          ...(nick ? { wxNickname: nick, nickAskedAt: now } : { nickAskedAt: now }),
          phone,
        },
      });
    } catch {
      // ignore
    }

    const token = signToken(bound);
    res.json({ status: 'member', token, member: sanitizeMember(bound) });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || '认证失败',
      code: err.code,
      phone: err.phone || undefined,
      detail: err.detail,
    });
  }
});

/**
 * 兼容：旧版用户码认证（小程序已下线入口）
 */
router.post('/bind-invite', async (req, res) => {
  try {
    const { loginCode, inviteCode, mockOpenid } = req.body || {};
    const code = normalizeInviteCode(inviteCode);
    if (!code || code.length < 5) {
      return res.status(400).json({ error: '请输入有效用户码' });
    }

    let openid = null;
    if (mockOpenid && mockLoginAllowed()) {
      openid = String(mockOpenid);
    } else {
      if (!loginCode) return res.status(400).json({ error: '缺少登录凭证，请重试' });
      openid = await codeToOpenid(loginCode);
    }

    const member = await prisma.member.findUnique({ where: { inviteCode: code } });
    if (!member) {
      return res.json({
        status: 'visitor',
        openid,
        message: '用户码无效，请核对后重试，或联系前沿社运营',
      });
    }

    const bound = await bindOpenidToMember(member, openid);
    await markWxEntryBound(openid, bound.id);
    const token = signToken(bound);
    res.json({ status: 'member', token, member: sanitizeMember(bound) });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || '认证失败',
      code: err.code,
      phone: err.phone || undefined,
      detail: err.detail,
    });
  }
});

/**
 * 兼容：旧版手机号补全（小程序已改走 /wx-profile）
 */
router.post('/phone-profile', requireAuth, async (req, res) => {
  try {
    const member = req.member;
    const { phoneCode, declined } = req.body || {};
    const now = new Date();

    if (declined || !phoneCode) {
      const updated = await prisma.member.update({
        where: { id: member.id },
        data: {
          phoneAuthAskedAt: member.phoneAuthAskedAt || now,
          phoneAuthResult: member.phoneAuthResult === 'accept' ? 'accept' : 'reject',
        },
      });
      return res.json({
        ok: true,
        result: 'reject',
        member: sanitizeMember(updated),
      });
    }

    const phone = await phoneCodeToNumber(phoneCode);
    if (!/^1\d{10}$/.test(phone)) {
      return res.status(400).json({ error: '手机号无效' });
    }

    const merged = mergePhoneIntoMember(member, phone);
    const data = {
      phoneAuthAskedAt: now,
      phoneAuthResult: 'accept',
    };
    if (merged.kind === 'primary') {
      const occupied = await prisma.member.findUnique({ where: { phone } });
      if (occupied && occupied.id !== member.id) {
        // 主号冲突：记备号，不覆盖他人主号
        const extras = parsePhonesExtra(member.phonesExtra);
        if (!extras.includes(phone)) data.phonesExtra = stringifyPhonesExtra([...extras, phone]);
      } else {
        data.phone = phone;
      }
    } else if (merged.kind === 'extra') {
      data.phonesExtra = merged.phonesExtra;
    }

    const updated = await prisma.member.update({
      where: { id: member.id },
      data,
    });
    res.json({ ok: true, result: 'accept', member: sanitizeMember(updated) });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || '保存手机号失败',
      detail: err.detail,
    });
  }
});

/**
 * 兼容旧版：微信手机号绑定（保留，新流程走 /bind-invite）
 */
router.post('/bind-phone', async (req, res) => {
  try {
    const { loginCode, phoneCode, mockPhone } = req.body || {};
    let openid = null;
    let phone = null;

    if (mockPhone) {
      if (!mockLoginAllowed()) {
        return res.status(403).json({ error: '不允许 mock 绑号' });
      }
      phone = String(mockPhone).trim();
      openid = req.body.openid || 'mock_bound_openid';
    } else {
      if (!loginCode || !phoneCode) {
        return res.status(400).json({ error: '缺少授权参数' });
      }
      openid = await codeToOpenid(loginCode);
      phone = await phoneCodeToNumber(phoneCode);
    }

    if (!/^1\d{10}$/.test(phone)) {
      return res.status(400).json({ error: '手机号无效' });
    }

    const member = await prisma.member.findUnique({ where: { phone } });
    if (!member) {
      return res.json({
        status: 'visitor',
        openid,
        phone,
        message: '该手机号未匹配到会员信息，请更换手机号重试，或联系前沿社运营开通',
      });
    }

    const bound = await bindOpenidToMember(member, openid);
    const token = signToken(bound);
    res.json({ status: 'member', token, member: sanitizeMember(bound) });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || '绑定失败',
      code: err.code,
      phone: err.phone || undefined,
      detail: err.detail,
    });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ member: sanitizeMember(req.member) });
});

/**
 * 同步会话：待绑定访客若已被运营绑成会员，当场换发正式 token（无需重进小程序）
 */
router.get('/sync', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: '未登录' });

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret());
    } catch {
      return res.status(401).json({ error: '登录已失效' });
    }

    if (payload.role === 'visitor') {
      const entry = await prisma.wxEntry.findUnique({
        where: { id: String(payload.entryId || '') },
      });
      if (!entry || entry.openid !== payload.openid) {
        return res.status(401).json({ error: '登录已失效，请重新进入' });
      }

      const bound = await prisma.member.findUnique({ where: { openid: entry.openid } });
      if (bound) {
        if (bound.status === 'expired' && !isStaff(bound)) {
          return res.json({
            status: 'expired',
            token: signToken(bound),
            member: sanitizeMember(bound),
            message: '会员已过期，可继续浏览；续期后可报名与投票。',
          });
        }
        if (bound.status !== 'active' && !isStaff(bound)) {
          return res.json({
            status: 'inactive',
            member: sanitizeMember(bound),
            message: '会员状态待更新，请联系前沿社运营确认后再试。',
          });
        }
        return res.json({
          status: 'member',
          promoted: true,
          token: signToken(bound),
          member: sanitizeMember(bound),
        });
      }

      return res.json({
        status: 'pending',
        openid: entry.openid,
        wxEntry: {
          id: entry.id,
          wxNickname: entry.wxNickname || '',
          phone: entry.phone || '',
          nickAsked: Boolean(entry.nickAskedAt),
          status: entry.status,
        },
        message: '已进入前沿社，运营绑定会员后可使用「我的」。',
      });
    }

    const member = await prisma.member.findUnique({ where: { id: payload.id } });
    if (!member) return res.status(401).json({ error: '登录已失效，请重新登录' });
    const tokenOpenid = payload.openid ? String(payload.openid) : '';
    if (tokenOpenid && String(member.openid || '') !== tokenOpenid) {
      return res.status(401).json({ error: '微信已解绑，请重新进入' });
    }
    if (member.status === 'expired' && !isStaff(member)) {
      return res.json({
        status: 'expired',
        token,
        member: sanitizeMember(member),
        message: '会员已过期，可继续浏览；续期后可报名与投票。',
      });
    }
    if (member.status !== 'active' && !isStaff(member)) {
      return res.json({
        status: 'inactive',
        member: sanitizeMember(member),
        message: '会员状态待更新，请联系前沿社运营确认后再试。',
      });
    }
    return res.json({
      status: 'member',
      promoted: false,
      token,
      member: sanitizeMember(member),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '同步会话失败' });
  }
});

export default router;

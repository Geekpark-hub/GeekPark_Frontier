import { Router } from 'express';
import { prisma } from '../prisma.js';
import { isStaff, requireAuth, signToken } from '../middleware/auth.js';
import { resolveAdminMenus } from '../menus.js';
import { codeToOpenid, phoneCodeToNumber } from '../wx.js';

const router = Router();

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
      ? ['members', 'users', 'feed', 'polls', 'events', 'requests', 'analytics', 'ai']
      : [];
  }
  return {
    id: member.id,
    openid: member.openid,
    name: member.name,
    company: member.company,
    title: member.title,
    phone: member.phone,
    status: member.status,
    expiresAt: member.expiresAt,
    isAdmin: isStaff(member),
    isSuperAdmin: Boolean(member.isSuperAdmin),
    adminMenus,
    linkedin: member.linkedin,
    wechatMp: member.wechatMp,
    xAccount: member.xAccount,
    youtube: member.youtube,
    bilibili: member.bilibili,
  };
}

async function bindOpenidToMember(member, openid) {
  if (!openid) return member;
  if (member.openid && member.openid !== openid) {
    const err = new Error('该会员已绑定其他微信，请联系运营重置');
    err.status = 403;
    err.code = 'PHONE_BOUND';
    throw err;
  }
  if (!member.openid) {
    const occupied = await prisma.member.findUnique({ where: { openid } });
    if (occupied && occupied.id !== member.id) {
      const err = new Error('该微信已绑定其他会员');
      err.status = 403;
      err.code = 'OPENID_BOUND';
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
        message: '该手机号未匹配到会员信息',
      });
    }
    if (!phone) return res.status(400).json({ error: '请提供手机号' });
    const member = await prisma.member.findUnique({ where: { phone: String(phone).trim() } });
    if (!member) {
      return res.json({
        status: 'visitor',
        openid: null,
        phone: String(phone).trim(),
        message: '该手机号未匹配到会员信息，请更换手机号重试或联系运营',
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
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: '请输入手机号' });
    const member = await prisma.member.findUnique({ where: { phone: String(phone).trim() } });
    if (!member || !isStaff(member)) {
      return res.status(403).json({ error: '管理员账号不存在' });
    }
    const token = signToken(member);
    res.json({ token, member: sanitizeMember(member) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '登录失败' });
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
    if (!member) {
      return res.json({
        status: 'visitor',
        openid,
        message: '授权手机号后将匹配会员信息，未匹配可联系运营开通。',
      });
    }

    const token = signToken(member);
    res.json({ status: 'member', token, member: sanitizeMember(member) });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || '微信登录失败', detail: err.detail });
  }
});

/**
 * 用户主动授权微信手机号后：
 * 用手机号匹配会员库，匹配成功则绑定 openid
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
        message: '该手机号未匹配到会员信息，请更换手机号重试或联系运营',
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
      detail: err.detail,
    });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ member: sanitizeMember(req.member) });
});

export default router;

import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';
import { hasMenuAccess } from '../menus.js';

/** 每次读取，避免模块加载早于 dotenv 时落到默认 secret */
function jwtSecret() {
  return process.env.JWT_SECRET || 'dev-secret';
}

export function isStaff(member) {
  return Boolean(member?.isAdmin || member?.isSuperAdmin);
}

/** 已通过 requireAdmin 后，再校验菜单权限 */
export function requireMenu(menuKey) {
  return (req, res, next) => {
    if (!hasMenuAccess(req.member, menuKey)) {
      return res.status(403).json({ error: '无此菜单权限' });
    }
    next();
  };
}

export function signToken(member) {
  return jwt.sign(
    {
      id: member.id,
      openid: member.openid,
      isAdmin: isStaff(member),
      isSuperAdmin: Boolean(member.isSuperAdmin),
    },
    jwtSecret(),
    { expiresIn: '30d' }
  );
}

/** 已填微信昵称、待运营绑定的访客会话 */
export function signVisitorToken({ openid, entryId }) {
  return jwt.sign(
    {
      role: 'visitor',
      openid,
      entryId,
    },
    jwtSecret(),
    { expiresIn: '30d' }
  );
}

function wantsHtmlPage(req) {
  // 仅地址栏导航（Accept 含 text/html 且不含 application/json）
  const accept = String(req.headers.accept || '');
  return accept.includes('text/html') && !accept.includes('application/json');
}

function unauthorized(req, res, message = '未登录') {
  if (wantsHtmlPage(req)) {
    return res.redirect(302, '/login');
  }
  return res.status(401).json({ error: message });
}

/**
 * 微信会话 token 会带 openid；运营解绑/删微信进入后 member.openid 清空或变更，
 * 必须让旧 token 立刻失效，否则小程序本地登录态会残留。
 */
function wechatBindingStillValid(payload, member) {
  const tokenOpenid = payload?.openid ? String(payload.openid) : '';
  if (!tokenOpenid) return true;
  return String(member?.openid || '') === tokenOpenid;
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return unauthorized(req, res, '未登录');
    }
    const payload = jwt.verify(token, jwtSecret());
    if (payload.role === 'visitor') {
      return unauthorized(req, res, '请等待运营开通会员后使用');
    }
    const member = await prisma.member.findUnique({ where: { id: payload.id } });
    if (!member) {
      return unauthorized(req, res, '登录已失效，请重新登录');
    }
    if (!wechatBindingStillValid(payload, member)) {
      return unauthorized(req, res, '微信已解绑，请重新进入');
    }
    // 过期会员仍可持有会话做只读浏览；写操作走 requireActiveMember
    req.member = member;
    next();
  } catch {
    return unauthorized(req, res, '登录已失效');
  }
}

export async function requireActiveMember(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.member.status === 'expired' && !isStaff(req.member)) {
      return res.status(403).json({ error: '会员已过期，请联系运营续期' });
    }
    if (req.member.status !== 'active' && !isStaff(req.member)) {
      return res.status(403).json({ error: '会员状态不可用，请联系运营团队' });
    }
    next();
  });
}

/** 已绑定会员可读（含过期）；待绑访客不可进。用于内参等保密内容 */
export async function requireBoundMember(req, res, next) {
  await requireAuth(req, res, () => {
    if (isStaff(req.member)) return next();
    if (req.member.status === 'active' || req.member.status === 'expired') return next();
    return res.status(403).json({ error: '会员状态不可用，请联系运营团队' });
  });
}

/**
 * 正式会员或已填昵称的待绑访客（只读浏览用）
 */
export async function requireMemberOrVisitor(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return unauthorized(req, res, '未登录');
    }
    const payload = jwt.verify(token, jwtSecret());
    if (payload.role === 'visitor') {
      const entry = await prisma.wxEntry.findUnique({
        where: { id: String(payload.entryId || '') },
      });
      if (!entry || entry.openid !== payload.openid) {
        return unauthorized(req, res, '登录已失效，请重新登录');
      }
      if (!entry.wxNickname || !entry.nickAskedAt) {
        return res.status(403).json({ error: '请先选用微信昵称' });
      }
      // 若运营已绑到会员，提示前端换正式会话
      const bound = await prisma.member.findUnique({ where: { openid: entry.openid } });
      if (bound && bound.status === 'active') {
        req.member = bound;
        req.visitor = null;
        req.promotedMember = true;
        return next();
      }
      req.member = null;
      req.visitor = entry;
      return next();
    }

    const member = await prisma.member.findUnique({ where: { id: payload.id } });
    if (!member) {
      return unauthorized(req, res, '登录已失效，请重新登录');
    }
    if (!wechatBindingStillValid(payload, member)) {
      return unauthorized(req, res, '微信已解绑，请重新进入');
    }
    // 过期：可浏览动态/活动/投票详情；报名投票仍需 active
    if (member.status === 'expired' && !isStaff(member)) {
      req.member = member;
      req.visitor = null;
      return next();
    }
    if (member.status !== 'active' && !isStaff(member)) {
      return res.status(403).json({ error: '会员状态不可用，请联系运营团队' });
    }
    req.member = member;
    req.visitor = null;
    next();
  } catch {
    return unauthorized(req, res, '登录已失效');
  }
}

export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!isStaff(req.member)) {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
  });
}

export async function requireSuperAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.member.isSuperAdmin) {
      return res.status(403).json({ error: '需要超级管理员权限' });
    }
    next();
  });
}

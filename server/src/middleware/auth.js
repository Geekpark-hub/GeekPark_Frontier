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

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: '未登录' });
    }
    const payload = jwt.verify(token, jwtSecret());
    const member = await prisma.member.findUnique({ where: { id: payload.id } });
    if (!member) {
      return res.status(401).json({ error: '登录已失效，请重新登录' });
    }
    if (member.status === 'expired' && !isStaff(member)) {
      return res.status(403).json({ error: '会员已过期，请联系运营团队' });
    }
    req.member = member;
    next();
  } catch {
    return res.status(401).json({ error: '登录已失效' });
  }
}

export async function requireActiveMember(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.member.status !== 'active' && !isStaff(req.member)) {
      return res.status(403).json({ error: '会员状态不可用，请联系运营团队' });
    }
    next();
  });
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

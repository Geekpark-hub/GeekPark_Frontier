/** 与 server/src/menus.js 保持一致 */
export const ADMIN_MENUS = [
  { key: 'members', label: '会员管理', path: '/members' },
  { key: 'wx-entries', label: '微信进入', path: '/wx-entries' },
  { key: 'users', label: '用户管理', path: '/users' },
  { key: 'feed', label: '动态管理', path: '/feed' },
  { key: 'briefs', label: '内参管理', path: '/briefs' },
  { key: 'polls', label: '投票管理', path: '/polls' },
  { key: 'events', label: '活动管理', path: '/events' },
  { key: 'requests', label: '需求管理', path: '/requests' },
  { key: 'analytics', label: '活跃分析', path: '/analytics' },
  { key: 'notify', label: '消息中心', path: '/notify' },
  { key: 'audit', label: '操作记录', path: '/audit', superOnly: true },
  { key: 'ai', label: 'AI 与任务', path: '/ai' },
  { key: 'sources', label: '信息源', path: '/sources' },
];

/** 用户管理里可勾选的菜单（不含超管专属） */
export const ASSIGNABLE_MENUS = ADMIN_MENUS.filter((m) => !m.superOnly);

export function memberMenus(member) {
  if (!member) return [];
  if (member.isSuperAdmin) return ADMIN_MENUS.map((m) => m.key);
  const menus = Array.isArray(member.adminMenus) ? member.adminMenus : [];
  const assignable = new Set(ASSIGNABLE_MENUS.map((m) => m.key));
  if (!menus.length && member.isAdmin) return [...assignable];
  const allowed = menus.filter((k) => assignable.has(k));
  if (allowed.includes('ai') && !allowed.includes('sources')) allowed.push('sources');
  if (allowed.includes('members') && !allowed.includes('wx-entries')) allowed.push('wx-entries');
  return allowed;
}

export function canAccessMenu(member, key) {
  const meta = ADMIN_MENUS.find((m) => m.key === key);
  if (meta?.superOnly) return Boolean(member?.isSuperAdmin);
  return memberMenus(member).includes(key);
}

export function firstAllowedPath(member) {
  const menus = memberMenus(member);
  const hit = ADMIN_MENUS.find((m) => menus.includes(m.key));
  return hit?.path || '/login';
}

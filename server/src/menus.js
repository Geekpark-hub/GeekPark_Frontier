/** 后台菜单权限键（与 admin 前端 nav 一致） */
export const ADMIN_MENUS = [
  { key: 'members', label: '会员管理' },
  { key: 'users', label: '用户管理' },
  { key: 'feed', label: '动态管理' },
  { key: 'polls', label: '投票管理' },
  { key: 'events', label: '活动管理' },
  { key: 'requests', label: '需求管理' },
  { key: 'analytics', label: '活跃分析', superOnly: true },
  { key: 'ai', label: 'AI 与任务' },
];

export const ADMIN_MENU_KEYS = ADMIN_MENUS.map((m) => m.key);

/** 可分配给普通管理员的菜单（不含超管专属） */
export const ASSIGNABLE_MENU_KEYS = ADMIN_MENUS.filter((m) => !m.superOnly).map((m) => m.key);

export function parseAdminMenus(raw) {
  if (Array.isArray(raw)) {
    return raw.map(String).filter((k) => ASSIGNABLE_MENU_KEYS.includes(k));
  }
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).filter((k) => ASSIGNABLE_MENU_KEYS.includes(k));
  } catch {
    return [];
  }
}

export function serializeAdminMenus(menus) {
  return JSON.stringify(parseAdminMenus(menus));
}

/**
 * 解析账号可用菜单。
 * - 超管：全部（含活跃分析）
 * - 普通管理员且未配置（空数组）：兼容旧数据，视为全部可分配菜单（不含超管专属）
 * - 已配置：按列表（仍剔除超管专属）
 */
export function resolveAdminMenus(member) {
  if (!member) return [];
  if (member.isSuperAdmin) return [...ADMIN_MENU_KEYS];
  if (!member.isAdmin && !member.isSuperAdmin) return [];
  const menus = parseAdminMenus(member.adminMenus);
  if (!menus.length) return [...ASSIGNABLE_MENU_KEYS];
  return menus;
}

export function hasMenuAccess(member, menuKey) {
  if (!menuKey) return true;
  const meta = ADMIN_MENUS.find((m) => m.key === menuKey);
  if (meta?.superOnly && !member?.isSuperAdmin) return false;
  return resolveAdminMenus(member).includes(menuKey);
}

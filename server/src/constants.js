/** 根超级管理员手机号：不可删除、不可取消超管、不可改绑手机号 */
export const ROOT_SUPER_ADMIN_PHONE = '17611294568';

export function isRootSuperAdmin(memberOrPhone) {
  const phone =
    typeof memberOrPhone === 'string'
      ? memberOrPhone
      : memberOrPhone?.phone;
  return String(phone || '').trim() === ROOT_SUPER_ADMIN_PHONE;
}

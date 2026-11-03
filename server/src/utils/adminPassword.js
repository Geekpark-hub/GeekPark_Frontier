import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export function hasAdminPassword(member) {
  return Boolean(member && String(member.adminPasswordHash || '').trim());
}

export async function hashAdminPassword(plain) {
  const s = String(plain || '');
  if (s.length < 6) {
    const err = new Error('密码至少 6 位');
    err.status = 400;
    throw err;
  }
  if (s.length > 72) {
    const err = new Error('密码过长');
    err.status = 400;
    throw err;
  }
  return bcrypt.hash(s, ROUNDS);
}

export async function verifyAdminPassword(member, plain) {
  const hash = String(member?.adminPasswordHash || '').trim();
  if (!hash) return true;
  return bcrypt.compare(String(plain || ''), hash);
}

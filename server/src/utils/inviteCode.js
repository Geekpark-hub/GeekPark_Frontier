import { pinyin } from 'pinyin-pro';
import { prisma } from '../prisma.js';

/** 固定后缀：姓名拼音首字母 + 1703，如 YYF1703 */
export const INVITE_CODE_SUFFIX = '1703';

/** 去掉易混字符 0O1IL（仅作兜底随机码） */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomInviteCode(len = 8) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function normalizeInviteCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-]/g, '');
}

/** 真名 → 拼音首字母大写，如 俞永福 → YYF */
export function nameToInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const parts = pinyin(s, {
    pattern: 'first',
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  });
  const letters = (Array.isArray(parts) ? parts : [parts])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return letters.slice(0, 8);
}

export function buildInviteCodeFromName(name, attempt = 0) {
  const initials = nameToInitials(name) || 'M';
  const base = `${initials}${INVITE_CODE_SUFFIX}`;
  if (attempt <= 0) return base;
  if (attempt <= 26) return `${base}${String.fromCharCode(64 + attempt)}`; // A..Z
  return `${base}${attempt}`;
}

/**
 * 按姓名生成唯一用户码
 * @param {string} [memberName]
 * @param {string} [excludeMemberId] 换码时排除自己
 */
export async function allocateInviteCode(memberName = '', excludeMemberId = '') {
  const name = String(memberName || '').trim();
  if (name) {
    for (let i = 0; i < 40; i++) {
      const code = buildInviteCodeFromName(name, i);
      const hit = await prisma.member.findUnique({
        where: { inviteCode: code },
        select: { id: true },
      });
      if (!hit || (excludeMemberId && hit.id === excludeMemberId)) return code;
    }
  }
  for (let i = 0; i < 12; i++) {
    const code = randomInviteCode(8);
    const hit = await prisma.member.findUnique({ where: { inviteCode: code }, select: { id: true } });
    if (!hit) return code;
  }
  for (let i = 0; i < 8; i++) {
    const code = randomInviteCode(10);
    const hit = await prisma.member.findUnique({ where: { inviteCode: code }, select: { id: true } });
    if (!hit) return code;
  }
  throw new Error('无法生成唯一用户码，请重试');
}

/** 缺码会员补发（编辑页/列表展示前调用） */
export async function ensureMemberInviteCode(member) {
  if (!member) return member;
  if (member.inviteCode) return member;
  const inviteCode = await allocateInviteCode(member.name, member.id);
  return prisma.member.update({
    where: { id: member.id },
    data: { inviteCode },
  });
}

/** 列表/详情展示用脱敏；编辑表单仍用原始值提交 */

export function maskPhone(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^1\d{10}$/.test(s)) return `${s.slice(0, 3)}****${s.slice(7)}`;
  if (s.length <= 4) return '****';
  if (s.length <= 7) return `${s.slice(0, 2)}****`;
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** 用户码列表展示：前 2 后 2，中间打码；复制仍用原文 */
export function maskInviteCode(value) {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return '';
  if (s.length <= 4) return '****';
  if (s.length <= 6) return `${s.slice(0, 1)}****${s.slice(-1)}`;
  return `${s.slice(0, 2)}****${s.slice(-2)}`;
}

export function maskIp(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  if (s.includes(':')) {
    const head = s.split(':').filter(Boolean)[0] || '';
    return head ? `${head}:****` : '****';
  }
  if (s.length <= 4) return '****';
  return `${s.slice(0, 2)}****`;
}

/** 文本中的手机号 / IPv4 一并打码（用于审计 body、UA 旁注等） */
export function maskSensitiveText(value) {
  return String(value ?? '')
    .replace(/1\d{10}/g, (m) => maskPhone(m))
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, (m) => maskIp(m));
}

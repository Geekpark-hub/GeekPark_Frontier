const BLOCKED_HOSTS = new Set([
  'example.com',
  'example.org',
  'localhost',
  '127.0.0.1',
]);

const BLOCKED_HOST_PARTS = [
  'eoffcn.com',
  'myzaker.com', // 聚合页易失效
  'xn--', // punycode 垃圾站常见
];

const SPAM_HINTS = [
  '体育博彩',
  '澳门',
  '赌场',
  '威尼斯人',
  '加拿大28',
  '色情',
  '兼职刷单',
  '贷款口子',
];

export function isBlockedSourceUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (!/^https?:$/i.test(u.protocol)) return true;
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return true;
    if (BLOCKED_HOSTS.has(host.replace(/^www\./, ''))) return true;
    if (BLOCKED_HOST_PARTS.some((p) => host.includes(p))) return true;
    return false;
  } catch {
    return true;
  }
}

export function looksLikeSpamText(...texts) {
  const blob = texts.filter(Boolean).join(' ').toLowerCase();
  return SPAM_HINTS.some((h) => blob.includes(h.toLowerCase()));
}

/**
 * 轻量可达性检查：能拿到 2xx/3xx 视为可用；超时/4xx/5xx 视为失效。
 */
export async function isReachableUrl(url, { timeoutMs = 6000 } = {}) {
  if (!url || isBlockedSourceUrl(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'FrontierSocietyBot/1.0' },
    });
    // 部分站点不支持 HEAD
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'FrontierSocietyBot/1.0' },
      });
    }
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

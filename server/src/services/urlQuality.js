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

/** 栏目/标签/列表页：不是单篇新闻，易被 LLM 误写成「持续更新专栏」 */
const LISTING_PATH_RE =
  /\/(column|columns|tag|tags|category|categories|topic|topics|channel|channels|author|authors|search|list|lists|archive|archives)(\/|$)/i;

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

const EVERGREEN_HINTS = [
  '持续更新',
  '专栏更新',
  '往期回顾',
  '最新文章列表',
  '栏目列表',
  '综合报道',
];

export function isBlockedSourceUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (!/^https?:$/i.test(u.protocol)) return true;
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return true;
    if (BLOCKED_HOSTS.has(host.replace(/^www\./, ''))) return true;
    if (BLOCKED_HOST_PARTS.some((p) => host.includes(p))) return true;
    if (isListingOrIndexUrl(u)) return true;
    return false;
  } catch {
    return true;
  }
}

/** 列表/栏目/标签页，不应作为单条动态来源 */
export function isListingOrIndexUrl(input) {
  try {
    const u = input instanceof URL ? input : new URL(String(input || '').trim());
    const path = u.pathname || '/';
    if (path === '/' || path === '') return true;
    if (LISTING_PATH_RE.test(path)) return true;
    // /column/179 这类数字栏目 ID
    if (/\/column\/\d+\/?$/i.test(path)) return true;
    return false;
  } catch {
    return true;
  }
}

export function looksLikeSpamText(...texts) {
  const blob = texts.filter(Boolean).join(' ').toLowerCase();
  return SPAM_HINTS.some((h) => blob.includes(h.toLowerCase()));
}

/** 常青/列表口吻：不是一条可发布的时效动态 */
export function looksLikeEvergreenText(...texts) {
  const blob = texts.filter(Boolean).join('');
  return EVERGREEN_HINTS.some((h) => blob.includes(h));
}

/**
 * LLM 通过后的硬校验：标题/正文必须能对上人名或公司名，且不能是常青栏目话术。
 */
export function postRefineRejectReason({ member, item, refined }) {
  const name = String(member?.name || '').trim();
  const company = String(member?.company || '').trim();
  const blob = `${refined?.title || ''} ${refined?.content || ''} ${refined?.reason || ''}`;
  const sourceBlob = `${item?.title || ''} ${item?.snippet || ''} ${item?.url || ''}`;

  if (looksLikeEvergreenText(blob, sourceBlob)) {
    return '疑似栏目/常青内容，非单条时效动态';
  }
  if (isListingOrIndexUrl(item?.url)) {
    return '来源是栏目或列表页';
  }

  const hitName = name && blob.includes(name);
  const hitCompany = company && blob.includes(company);
  if (!hitName && !hitCompany) {
    return '改写结果未明确出现会员姓名或公司名';
  }

  // 正文声称「某某专栏」但 URL 是栏目列表时，上面 listing 已拦；再防 snippet 误导
  if (/专栏/.test(blob) && /持续|更新中|定期/.test(blob) && !/(融资|发布|合作|任命|上市|融资|启动|宣布)/.test(blob)) {
    return '疑似把专栏入口写成动态';
  }
  return null;
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

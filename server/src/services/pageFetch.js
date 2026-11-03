/**
 * 抓取候选链接正文，供 LLM 核验（避免只看搜索摘要脑补）。
 * 不引入重型可读性库：去标签 + 截断即可。
 */

const LISTING_TITLE_HINTS = [
  '综合报道',
  '最新文章',
  '文章列表',
  '专题汇总',
  '搜索结果',
  'Tag:',
  '标签：',
];

const LISTING_BODY_HINTS = [
  '共找到',
  '搜索结果',
  '文章列表',
];

function metaContent(html, names) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      'i'
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      'i'
    );
    const m = html.match(re) || html.match(re2);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return '';
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function extractTitle(html) {
  const og = metaContent(html, ['og:title', 'twitter:title']);
  if (og) return og.slice(0, 200);
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

function extractCanonicalUrl(html, baseUrl) {
  const og = metaContent(html, ['og:url']);
  const linkMatch =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const raw = og || linkMatch?.[1] || '';
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch {
    return String(raw).trim();
  }
}

function pushDateCandidate(list, raw) {
  const s = String(raw || '').trim();
  if (!s || list.includes(s)) return;
  list.push(s);
}

const RELATIVE_DATE_RE =
  /(?:(\d+|半|几)\s*个?\s*(秒|分钟|分|小时|钟头|天|日|周|星期|月|年)\s*前|昨天|前天|刚刚|刚才|今天)/;

/** 源站常见中文相对时间：「6个月前」「几天前」「昨天」 */
function parseChineseRelativeDate(text, now = new Date()) {
  const s = String(text || '').replace(/\s+/g, '').trim();
  if (!s) return null;
  if (/^(刚刚|刚才|今天)$/.test(s)) return new Date(now);
  if (s === '昨天') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }
  if (s === '前天') {
    const d = new Date(now);
    d.setDate(d.getDate() - 2);
    return d;
  }
  const m = s.match(/^(\d+|半|几)个?(秒|分钟|分|小时|钟头|天|日|周|星期|月|年)前$/);
  if (!m) return null;
  const rawAmt = m[1];
  const unit = m[2];
  let amount =
    rawAmt === '半' ? 0.5 : rawAmt === '几' ? 3 : Number(rawAmt);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const d = new Date(now);
  switch (unit) {
    case '秒':
      d.setSeconds(d.getSeconds() - amount);
      break;
    case '分钟':
    case '分':
      d.setMinutes(d.getMinutes() - amount);
      break;
    case '小时':
    case '钟头':
      d.setHours(d.getHours() - amount);
      break;
    case '天':
    case '日':
      d.setDate(d.getDate() - Math.round(amount));
      break;
    case '周':
    case '星期':
      d.setDate(d.getDate() - Math.round(amount * 7));
      break;
    case '月':
      d.setMonth(d.getMonth() - Math.round(amount));
      break;
    case '年':
      d.setFullYear(d.getFullYear() - Math.round(amount));
      break;
    default:
      return null;
  }
  return d;
}

function firstValidIso(candidates) {
  for (const raw of candidates) {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const t = d.getTime();
    if (t < Date.parse('2000-01-01') || t > Date.now() + 2 * 86400000) continue;
    return d.toISOString();
  }
  return null;
}

/** 从作者旁/文章信息区读相对时间，避开侧栏与下一篇 */
function extractRelativePublishedAt(html) {
  let scoped = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(aside|nav|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/class=["'][^"']*next-article[^"']*["'][\s\S]{0,500}/gi, ' ');

  const zoneRes = [
    /<(?:div|p|ul)[^>]*class=["'][^"']*(?:article-info|entry-meta|post-meta|article-meta|byline|meta-info|news-info)[^"']*["'][^>]*>[\s\S]{0,900}/gi,
    /<(?:span|div|p|time)[^>]*class=["'][^"']*(?:date|addtime|time|pubtime|publish-?time|meta-?time)[^"']*["'][^>]*>[\s\S]{0,80}/gi,
    /<time(?![^>]*datetime=)[^>]*>[\s\S]{0,40}/gi,
  ];

  const tryZone = (chunk) => {
    const text = decodeEntities(String(chunk || '').replace(/<[^>]+>/g, ' '));
    const m = text.match(RELATIVE_DATE_RE);
    if (!m) return null;
    return parseChineseRelativeDate(m[0]);
  };

  for (const re of zoneRes) {
    const blocks = scoped.match(re) || [];
    for (const block of blocks) {
      if (/next-article|related|recommend|hot-list|sidebar/i.test(block)) continue;
      const d = tryZone(block);
      if (d) return d.toISOString();
    }
  }

  // 作者行旁的裸相对时间：…作者… · </span><span>6个月前</span>
  const byline =
    scoped.match(
      /author[\s\S]{0,240}?(?:(\d+|半|几)\s*个?\s*(秒|分钟|分|小时|钟头|天|日|周|星期|月|年)\s*前|昨天|前天)/i
    ) ||
    scoped
      .slice(0, 20000)
      .match(/(?:(\d+|半|几)\s*个?\s*(秒|分钟|分|小时|钟头|天|日|周|星期|月|年)\s*前|昨天|前天)/);
  if (byline) {
    const token = byline[0].match(RELATIVE_DATE_RE)?.[0];
    const d = parseChineseRelativeDate(token);
    if (d) return d.toISOString();
  }
  return null;
}

/** 只采信源站发布时间（结构化绝对时间 + 文章信息区相对时间），不从正文叙述里猜 */
function extractPublishedAt(html) {
  const candidates = [];
  for (const name of [
    'article:published_time',
    'article:published',
    'og:article:published_time',
    'og:published_time',
    'publishdate',
    'pubdate',
    'publication_date',
    'sailthru.date',
    'datePublished',
  ]) {
    pushDateCandidate(candidates, metaContent(html, [name]));
  }

  const ldBlocks =
    String(html || '').match(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ) || [];
  const modified = [];
  for (const block of ldBlocks) {
    const raw = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data)
        ? data
        : [data, ...((data && data['@graph']) || [])];
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        pushDateCandidate(candidates, n.datePublished);
        pushDateCandidate(candidates, n.pubDate);
        pushDateCandidate(candidates, n.uploadDate);
        pushDateCandidate(candidates, n.dateCreated);
        pushDateCandidate(modified, n.dateModified);
      }
    } catch {
      /* ignore bad json-ld */
    }
  }

  // 部分站点（如极客公园）把发布时间嵌在页面 JSON 里
  const embedded =
    String(html || '').matchAll(
      /"(?:published_at|publish_time|pubDate|datePublished)"\s*:\s*"([^"]+)"/gi
    ) || [];
  for (const m of embedded) {
    if (m?.[1]) pushDateCandidate(candidates, m[1]);
  }

  const timeTags = String(html || '').match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/gi) || [];
  for (const tag of timeTags) {
    const m = tag.match(/datetime=["']([^"']+)["']/i);
    if (m?.[1]) pushDateCandidate(candidates, m[1]);
  }

  const fromAbs = firstValidIso(candidates);
  if (fromAbs) return fromAbs;

  // 无发布字段时，退而用修改时间（如 PKUVC JSON-LD 只有 dateModified）
  const fromModified = firstValidIso(modified);
  if (fromModified) return fromModified;

  return extractRelativePublishedAt(html);
}

/** 源站发布时间优先：页面 meta > RSS/搜索条目时间 */
export function pickSourcePublishedAt(...values) {
  for (const v of values) {
    if (!v) continue;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) continue;
    const t = d.getTime();
    if (t < Date.parse('2000-01-01') || t > Date.now() + 2 * 86400000) continue;
    return d;
  }
  return null;
}

function looksLikeListingPage({ title, text, html }) {
  // 有文章元数据 → 优先当单篇
  const ogType = metaContent(html, ['og:type']).toLowerCase();
  const hasArticleMeta =
    ogType === 'article' ||
    Boolean(metaContent(html, ['article:published_time', 'pubdate', 'publishdate']));
  if (hasArticleMeta) return false;

  if (LISTING_TITLE_HINTS.some((h) => title.includes(h))) return true;
  // 标题像「栏目名 | 站点」且正文很短、多条日期标题堆叠
  const head = `${title}\n${text.slice(0, 1000)}`;
  if (LISTING_BODY_HINTS.some((h) => head.includes(h)) && text.length < 1800) return true;
  const dateLines = (text.match(/\d{4}[/-年]\d{1,2}[/-月]\d{1,2}/g) || []).length;
  if (dateLines >= 6 && text.length < 2200 && !hasArticleMeta) return true;
  return false;
}

/**
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   title?: string,
 *   text?: string,
 *   excerpt?: string,
 *   publishedAt?: string|null,
 *   finalUrl?: string,
 *   canonicalUrl?: string,
 *   isListing?: boolean,
 *   status?: number,
 * }}
 */
export async function fetchArticlePage(url, { timeoutMs = 10000, maxChars = 6000 } = {}) {
  if (!url) return { ok: false, reason: 'unreachable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'FrontierSocietyBot/1.0 (+https://frontier.geekpark.net)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!(res.status >= 200 && res.status < 400)) {
      return { ok: false, reason: 'unreachable', status: res.status };
    }
    const ctype = String(res.headers.get('content-type') || '').toLowerCase();
    if (ctype && !ctype.includes('html') && !ctype.includes('text') && !ctype.includes('xml')) {
      return { ok: false, reason: 'not_html', status: res.status };
    }

    const html = await res.text();
    if (!html || html.length < 80) {
      return { ok: false, reason: 'empty', status: res.status };
    }

    const finalUrl = String(res.url || url || '').trim();
    const canonicalUrl = extractCanonicalUrl(html, finalUrl || url);
    const title = extractTitle(html);
    const description = metaContent(html, ['description', 'og:description', 'twitter:description']);
    let text = stripHtml(html);
    if (text.length > maxChars) text = text.slice(0, maxChars);
    const excerpt = (description || text).replace(/\s+/g, ' ').trim().slice(0, 400);
    const publishedAt = extractPublishedAt(html);
    const isListing = looksLikeListingPage({ title, text, html });

    if (isListing) {
      return {
        ok: false,
        reason: 'listing_page',
        title,
        text,
        excerpt,
        publishedAt,
        finalUrl,
        canonicalUrl,
        isListing: true,
        status: res.status,
      };
    }

    if (text.length < 120 && excerpt.length < 40) {
      return {
        ok: false,
        reason: 'too_thin',
        title,
        text,
        excerpt,
        publishedAt,
        finalUrl,
        canonicalUrl,
        status: res.status,
      };
    }

    return {
      ok: true,
      title,
      text,
      excerpt,
      publishedAt,
      finalUrl,
      canonicalUrl,
      isListing: false,
      status: res.status,
    };
  } catch {
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** 正文/标题是否真正出现会员名或公司名 */
export function pageMentionsMember(page, member) {
  const name = String(member?.name || '').trim();
  const company = String(member?.company || '').trim();
  const blob = `${page?.title || ''}\n${page?.text || ''}\n${page?.excerpt || ''}`;
  if (company && blob.includes(company)) return true;
  if (name && name.length >= 2 && blob.includes(name)) return true;
  return false;
}

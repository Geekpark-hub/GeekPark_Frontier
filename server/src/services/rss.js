/**
 * 多新闻源 RSS 召回：源列表存库（可后台增删），与搜索合并去重后再给正文/LLM。
 */
import { prisma } from '../prisma.js';

/** 与运营表格对齐的公共 RSS（仅这些默认启用；表外源保留但禁用） */
export const SHEET_RSS_FEEDS = [
  { key: '36kr', name: '36氪综合资讯', url: 'https://36kr.com/feed' },
  { key: '36kr-article', name: '36氪文章', url: 'https://36kr.com/feed-article' },
  { key: 'geekpark', name: '极客公园', url: 'https://www.geekpark.net/rss' },
  { key: 'tmtpost', name: '钛媒体', url: 'https://www.tmtpost.com/rss' },
  { key: 'huxiu', name: '虎嗅', url: 'https://www.huxiu.com/rss/0.xml' },
  { key: 'jiqizhixin', name: '机器之心', url: 'https://www.jiqizhixin.com/rss' },
  { key: 'qbitai', name: '量子位', url: 'https://www.qbitai.com/feed' },
  { key: 'ifanr', name: '爱范儿', url: 'https://www.ifanr.com/feed' },
  { key: 'sspai', name: '少数派', url: 'https://sspai.com/feed' },
  { key: 'technode', name: '动点科技', url: 'https://cn.technode.com/feed/' },
  { key: 'techcrunch', name: 'TechCrunch 综合', url: 'https://techcrunch.com/feed/' },
  {
    key: 'techcrunch-ai',
    name: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
  },
  {
    key: 'techcrunch-startups',
    name: 'TechCrunch Startups',
    url: 'https://techcrunch.com/category/startups/feed/',
  },
  { key: 'theverge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { key: 'arstechnica-ai', name: 'Ars Technica AI', url: 'https://arstechnica.com/ai/feed/' },
  { key: 'producthunt', name: 'Product Hunt', url: 'https://www.producthunt.com/feed' },
  { key: 'bloomberg', name: 'Bloomberg 综合', url: 'https://www.bloomberg.com/feeds/news.rss' },
  {
    key: 'bloomberg-tech',
    name: 'Bloomberg Technology',
    url: 'https://www.bloomberg.com/feeds/technology/news.rss',
  },
];

export const DEFAULT_RSS_FEEDS = SHEET_RSS_FEEDS;
export const CATALOG_RSS_FEEDS = SHEET_RSS_FEEDS;
/** @deprecated */
export const EXTRA_RSS_FEEDS = [];

/** @deprecated 兼容旧引用 */
export const RSS_FEEDS = DEFAULT_RSS_FEEDS;

const CACHE_TTL_MS = 15 * 60 * 1000;
let cache = { at: 0, items: [], feedStats: [] };

export function invalidateRssCache() {
  cache = { at: 0, items: [], feedStats: [] };
}

/**
 * 按表格对齐公共源：表内 URL 启用/补齐，表外源禁用（不删）。
 */
export async function syncSheetNewsSources() {
  const allow = new Set(SHEET_RSS_FEEDS.map((f) => normalizeArticleUrl(f.url)));
  const all = await prisma.newsSource.findMany();
  const byNorm = new Map(all.map((r) => [normalizeArticleUrl(r.url), r]));
  const byKey = new Map(all.filter((r) => r.key).map((r) => [r.key, r]));

  let created = 0;
  let enabled = 0;
  let disabled = 0;

  for (let i = 0; i < SHEET_RSS_FEEDS.length; i += 1) {
    const f = SHEET_RSS_FEEDS[i];
    const nu = normalizeArticleUrl(f.url);
    let row = byNorm.get(nu) || byKey.get(f.key) || null;

    if (!row) {
      row = await prisma.newsSource.create({
        data: {
          key: f.key,
          name: f.name,
          url: f.url,
          enabled: true,
          sort: i,
        },
      });
      byNorm.set(nu, row);
      byKey.set(f.key, row);
      created += 1;
      continue;
    }

    const data = {
      name: f.name,
      enabled: true,
      sort: i,
    };
    // 同 key 但 URL 不同：若表内 URL 尚未占用则改到表内地址，否则只启用已有表内行
    if (normalizeArticleUrl(row.url) !== nu) {
      const taken = byNorm.get(nu);
      if (!taken) {
        data.url = f.url;
        data.key = row.key || f.key;
      } else if (taken.id !== row.id) {
        if (!taken.enabled) {
          await prisma.newsSource.update({
            where: { id: taken.id },
            data: { enabled: true, name: f.name, sort: i, key: taken.key || f.key },
          });
          enabled += 1;
        }
        if (row.enabled) {
          await prisma.newsSource.update({ where: { id: row.id }, data: { enabled: false } });
          disabled += 1;
        }
        continue;
      }
    } else if (!row.key) {
      data.key = f.key;
    }

    await prisma.newsSource.update({ where: { id: row.id }, data });
    if (!row.enabled) enabled += 1;
    const updated = { ...row, ...data, url: data.url || row.url };
    byNorm.set(normalizeArticleUrl(updated.url), updated);
    if (updated.key) byKey.set(updated.key, updated);
  }

  const fresh = await prisma.newsSource.findMany();
  for (const row of fresh) {
    if (!allow.has(normalizeArticleUrl(row.url)) && row.enabled) {
      await prisma.newsSource.update({ where: { id: row.id }, data: { enabled: false } });
      disabled += 1;
    }
  }

  invalidateRssCache();
  return { created, enabled, disabled, allowCount: allow.size };
}

export async function ensureCatalogNewsSources() {
  return syncSheetNewsSources();
}

export async function ensureDefaultNewsSources() {
  const count = await prisma.newsSource.count();
  if (count === 0) {
    await prisma.newsSource.createMany({
      data: SHEET_RSS_FEEDS.map((f, i) => ({
        key: f.key,
        name: f.name,
        url: f.url,
        enabled: true,
        sort: i,
      })),
    });
    return { seeded: true, count: SHEET_RSS_FEEDS.length, added: SHEET_RSS_FEEDS.length };
  }
  const sync = await syncSheetNewsSources();
  return { seeded: false, count, ...sync };
}

export async function listNewsSourcesFromDb({ enabledOnly = false } = {}) {
  await ensureDefaultNewsSources();
  return prisma.newsSource.findMany({
    where: enabledOnly ? { enabled: true } : undefined,
    orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { items: true } } },
  });
}

export function getRetentionDays() {
  const feedDays = Number(process.env.AI_FEED_DAYS || 30);
  const retain = Number(process.env.RSS_RETENTION_DAYS || feedDays + 7);
  return Math.max(feedDays, retain, 7);
}

export function getRssStatus() {
  return {
    provider: 'rss',
    configured: true,
    mode: 'live',
    feeds: cache.feedStats?.length || 0,
    cachedItems: cache.items.length,
    archiveItems: cache.archiveTotal ?? null,
    retentionDays: getRetentionDays(),
    cacheAgeSec: cache.at ? Math.round((Date.now() - cache.at) / 1000) : null,
    feedStats: cache.feedStats || [],
  };
}

export function normalizeArticleUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    // 同一文章 http/https、大小写域名常混用，统一后再做去重
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    u.username = '';
    u.password = '';
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'spm',
      'from',
      'ref',
    ]) {
      u.searchParams.delete(key);
    }
    let out = u.toString();
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return String(url || '').trim();
  }
}

function decodeXml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function tagText(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeXml(m[1]) : '';
}

function tagAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, 'i');
  const m = block.match(re);
  return m ? decodeXml(m[1]) : '';
}

function parseFeedXml(xml, feed) {
  const items = [];
  const chunks = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of chunks) {
    const title = tagText(block, 'title');
    const link = tagText(block, 'link') || tagAttr(block, 'link', 'href');
    const snippet =
      tagText(block, 'description') ||
      tagText(block, 'content:encoded') ||
      tagText(block, 'summary') ||
      '';
    const publishedAt =
      tagText(block, 'pubDate') || tagText(block, 'published') || tagText(block, 'updated') || null;
    if (!link) continue;
    items.push({
      title,
      url: normalizeArticleUrl(link),
      snippet: snippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
      source: 'rss',
      feedId: feed.id,
      feedName: feed.name,
    });
  }

  const entries = String(xml || '').match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of entries) {
    const title = tagText(block, 'title');
    const link =
      tagAttr(block, 'link', 'href') ||
      tagText(block, 'link') ||
      tagText(block, 'id');
    const snippet =
      tagText(block, 'summary') || tagText(block, 'content') || tagText(block, 'description') || '';
    const publishedAt =
      tagText(block, 'published') || tagText(block, 'updated') || tagText(block, 'pubDate') || null;
    if (!link) continue;
    items.push({
      title,
      url: normalizeArticleUrl(link),
      snippet: snippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      publishedAt:
        publishedAt && !Number.isNaN(new Date(publishedAt).getTime())
          ? new Date(publishedAt).toISOString()
          : null,
      source: 'rss',
      feedId: feed.id,
      feedName: feed.name,
    });
  }
  return items;
}

export async function fetchOneFeed(feed, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(feed.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'FrontierSocietyBot/1.0 (+https://frontier-api.geekpark.net)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) {
      return { feed, ok: false, error: `HTTP ${res.status}`, items: [] };
    }
    const xml = await res.text();
    const ctype = String(res.headers.get('content-type') || '').toLowerCase();
    if (ctype.includes('text/html') && !/<rss[\s>]|<feed[\s>]/i.test(xml)) {
      return { feed, ok: false, error: 'not_xml', items: [] };
    }
    const items = parseFeedXml(xml, feed).filter((x) => x.url && /^https?:/i.test(x.url));
    return { feed, ok: true, error: null, items };
  } catch (err) {
    return { feed, ok: false, error: err.message || String(err), items: [] };
  } finally {
    clearTimeout(timer);
  }
}

function toFeedShape(row) {
  return {
    id: row.key || row.id,
    dbId: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    sort: row.sort,
  };
}

/**
 * 拉取各源当前 feed，写入本地档案（按 URL 去重累积）。
 * 每天多次跑，大约一个月后窗口就齐了。
 */
export async function ingestRssArchive() {
  const rows = await listNewsSourcesFromDb({ enabledOnly: true });
  const feeds = rows.map(toFeedShape);
  const results = await Promise.all(feeds.map((f) => fetchOneFeed(f)));
  const feedStats = [];
  let fetched = 0;
  let upserted = 0;

  for (const r of results) {
    feedStats.push({
      id: r.feed.id,
      dbId: r.feed.dbId,
      name: r.feed.name,
      url: r.feed.url,
      ok: r.ok,
      count: r.items.length,
      error: r.error,
    });
    if (!r.ok || !r.feed.dbId) continue;
    fetched += r.items.length;
    for (const item of r.items) {
      const url = normalizeArticleUrl(item.url);
      if (!url) continue;
      const publishedAt =
        item.publishedAt && !Number.isNaN(new Date(item.publishedAt).getTime())
          ? new Date(item.publishedAt)
          : null;
      try {
        await prisma.newsSourceItem.upsert({
          where: { url },
          create: {
            sourceId: r.feed.dbId,
            url,
            title: String(item.title || '').slice(0, 300),
            snippet: String(item.snippet || '').slice(0, 800),
            publishedAt,
          },
          update: {
            sourceId: r.feed.dbId,
            title: String(item.title || '').slice(0, 300) || undefined,
            snippet: String(item.snippet || '').slice(0, 800) || undefined,
            publishedAt: publishedAt || undefined,
            lastSeenAt: new Date(),
          },
        });
        upserted += 1;
      } catch {
        /* 并发冲突忽略 */
      }
    }
  }

  const retentionDays = getRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 86400000);
  const pruned = await prisma.newsSourceItem.deleteMany({
    where: {
      OR: [
        { publishedAt: { lt: cutoff } },
        { AND: [{ publishedAt: null }, { firstSeenAt: { lt: cutoff } }] },
      ],
    },
  });

  invalidateRssCache();
  const archiveTotal = await prisma.newsSourceItem.count();
  return {
    summary: `RSS 归档：拉取 ${fetched}，写入 ${upserted}，清理过期 ${pruned.count}，库存 ${archiveTotal}（保留 ${retentionDays} 天）`,
    fetched,
    upserted,
    pruned: pruned.count,
    archiveTotal,
    retentionDays,
    feedStats,
  };
}

/** 从本地一个月档案取候选（先 ingest 当前 feed） */
export async function loadRssPool({ force = false } = {}) {
  if (!force && cache.items.length && Date.now() - cache.at < CACHE_TTL_MS) {
    return { items: cache.items, feedStats: cache.feedStats, archiveTotal: cache.archiveTotal };
  }

  const ingest = await ingestRssArchive();
  const retentionDays = getRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 86400000);

  const rows = await prisma.newsSourceItem.findMany({
    where: {
      OR: [
        { publishedAt: { gte: cutoff } },
        { AND: [{ publishedAt: null }, { firstSeenAt: { gte: cutoff } }] },
      ],
      source: { enabled: true },
    },
    include: { source: { select: { id: true, key: true, name: true } } },
    orderBy: [{ publishedAt: 'desc' }, { firstSeenAt: 'desc' }],
    take: 5000,
  });

  const items = rows.map((row) => ({
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : row.firstSeenAt.toISOString(),
    source: 'rss',
    feedId: row.source.key || row.source.id,
    feedName: row.source.name,
  }));

  const feedStats = ingest.feedStats || [];
  cache = {
    at: Date.now(),
    items,
    feedStats,
    archiveTotal: ingest.archiveTotal,
  };
  return { items, feedStats, archiveTotal: ingest.archiveTotal, ingest };
}

function withinDays(iso, days) {
  if (!iso || !days) return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= days * 86400000;
}

function pushTerm(terms, value) {
  const t = String(value || '').trim();
  if (t.length < 2) return;
  if (!terms.includes(t)) terms.push(t);
}

/** 姓名/公司 + rssKeywords（分号/逗号分隔） */
export function memberMatchTerms(member) {
  const terms = [];
  pushTerm(terms, member?.name);
  pushTerm(terms, member?.company);
  for (const part of String(member?.rssKeywords || '').split(/[;；,，|]/)) {
    pushTerm(terms, part);
  }
  return terms;
}

export function matchRssForMember(poolItems, member, { days = 30, limit = 8 } = {}) {
  const name = String(member?.name || '').trim();
  const company = String(member?.company || '').trim();
  const terms = memberMatchTerms(member);
  if (!terms.length) return [];

  const hits = [];
  for (const item of poolItems || []) {
    if (!withinDays(item.publishedAt, days)) continue;
    const blob = `${item.title}\n${item.snippet}`;
    const hitCompany = company && blob.includes(company);
    const hitName = name && name.length >= 2 && blob.includes(name);
    const hitKeyword = !hitCompany && !hitName && terms.some((t) => blob.includes(t));
    if (!hitCompany && !hitName && !hitKeyword) continue;
    hits.push({
      ...item,
      match: hitCompany ? 'company' : hitName ? 'name' : 'keyword',
    });
  }

  const rank = { company: 0, name: 1, keyword: 2 };
  hits.sort((a, b) => {
    const ra = rank[a.match] ?? 9;
    const rb = rank[b.match] ?? 9;
    if (ra !== rb) return ra - rb;
    return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
  });
  return hits.slice(0, limit);
}

/** 拆分会员 Google News RSS：每行一条，也兼容逗号/分号分隔 */
export function splitGoogleNewsRssUrls(raw) {
  return String(raw || '')
    .split(/[\n\r,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

/** 拉取会员专属 Google News RSS（中英文，各可多条），条目本身已按人/公司检索 */
export async function fetchMemberGoogleNewsRss(member, { days = 30, limit = 10 } = {}) {
  const feeds = [];
  const zhList = splitGoogleNewsRssUrls(member?.googleNewsRssZh);
  const enList = splitGoogleNewsRssUrls(member?.googleNewsRssEn);
  zhList.forEach((url, i) => {
    feeds.push({ id: `gn-zh-${i}`, name: `Google News 中文#${i + 1}`, url });
  });
  enList.forEach((url, i) => {
    feeds.push({ id: `gn-en-${i}`, name: `Google News 英文#${i + 1}`, url });
  });
  if (!feeds.length) return [];

  const results = await Promise.all(feeds.map((f) => fetchOneFeed(f)));
  const items = [];
  const seen = new Set();
  for (const r of results) {
    if (!r.ok) continue;
    for (const item of r.items) {
      if (!withinDays(item.publishedAt, days)) continue;
      const key = normalizeArticleUrl(item.url || '').toLowerCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      items.push({
        ...item,
        source: 'google_news',
        match: 'google_news',
      });
    }
  }
  items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return items.slice(0, limit);
}

export function mergeAndDedupeCandidates(rssItems, searchItems, { limit = 12 } = {}) {
  const map = new Map();
  for (const item of [...(rssItems || []), ...(searchItems || [])]) {
    const url = normalizeArticleUrl(item?.url || '');
    if (!url) continue;
    const key = url.toLowerCase();
    if (map.has(key)) continue;
    map.set(key, { ...item, url });
  }
  return [...map.values()].slice(0, limit);
}

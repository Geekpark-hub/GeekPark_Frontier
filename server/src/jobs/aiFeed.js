import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { getSearchStatus, searchMemberNews } from '../services/search.js';
import { getLlmStatus, refineNewsItem } from '../services/llm.js';
import {
  isBlockedSourceUrl,
  looksLikeSpamText,
  postRefineRejectReason,
} from '../services/urlQuality.js';
import {
  fetchArticlePage,
  pageMentionsMember,
  pickSourcePublishedAt,
} from '../services/pageFetch.js';
import {
  getRssStatus,
  loadRssPool,
  matchRssForMember,
  fetchMemberGoogleNewsRss,
  mergeAndDedupeCandidates,
  normalizeArticleUrl,
} from '../services/rss.js';
import { notifyPendingFeedPosts } from '../services/feishu.js';

/** 进程内当前抓取状态：离开页面也不会中断（服务端继续跑） */
let currentRun = null;

export function getAiFeedRunState() {
  return currentRun;
}

/**
 * 异步启动抓取：立即返回，后台执行。
 * 同时只能跑一个；重复点击会返回 already_running。
 */
export function startAiFeedAsync(opts = {}) {
  if (currentRun?.status === 'running') {
    return { started: false, reason: 'already_running', run: currentRun };
  }

  const id = crypto.randomUUID();
  currentRun = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summary: '抓取进行中，可离开页面，完成后自动写入待审核',
    progress: { total: 0, scanned: 0, created: 0, skipped: 0, rejected: 0, deadLinks: 0 },
    result: null,
    error: null,
  };

  runAiFeed(opts)
    .then((result) => {
      currentRun = {
        ...currentRun,
        status: 'ok',
        finishedAt: new Date().toISOString(),
        summary: result.summary,
        progress: {
          total: result.scanned || 0,
          scanned: result.scanned || 0,
          created: result.created || 0,
          skipped: result.skipped || 0,
          rejected: result.rejected || 0,
          deadLinks: result.deadLinks || 0,
        },
        result,
        error: null,
      };
    })
    .catch((err) => {
      currentRun = {
        ...currentRun,
        status: 'error',
        finishedAt: new Date().toISOString(),
        summary: err.message || 'AI 抓取失败',
        result: null,
        error: err.message || String(err),
      };
    });

  return { started: true, run: currentRun };
}

function patchRunProgress( partial) {
  if (!currentRun || currentRun.status !== 'running') return;
  const progress = { ...(currentRun.progress || {}), ...partial };
  const total = progress.total || 0;
  const scanned = progress.scanned || 0;
  currentRun = {
    ...currentRun,
    progress,
    summary:
      total > 0
        ? `抓取中 ${scanned}/${total} 人，待审 +${progress.created || 0}，拒绝 ${progress.rejected || 0}`
        : currentRun.summary,
  };
}

function dedupeKeyFromUrl(url) {
  const normalized = normalizeArticleUrl(url).toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 40);
}

/** 去掉空白/标点后的标题+正文前缀指纹，跨不同入口 URL 去重 */
function normalizeContentFingerprint(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

export function contentDedupeKeyFrom({ title, text, excerpt, content } = {}) {
  const titlePart = normalizeContentFingerprint(title).slice(0, 160);
  const bodyPart = normalizeContentFingerprint(text || content || excerpt).slice(0, 800);
  if (titlePart.length < 6 && bodyPart.length < 40) return null;
  const raw = `${titlePart}|${bodyPart}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

async function findExistingByUrlKeys(urls = []) {
  const keys = [...new Set(urls.map((u) => dedupeKeyFromUrl(u)).filter(Boolean))];
  for (const key of keys) {
    const hit = await prisma.feedPost.findUnique({ where: { dedupeKey: key } });
    if (hit) return { hit, key, kind: 'url' };
  }
  return null;
}

async function findExistingByContentKey(contentKey) {
  if (!contentKey) return null;
  const hit = await prisma.feedPost.findUnique({ where: { contentDedupeKey: contentKey } });
  return hit ? { hit, key: contentKey, kind: 'content' } : null;
}

/** 供 LLM 语义去重：该会员近段时间已有动态（草稿/待审/已发布） */
async function loadRecentPostsForSemanticDedupe(memberId, { days = 60, limit = 25 } = {}) {
  if (!memberId) return [];
  const since = new Date(Date.now() - days * 86400000);
  return prisma.feedPost.findMany({
    where: {
      relatedMemberId: memberId,
      OR: [
        { publishedAt: { gte: since } },
        { createdAt: { gte: since } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      content: true,
      sourceUrl: true,
      status: true,
    },
  });
}

const REJECT_SAMPLE_LIMIT = 50;
const SKIP_SAMPLE_LIMIT = 30;
const DEAD_SAMPLE_LIMIT = 30;

function truncateText(v, max = 100) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function bumpCount(map, key) {
  const k = key || 'other';
  map[k] = (map[k] || 0) + 1;
}

function pushSample(list, item, limit) {
  if (list.length >= limit) return;
  list.push(item);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 固定并发池：最多 concurrency 个任务同时跑 */
async function mapPool(items, concurrency, worker) {
  const list = items || [];
  if (!list.length) return [];
  const limit = Math.min(Math.max(1, concurrency), list.length);
  let cursor = 0;
  const out = new Array(list.length);
  async function run() {
    while (cursor < list.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await worker(list[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => run()));
  return out;
}

export async function runAiFeed({ memberId = null, limitPerMember } = {}) {
  const searchStatus = getSearchStatus();
  const llmStatus = getLlmStatus();
  const startedAt = new Date();
  const createdIds = [];
  const days = Number(process.env.AI_FEED_DAYS || 30);
  // 每人每轮最多写入待审条数（默认 10；候选池会按此放大，避免点多次才捞全）
  const perMemberCap = Math.min(
    15,
    Math.max(1, Number(limitPerMember || process.env.AI_FEED_LIMIT_PER_MEMBER || 10))
  );
  limitPerMember = perMemberCap;
  // 会员并发 × 每人候选并发；默认 8×5
  const memberConcurrency = clampInt(process.env.AI_FEED_MEMBER_CONCURRENCY, 1, 12, 8);
  const itemConcurrency = clampInt(process.env.AI_FEED_ITEM_CONCURRENCY, 1, 8, 5);

  const members = await prisma.member.findMany({
    where: memberId
      ? { id: memberId }
      : {
          status: 'active',
          isAdmin: false,
          isSuperAdmin: false,
          company: { not: '' }, // 没有公司名极易误匹配
        },
    orderBy: { updatedAt: 'desc' },
  });

  let scanned = 0;
  let created = 0;
  let skipped = 0;
  let rejected = 0;
  let deadLinks = 0;
  const errors = [];
  const rejectByReason = {};
  const skipByReason = {};
  const rejectSamples = [];
  const skipSamples = [];
  const deadLinkSamples = [];
  let rssStatus = getRssStatus();

  function noteReject({ member, item, reason }) {
    rejected += 1;
    const label = String(reason || '其他原因').trim() || '其他原因';
    bumpCount(rejectByReason, label);
    pushSample(
      rejectSamples,
      {
        member: member?.name || '',
        company: member?.company || '',
        title: truncateText(item?.title, 90),
        url: item?.url || '',
        reason: label,
      },
      REJECT_SAMPLE_LIMIT
    );
  }

  function noteSkip({ member, item, reason }) {
    skipped += 1;
    const label = String(reason || '已存在').trim() || '已存在';
    bumpCount(skipByReason, label);
    pushSample(
      skipSamples,
      {
        member: member?.name || '',
        company: member?.company || '',
        title: truncateText(item?.title, 90),
        url: item?.url || '',
        reason: label,
      },
      SKIP_SAMPLE_LIMIT
    );
  }

  function noteDeadLink({ member, item, reason }) {
    deadLinks += 1;
    pushSample(
      deadLinkSamples,
      {
        member: member?.name || '',
        company: member?.company || '',
        title: truncateText(item?.title, 90),
        url: item?.url || '',
        reason: String(reason || 'unreachable'),
      },
      DEAD_SAMPLE_LIMIT
    );
  }

  if (!members.length) {
    const summary =
      '没有可扫描的会员：请先在「会员管理」添加活跃会员，并填写公司名称后再抓取';
    await prisma.jobLog.create({
      data: {
        type: 'ai_feed',
        status: 'ok',
        summary,
        detail: JSON.stringify({
          searchStatus,
          llmStatus,
          rssStatus,
          scanned: 0,
          created: 0,
          skipped: 0,
          rejected: 0,
          deadLinks: 0,
          errors: [],
          rejectByReason: {},
          skipByReason: {},
          rejectSamples: [],
          skipSamples: [],
          deadLinkSamples: [],
          startedAt,
          finishedAt: new Date(),
          memberId,
        }),
      },
    });
    return {
      summary,
      scanned: 0,
      created: 0,
      skipped: 0,
      rejected: 0,
      deadLinks: 0,
      errors: [],
    };
  }

  // 整次任务只拉一次公共 RSS 池，后续按会员匹配 + 与搜索结果去重
  const rssPool = await loadRssPool({ force: true });
  rssStatus = {
    ...getRssStatus(),
    feedStats: rssPool.feedStats,
    pooled: rssPool.items.length,
  };

  await mapPool(members, memberConcurrency, async (member) => {
    scanned += 1;
    try {
      // 候选池放大：单次尽量扫完可用线索，减少「再点一次才出现」
      // Serper 单次最多约 10；RSS/Google News 可多取，合并后逐条核验直到满额或耗尽
      const searchLimit = 10;
      const rssLimit = Math.max(limitPerMember * 4, 24);
      const candidateLimit = Math.max(limitPerMember * 5, 40);
      const [searchResults, poolHits, gnHits] = await Promise.all([
        searchMemberNews(member, { days, limit: searchLimit }),
        Promise.resolve(
          matchRssForMember(rssPool.items, member, {
            days,
            limit: rssLimit,
          })
        ),
        fetchMemberGoogleNewsRss(member, { days, limit: rssLimit }),
      ]);

      // Google News 专属源优先，再公共 RSS，再搜索
      const rssHits = mergeAndDedupeCandidates(gnHits, poolHits, {
        limit: candidateLimit,
      });
      const results = mergeAndDedupeCandidates(rssHits, searchResults, {
        limit: candidateLimit,
      });

      // 本会员近期动态 + 本轮已写入，交给 LLM 做「同一事件」去重
      const recentPosts = await loadRecentPostsForSemanticDedupe(member.id, {
        days: Math.max(days * 2, 60),
        limit: 25,
      });
      const sessionPosts = [];

      let keptForMember = 0;
      let nextItem = 0;

      async function processOneItem(item) {
        if (keptForMember >= limitPerMember) return;

        if (!item.url) {
          noteReject({ member, item, reason: '无有效链接' });
          return;
        }
        if (isBlockedSourceUrl(item.url)) {
          noteReject({ member, item, reason: '屏蔽来源站' });
          return;
        }
        if (looksLikeSpamText(item.title, item.snippet, item.url)) {
          noteReject({ member, item, reason: '疑似垃圾文案' });
          return;
        }

        // 入口 URL 先挡一层（未拉正文前省流量）
        const earlyUrlHit = await findExistingByUrlKeys([item.url]);
        if (earlyUrlHit) {
          noteSkip({ member, item, reason: '库中已有相同链接' });
          return;
        }
        if (keptForMember >= limitPerMember) return;

        // 拉取正文：搜索摘要不够，必须用页面内容核验
        const page = await fetchArticlePage(item.url);
        if (keptForMember >= limitPerMember) return;
        if (!page.ok) {
          if (page.reason === 'unreachable') {
            noteDeadLink({ member, item, reason: '链接不可达' });
          } else {
            const pageReasonMap = {
              not_html: '非 HTML 页面',
              empty: '页面内容为空',
              listing_page: '栏目/列表页',
              too_thin: '正文过短',
            };
            noteReject({
              member,
              item,
              reason: pageReasonMap[page.reason] || `正文拉取失败（${page.reason || 'unknown'}）`,
            });
          }
          return;
        }
        if (!pageMentionsMember(page, member)) {
          noteReject({ member, item, reason: '正文未出现会员姓名或公司名' });
          return;
        }

        // 跳转后的最终 URL / canonical 再查一轮链接去重
        const sourceUrl =
          normalizeArticleUrl(page.canonicalUrl || page.finalUrl || item.url) ||
          item.url ||
          '';
        const urlHit = await findExistingByUrlKeys([
          item.url,
          page.finalUrl,
          page.canonicalUrl,
          sourceUrl,
        ]);
        if (urlHit) {
          noteSkip({ member, item, reason: '库中已有相同链接（跳转/canonical）' });
          return;
        }

        // 内容指纹：同一篇换入口 URL 也能挡住
        const contentKey = contentDedupeKeyFrom({
          title: page.title || item.title,
          text: page.text,
          excerpt: page.excerpt || item.snippet,
        });
        const contentHit = await findExistingByContentKey(contentKey);
        if (contentHit) {
          noteSkip({ member, item, reason: '库中已有相同内容' });
          return;
        }
        if (keptForMember >= limitPerMember) return;

        const enriched = {
          ...item,
          title: page.title || item.title,
          snippet: page.excerpt || item.snippet,
          pageText: page.text,
          // 只跟源站发布时间对齐：页面 meta/JSON-LD > RSS/搜索条目时间
          publishedAt: pickSourcePublishedAt(page.publishedAt, item.publishedAt),
          url: sourceUrl || item.url,
        };

        const refined = await refineNewsItem({
          member,
          item: enriched,
          existingPosts: [...recentPosts, ...sessionPosts],
        });
        if (keptForMember >= limitPerMember) return;
        if (!refined.accepted) {
          const aiReason = truncateText(refined.reason, 120) || '大模型判定不通过';
          if (refined.sameAsExisting) {
            noteSkip({ member, item: enriched, reason: `语义去重：${aiReason}` });
          } else {
            noteReject({ member, item: enriched, reason: `AI 拒绝：${aiReason}` });
          }
          return;
        }

        const hardReject = postRefineRejectReason({ member, item: enriched, refined });
        if (hardReject) {
          noteReject({ member, item: enriched, reason: hardReject });
          return;
        }

        if (keptForMember >= limitPerMember) return;
        keptForMember += 1;

        const dedupeKey =
          dedupeKeyFromUrl(sourceUrl) ||
          dedupeKeyFromUrl(page.finalUrl) ||
          dedupeKeyFromUrl(item.url);

        const publishedAt = pickSourcePublishedAt(enriched.publishedAt) || new Date();
        try {
          const post = await prisma.feedPost.create({
            data: {
              title: refined.title,
              content: refined.content,
              publishedAt,
              sourceUrl,
              status: 'pending',
              sourceType: 'auto',
              relatedMemberId: member.id,
              dedupeKey,
              // 用原文指纹入库，避免 LLM 改写导致明天对不上
              contentDedupeKey: contentKey,
              aiReason: String(refined.reason || '').trim() || 'AI 已通过筛选',
            },
          });
          createdIds.push(post.id);
          created += 1;
        } catch (err) {
          keptForMember -= 1;
          if (err.code === 'P2002') {
            noteSkip({ member, item, reason: '并发去重（写入冲突）' });
          } else {
            throw err;
          }
        }
      }

      // 候选人内并发：满额后不再领新任务
      const workers = Array.from(
        { length: Math.min(itemConcurrency, Math.max(1, results.length)) },
        async () => {
          while (keptForMember < limitPerMember) {
            const idx = nextItem;
            nextItem += 1;
            if (idx >= results.length) break;
            await processOneItem(results[idx]);
          }
        }
      );
      await Promise.all(workers);
    } catch (err) {
      errors.push({ memberId: member.id, name: member.name, error: err.message || String(err) });
    }
  });

  const rssTotal = (rssPool.feedStats || []).length;
  const rssOk = (rssPool.feedStats || []).filter((f) => f.ok).length;
  const summary = `扫描 ${scanned} 人，新增待审 ${created}，去重跳过 ${skipped}，AI/垃圾拒绝 ${rejected}，失效链接 ${deadLinks}，错误 ${errors.length}（search:${searchStatus.mode}/llm:${llmStatus.mode}/rss:${rssOk}/${rssTotal}/conc:${memberConcurrency}x${itemConcurrency}）`;
  await prisma.jobLog.create({
    data: {
      type: 'ai_feed',
      status: errors.length && !created ? 'error' : 'ok',
      summary,
      detail: JSON.stringify({
        searchStatus,
        llmStatus,
        rssStatus,
        memberConcurrency,
        itemConcurrency,
        scanned,
        created,
        skipped,
        rejected,
        deadLinks,
        errors,
        rejectByReason,
        skipByReason,
        rejectSamples,
        skipSamples,
        deadLinkSamples,
        startedAt,
        finishedAt: new Date(),
        memberId,
      }),
    },
  });

  let feishuNotify = null;
  if (createdIds.length) {
    try {
      const posts = await prisma.feedPost.findMany({
        where: { id: { in: createdIds } },
        include: {
          relatedMember: { select: { id: true, name: true, company: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      feishuNotify = await notifyPendingFeedPosts(posts, { summary });
    } catch (err) {
      console.warn('[feishu] pending feed notify error', err.message || err);
      feishuNotify = { sent: false, message: err.message || String(err) };
    }
  }

  return {
    searchStatus,
    llmStatus,
    rssStatus,
    scanned,
    created,
    skipped,
    rejected,
    deadLinks,
    errors,
    summary,
    feishuNotify,
  };
}

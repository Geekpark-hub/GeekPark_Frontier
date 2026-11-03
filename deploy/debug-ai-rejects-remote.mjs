import './src/polyfill-fetch.js';
import crypto from 'crypto';
import { prisma } from './src/prisma.js';
import { searchMemberNews } from './src/services/search.js';
import { refineNewsItem } from './src/services/llm.js';
import {
  isBlockedSourceUrl,
  looksLikeSpamText,
  postRefineRejectReason,
} from './src/services/urlQuality.js';
import { fetchArticlePage, pageMentionsMember } from './src/services/pageFetch.js';
import {
  loadRssPool,
  matchRssForMember,
  mergeAndDedupeCandidates,
  normalizeArticleUrl,
} from './src/services/rss.js';

function dedupeKeyFromUrl(url) {
  const normalized = normalizeArticleUrl(url).toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 40);
}

const member = await prisma.member.findFirst({
  where: { status: 'active', isAdmin: false, isSuperAdmin: false, company: { not: '' } },
});
if (!member) {
  console.log('no member');
  process.exit(0);
}

const days = Number(process.env.AI_FEED_DAYS || 30);
const limitPerMember = 2;
const rssPool = await loadRssPool({ force: true });
const searchResults = await searchMemberNews(member, {
  days,
  limit: Math.max(limitPerMember * 2, 4),
});
const rssHits = matchRssForMember(rssPool.items, member, {
  days,
  limit: Math.max(limitPerMember * 3, 6),
});
const results = mergeAndDedupeCandidates(rssHits, searchResults, {
  limit: Math.max(limitPerMember * 4, 10),
});

const rejected = [];
const skipped = [];
const dead = [];
const kept = [];

for (const item of results) {
  const base = {
    title: item.title,
    url: item.url,
    from: item.source || item.feedName || 'search',
    feedName: item.feedName || null,
  };

  if (!item.url || isBlockedSourceUrl(item.url) || looksLikeSpamText(item.title, item.snippet, item.url)) {
    rejected.push({ ...base, reason: 'url黑名单/垃圾文本/无链接' });
    continue;
  }

  const dedupeKey = dedupeKeyFromUrl(item.url);
  if (dedupeKey) {
    const exists = await prisma.feedPost.findUnique({ where: { dedupeKey } });
    if (exists) {
      skipped.push({ ...base, reason: `库内已有(${exists.status})`, existingTitle: exists.title });
      continue;
    }
  }

  const page = await fetchArticlePage(item.url);
  if (!page.ok) {
    if (page.reason === 'unreachable') dead.push({ ...base, reason: `死链/不可达(${page.reason})` });
    else rejected.push({ ...base, reason: `正文不合格(${page.reason})`, pageTitle: page.title || '' });
    continue;
  }
  if (!pageMentionsMember(page, member)) {
    rejected.push({ ...base, reason: '正文未出现会员名/公司名', pageTitle: page.title || '' });
    continue;
  }

  const enriched = {
    ...item,
    title: page.title || item.title,
    snippet: page.excerpt || item.snippet,
    pageText: page.text,
    publishedAt: page.publishedAt || item.publishedAt,
  };

  const refined = await refineNewsItem({ member, item: enriched });
  if (!refined.accepted) {
    rejected.push({
      ...base,
      reason: `LLM拒绝: ${refined.reason || 'accepted=false'}`,
      pageTitle: page.title || '',
      refinedTitle: refined.title || '',
    });
    continue;
  }

  const hardReject = postRefineRejectReason({ member, item: enriched, refined });
  if (hardReject) {
    rejected.push({
      ...base,
      reason: `硬校验拒绝: ${hardReject}`,
      pageTitle: page.title || '',
      refinedTitle: refined.title || '',
    });
    continue;
  }

  kept.push({ ...base, reason: '可通过', refinedTitle: refined.title });
}

console.log(
  JSON.stringify(
    {
      member: { name: member.name, company: member.company },
      candidates: results.length,
      skipped,
      dead,
      rejected,
      kept,
    },
    null,
    2
  )
);

await prisma.$disconnect();

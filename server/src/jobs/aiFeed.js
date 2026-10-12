import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { getSearchStatus, searchMemberNews } from '../services/search.js';
import { getLlmStatus, refineNewsItem } from '../services/llm.js';
import {
  isBlockedSourceUrl,
  isReachableUrl,
  looksLikeSpamText,
} from '../services/urlQuality.js';

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

function dedupeKeyFromUrl(url) {
  const normalized = String(url || '').trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 40);
}

export async function runAiFeed({ memberId = null, limitPerMember = 3 } = {}) {
  const searchStatus = getSearchStatus();
  const llmStatus = getLlmStatus();
  const startedAt = new Date();

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

  for (const member of members) {
    scanned += 1;
    try {
      const results = await searchMemberNews(member, {
        days: Number(process.env.AI_FEED_DAYS || 30),
        limit: Math.max(limitPerMember * 2, 4), // 多取一些，过滤后够用
      });

      let keptForMember = 0;
      for (const item of results) {
        if (keptForMember >= limitPerMember) break;

        if (
          !item.url ||
          isBlockedSourceUrl(item.url) ||
          looksLikeSpamText(item.title, item.snippet, item.url)
        ) {
          rejected += 1;
          continue;
        }

        const dedupeKey = dedupeKeyFromUrl(item.url);
        if (dedupeKey) {
          const exists = await prisma.feedPost.findUnique({ where: { dedupeKey } });
          if (exists) {
            skipped += 1;
            continue;
          }
        }

        const reachable = await isReachableUrl(item.url);
        if (!reachable) {
          deadLinks += 1;
          continue;
        }

        const refined = await refineNewsItem({ member, item });
        if (!refined.accepted) {
          rejected += 1;
          continue;
        }

        const publishedAt = item.publishedAt ? new Date(item.publishedAt) : new Date();
        try {
          await prisma.feedPost.create({
            data: {
              title: refined.title,
              content: refined.content,
              publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
              sourceUrl: item.url || '',
              status: 'pending',
              sourceType: 'auto',
              relatedMemberId: member.id,
              dedupeKey,
              aiReason: refined.reason || '',
            },
          });
          created += 1;
          keptForMember += 1;
        } catch (err) {
          if (err.code === 'P2002') {
            skipped += 1;
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      errors.push({ memberId: member.id, name: member.name, error: err.message || String(err) });
    }
  }

  const summary = `扫描 ${scanned} 人，新增待审 ${created}，去重跳过 ${skipped}，AI/垃圾拒绝 ${rejected}，失效链接 ${deadLinks}，错误 ${errors.length}（${searchStatus.mode}/${llmStatus.mode}）`;
  await prisma.jobLog.create({
    data: {
      type: 'ai_feed',
      status: errors.length && !created ? 'error' : 'ok',
      summary,
      detail: JSON.stringify({
        searchStatus,
        llmStatus,
        scanned,
        created,
        skipped,
        rejected,
        deadLinks,
        errors,
        startedAt,
        finishedAt: new Date(),
        memberId,
      }),
    },
  });

  return {
    searchStatus,
    llmStatus,
    scanned,
    created,
    skipped,
    rejected,
    deadLinks,
    errors,
    summary,
  };
}

import { prisma } from '../prisma.js';
import { generateUrlLink } from '../wx.js';
import { getPublicApiBase } from './feishu.js';

export const WX_URL_LINK_DAYS = 30;
/** 剩余不足该天数时视为需续期 */
const REFRESH_BEFORE_DAYS = 2;

/**
 * @param {'event' | 'poll' | 'brief'} kind
 * @param {string} id
 */
export function stableShareUrl(kind, id) {
  const base = getPublicApiBase();
  const seg = kind === 'poll' ? 'p' : kind === 'brief' ? 'b' : 'e';
  return `${base}/s/${seg}/${encodeURIComponent(id)}`;
}

function normalizeKind(kind) {
  if (kind === 'poll') return 'poll';
  if (kind === 'brief') return 'brief';
  return 'event';
}

function isWxLinkFresh(expireAt, { forceRefresh = false } = {}) {
  if (forceRefresh) return false;
  const linkExpire = expireAt ? new Date(expireAt) : null;
  if (!linkExpire || Number.isNaN(linkExpire.getTime())) return false;
  const renewBefore = Date.now() + REFRESH_BEFORE_DAYS * 24 * 60 * 60 * 1000;
  return linkExpire.getTime() > renewBefore;
}

async function findShareRow(kind, id) {
  const select = { id: true, wxUrlLink: true, wxUrlLinkExpireAt: true };
  if (kind === 'poll') return prisma.poll.findUnique({ where: { id }, select });
  if (kind === 'brief') return prisma.brief.findUnique({ where: { id }, select });
  return prisma.event.findUnique({ where: { id }, select });
}

async function updateShareRow(kind, id, data) {
  if (kind === 'poll') return prisma.poll.update({ where: { id }, data });
  if (kind === 'brief') return prisma.brief.update({ where: { id }, data });
  return prisma.event.update({ where: { id }, data });
}

function notFoundMessage(kind) {
  if (kind === 'poll') return '投票不存在';
  if (kind === 'brief') return '内参不存在';
  return '活动不存在';
}

/**
 * 确保库里有未过期的微信 URL Link；对外固定短链不变。
 * @param {{ kind: 'event' | 'poll' | 'brief', id: string, pagePath: string, forceRefresh?: boolean }} opts
 */
export async function ensureWxUrlLink(opts) {
  const kind = normalizeKind(opts.kind);
  const id = String(opts.id || '');
  const pagePath = String(opts.pagePath || '').replace(/^\//, '');
  const forceRefresh = Boolean(opts.forceRefresh);
  if (!id || !pagePath) {
    const err = new Error('缺少分享目标');
    err.status = 400;
    throw err;
  }

  const row = await findShareRow(kind, id);
  if (!row) {
    const err = new Error(notFoundMessage(kind));
    err.status = 404;
    throw err;
  }

  const cached = String(row.wxUrlLink || '').trim();
  if (cached && isWxLinkFresh(row.wxUrlLinkExpireAt, { forceRefresh })) {
    return {
      wxUrlLink: cached,
      wxUrlLinkExpireAt: row.wxUrlLinkExpireAt,
      envVersion: 'release',
      reused: true,
    };
  }

  const query = `id=${id}`;
  const link = await generateUrlLink({
    path: pagePath,
    query,
    expireIntervalDays: WX_URL_LINK_DAYS,
  });
  const wxUrlLinkExpireAt = new Date(Date.now() + WX_URL_LINK_DAYS * 24 * 60 * 60 * 1000);
  const data = { wxUrlLink: link.urlLink, wxUrlLinkExpireAt };
  await updateShareRow(kind, id, data);
  return {
    wxUrlLink: link.urlLink,
    wxUrlLinkExpireAt,
    envVersion: link.envVersion,
    reused: false,
  };
}

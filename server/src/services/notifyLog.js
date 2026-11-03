import { prisma } from '../prisma.js';

/**
 * 写入消息推送日志（失败不影响主流程）
 * @param {object} row
 */
export async function writeNotifyLog(row = {}) {
  try {
    const detail =
      typeof row.detail === 'string'
        ? row.detail.slice(0, 4000)
        : JSON.stringify(row.detail || {}).slice(0, 4000);
    await prisma.notifyLog.create({
      data: {
        channel: String(row.channel || '').slice(0, 40),
        kind: String(row.kind || '').slice(0, 60),
        memberId: row.memberId || null,
        memberName: String(row.memberName || '').slice(0, 80),
        targetType: String(row.targetType || '').slice(0, 40),
        targetId: String(row.targetId || '').slice(0, 80),
        targetTitle: String(row.targetTitle || '').slice(0, 120),
        templateId: String(row.templateId || '').slice(0, 80),
        page: String(row.page || '').slice(0, 200),
        success: Boolean(row.success),
        mode: String(row.mode || '').slice(0, 40),
        message: String(row.message || '').slice(0, 500),
        detail,
      },
    });
  } catch (err) {
    console.warn('[notify-log] write failed', err.message || err);
  }
}

export async function listNotifyLogs(query = {}) {
  const where = {};
  if (query.channel) where.channel = String(query.channel);
  if (query.kind) where.kind = String(query.kind);
  if (query.success === '1' || query.success === 'true') where.success = true;
  if (query.success === '0' || query.success === 'false') where.success = false;
  if (query.memberId) where.memberId = String(query.memberId);
  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) {
      const d = new Date(query.from);
      if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
    }
    if (query.to) {
      const d = new Date(query.to);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        where.createdAt.lte = d;
      }
    }
  }
  if (query.q) {
    const q = String(query.q).trim();
    if (q) {
      where.OR = [
        { memberName: { contains: q } },
        { targetTitle: { contains: q } },
        { message: { contains: q } },
        { kind: { contains: q } },
        { targetId: { contains: q } },
      ];
    }
  }
  return where;
}

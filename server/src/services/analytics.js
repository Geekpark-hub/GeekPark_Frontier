import { prisma } from '../prisma.js';

const ALLOWED_EVENTS = new Set([
  'app_open',
  'page_view',
  'poll_view',
  'poll_vote',
  'event_view',
  'event_register',
  'request_submit',
  'open_source',
]);

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim().slice(0, 64);
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim().slice(0, 64);
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64);
}

function safeJson(value, fallback = '{}') {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value.slice(0, 2000);
    } catch {
      return fallback;
    }
  }
  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return fallback;
  }
}

export function normalizeTrackPayload(body = {}) {
  const event = String(body.event || '').trim();
  if (!ALLOWED_EVENTS.has(event)) return null;
  return {
    event,
    path: String(body.path || '').trim().slice(0, 200),
    targetId: String(body.targetId || body.target_id || '').trim().slice(0, 80),
    meta: safeJson(body.meta, '{}'),
    device: safeJson(body.device, '{}'),
  };
}

export async function recordActivityEvent(memberId, payload, req) {
  const row = normalizeTrackPayload(payload);
  if (!row || !memberId) return null;
  return prisma.activityEvent.create({
    data: {
      memberId,
      event: row.event,
      path: row.path,
      targetId: row.targetId,
      meta: row.meta,
      device: row.device,
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    },
  });
}

function dayStart(daysAgo) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function parseDevice(raw) {
  try {
    return typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
  } catch {
    return {};
  }
}

function deviceLabel(deviceRaw) {
  const d = parseDevice(deviceRaw);
  const parts = [d.brand || d.model, d.system || d.platform].filter(Boolean);
  return parts.join(' · ') || '—';
}

export async function getAnalyticsOverview(days = 30) {
  const since = dayStart(Math.max(1, Math.min(Number(days) || 30, 90)) - 1);
  const since7 = dayStart(6);

  const [total, last7Unique, byEvent, recentActive] = await Promise.all([
    prisma.activityEvent.count({ where: { createdAt: { gte: since } } }),
    prisma.activityEvent.findMany({
      where: { createdAt: { gte: since7 } },
      select: { memberId: true },
      distinct: ['memberId'],
    }),
    prisma.activityEvent.groupBy({
      by: ['event'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.activityEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { memberId: true },
      distinct: ['memberId'],
    }),
  ]);

  const byEventSorted = byEvent
    .map((row) => ({ event: row.event, count: row._count._all }))
    .sort((a, b) => b.count - a.count);

  return {
    days: Math.max(1, Math.min(Number(days) || 30, 90)),
    totalEvents: total,
    activeMembers7d: last7Unique.length,
    activeMembers: recentActive.length,
    byEvent: byEventSorted,
  };
}

export async function getMemberActivityRanks(days = 30, limit = 50) {
  const since = dayStart(Math.max(1, Math.min(Number(days) || 30, 90)) - 1);
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const groupedRaw = await prisma.activityEvent.groupBy({
    by: ['memberId'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const grouped = groupedRaw
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, take);

  if (!grouped.length) return [];

  const members = await prisma.member.findMany({
    where: { id: { in: grouped.map((g) => g.memberId) } },
    select: {
      id: true,
      name: true,
      company: true,
      phone: true,
      status: true,
    },
  });
  const memberMap = new Map(members.map((m) => [m.id, m]));

  const latest = await Promise.all(
    grouped.map((g) =>
      prisma.activityEvent.findFirst({
        where: { memberId: g.memberId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { ip: true, device: true, event: true, path: true, createdAt: true },
      })
    )
  );

  return grouped.map((g, i) => {
    const m = memberMap.get(g.memberId) || {};
    const last = latest[i] || {};
    return {
      memberId: g.memberId,
      name: m.name || '未知',
      company: m.company || '',
      phone: m.phone || '',
      status: m.status || '',
      eventCount: g._count._all,
      lastAt: g._max.createdAt,
      lastEvent: last.event || '',
      lastPath: last.path || '',
      lastIp: last.ip || '',
      lastDevice: deviceLabel(last.device),
    };
  });
}

export async function getMemberActivityDetail(memberId, { days = 30, limit = 80 } = {}) {
  const since = dayStart(Math.max(1, Math.min(Number(days) || 30, 90)) - 1);
  const take = Math.min(Math.max(Number(limit) || 80, 1), 200);

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      name: true,
      company: true,
      title: true,
      phone: true,
      status: true,
    },
  });
  if (!member) return null;

  const [events, byEvent, count] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { memberId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.activityEvent.groupBy({
      by: ['event'],
      where: { memberId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.activityEvent.count({ where: { memberId, createdAt: { gte: since } } }),
  ]);

  return {
    member,
    total: count,
    byEvent: byEvent
      .map((row) => ({ event: row.event, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    events: events.map((e) => ({
      id: e.id,
      event: e.event,
      path: e.path,
      targetId: e.targetId,
      ip: e.ip,
      device: deviceLabel(e.device),
      userAgent: e.userAgent,
      createdAt: e.createdAt,
    })),
  };
}

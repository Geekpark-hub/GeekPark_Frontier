import { prisma } from '../prisma.js';

const ALLOWED_EVENTS = new Set([
  'app_open',
  'page_view',
  'poll_view',
  'poll_vote',
  'poll_share_view',
  'event_view',
  'event_register',
  'event_cancel_register',
  'event_share_view',
  'request_submit',
  'open_source',
  'feed_back_top',
  'subscribe_auth',
  'phone_auth',
  'wx_nick_auth',
  'share_click',
  'tab_switch',
]);

export const EVENT_LABELS = {
  app_open: '打开小程序',
  page_view: '浏览页面',
  poll_view: '查看投票',
  poll_vote: '提交投票',
  poll_share_view: '投票分享页',
  event_view: '查看活动',
  event_register: '活动报名',
  event_cancel_register: '取消报名',
  event_share_view: '活动分享页',
  request_submit: '提交需求',
  open_source: '打开原文',
  feed_back_top: '信息流回顶',
  subscribe_auth: '订阅授权',
  phone_auth: '手机号授权',
  wx_nick_auth: '微信昵称',
  share_click: '分享点击',
  tab_switch: '切换 Tab',
};

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

/** @returns {{ since: Date, until: Date, label: string, days?: number }} */
export function resolveAnalyticsRange(query = {}) {
  const fromRaw = query.from || query.startAt || '';
  const toRaw = query.to || query.endAt || '';
  if (fromRaw || toRaw) {
    const since = fromRaw ? new Date(fromRaw) : dayStart(29);
    const until = toRaw ? new Date(toRaw) : new Date();
    if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
      const err = new Error('时间范围无效');
      err.status = 400;
      throw err;
    }
    since.setHours(0, 0, 0, 0);
    until.setHours(23, 59, 59, 999);
    if (until < since) {
      const err = new Error('结束时间不能早于开始时间');
      err.status = 400;
      throw err;
    }
    const maxSpan = 366 * 24 * 60 * 60 * 1000;
    if (until - since > maxSpan) {
      const err = new Error('时间跨度不能超过 366 天');
      err.status = 400;
      throw err;
    }
    return {
      since,
      until,
      label: `${since.toISOString().slice(0, 10)} ~ ${until.toISOString().slice(0, 10)}`,
    };
  }
  const days = Math.max(1, Math.min(Number(query.days) || 30, 366));
  return {
    since: dayStart(days - 1),
    until: new Date(),
    days,
    label: `近 ${days} 天`,
  };
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

function rangeWhere(range, extra = {}) {
  return {
    ...extra,
    createdAt: { gte: range.since, lte: range.until },
  };
}

export async function getAnalyticsOverview(rangeOrDays = 30) {
  const range =
    typeof rangeOrDays === 'object' && rangeOrDays?.since
      ? rangeOrDays
      : resolveAnalyticsRange({ days: rangeOrDays });
  const since7 = dayStart(6);

  const [total, last7Unique, byEvent, recentActive, byPath] = await Promise.all([
    prisma.activityEvent.count({ where: rangeWhere(range) }),
    prisma.activityEvent.findMany({
      where: { createdAt: { gte: since7 } },
      select: { memberId: true },
      distinct: ['memberId'],
    }),
    prisma.activityEvent.groupBy({
      by: ['event'],
      where: rangeWhere(range),
      _count: { _all: true },
    }),
    prisma.activityEvent.findMany({
      where: rangeWhere(range),
      select: { memberId: true },
      distinct: ['memberId'],
    }),
    prisma.activityEvent.groupBy({
      by: ['path'],
      where: rangeWhere(range),
      _count: { _all: true },
    }),
  ]);

  const byEventSorted = byEvent
    .map((row) => ({ event: row.event, count: row._count._all }))
    .sort((a, b) => b.count - a.count);

  const byPathSorted = byPath
    .map((row) => ({ path: row.path || '(空)', count: row._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    days: range.days || null,
    rangeLabel: range.label,
    from: range.since.toISOString(),
    to: range.until.toISOString(),
    totalEvents: total,
    activeMembers7d: last7Unique.length,
    activeMembers: recentActive.length,
    byEvent: byEventSorted,
    byPath: byPathSorted,
  };
}

export async function getMemberActivityRanks(rangeOrDays = 30, limit = 50) {
  const range =
    typeof rangeOrDays === 'object' && rangeOrDays?.since
      ? rangeOrDays
      : resolveAnalyticsRange({ days: rangeOrDays });
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const groupedRaw = await prisma.activityEvent.groupBy({
    by: ['memberId'],
    where: rangeWhere(range),
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
        where: { memberId: g.memberId, ...rangeWhere(range) },
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

async function loadTargetTitleMaps(events) {
  const eventIds = new Set();
  const pollIds = new Set();
  for (const e of events) {
    const tid = String(e.targetId || '').trim();
    if (!tid) continue;
    if (String(e.event || '').startsWith('event_')) eventIds.add(tid);
    if (String(e.event || '').startsWith('poll_')) pollIds.add(tid);
  }
  const [eventsRows, pollsRows] = await Promise.all([
    eventIds.size
      ? prisma.event.findMany({
          where: { id: { in: [...eventIds] } },
          select: { id: true, title: true },
        })
      : [],
    pollIds.size
      ? prisma.poll.findMany({
          where: { id: { in: [...pollIds] } },
          select: { id: true, title: true },
        })
      : [],
  ]);
  return {
    eventTitle: new Map(eventsRows.map((r) => [r.id, r.title])),
    pollTitle: new Map(pollsRows.map((r) => [r.id, r.title])),
  };
}

function countByEvent(events) {
  const map = {};
  for (const e of events) {
    const key = e.event || 'unknown';
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

function uniqueTitles(events, eventName, titleMap) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (e.event !== eventName) continue;
    const tid = String(e.targetId || '').trim();
    if (!tid || seen.has(tid)) continue;
    seen.add(tid);
    out.push(titleMap.get(tid) || tid);
  }
  return out;
}

function topPaths(events, limit = 8) {
  const map = new Map();
  for (const e of events) {
    if (e.event !== 'page_view' && e.event !== 'tab_switch') continue;
    const p = e.path || '(空)';
    map.set(p, (map.get(p) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path, count]) => `${path}(${count})`);
}

function buildProfileFromEvents(events, titleMaps) {
  const counts = countByEvent(events);
  const cnt = (key) => counts[key] || 0;
  const knownKeys = [
    'app_open',
    'page_view',
    'tab_switch',
    'event_view',
    'event_register',
    'event_cancel_register',
    'event_share_view',
    'poll_view',
    'poll_vote',
    'poll_share_view',
    'open_source',
    'share_click',
    'subscribe_auth',
    'request_submit',
    'feed_back_top',
  ];
  const knownSum = knownKeys.reduce((s, k) => s + cnt(k), 0);
  return {
    counts: {
      appOpen: cnt('app_open'),
      pageView: cnt('page_view'),
      tabSwitch: cnt('tab_switch'),
      eventView: cnt('event_view'),
      eventRegister: cnt('event_register'),
      eventCancel: cnt('event_cancel_register'),
      eventShareView: cnt('event_share_view'),
      pollView: cnt('poll_view'),
      pollVote: cnt('poll_vote'),
      pollShareView: cnt('poll_share_view'),
      openSource: cnt('open_source'),
      shareClick: cnt('share_click'),
      subscribeAuth: cnt('subscribe_auth'),
      requestSubmit: cnt('request_submit'),
      feedBackTop: cnt('feed_back_top'),
      other: Math.max(0, events.length - knownSum),
      total: events.length,
    },
    registeredEvents: uniqueTitles(events, 'event_register', titleMaps.eventTitle),
    cancelledEvents: uniqueTitles(events, 'event_cancel_register', titleMaps.eventTitle),
    viewedEvents: uniqueTitles(events, 'event_view', titleMaps.eventTitle),
    votedPolls: uniqueTitles(events, 'poll_vote', titleMaps.pollTitle),
    viewedPolls: uniqueTitles(events, 'poll_view', titleMaps.pollTitle),
    topPaths: topPaths(events),
  };
}

async function loadBizActionsInRange(memberIds, range) {
  if (!memberIds.length) {
    return { regsByMember: new Map(), votesByMember: new Map() };
  }
  const [regs, votes] = await Promise.all([
    prisma.registration.findMany({
      where: {
        memberId: { in: memberIds },
        createdAt: { gte: range.since, lte: range.until },
        status: { not: 'cancelled' },
      },
      select: {
        memberId: true,
        status: true,
        event: { select: { id: true, title: true } },
      },
    }),
    prisma.vote.findMany({
      where: {
        memberId: { in: memberIds },
        createdAt: { gte: range.since, lte: range.until },
      },
      select: {
        memberId: true,
        pollId: true,
        poll: { select: { id: true, title: true } },
      },
      distinct: ['pollId', 'memberId'],
    }),
  ]);
  const regsByMember = new Map();
  for (const r of regs) {
    const list = regsByMember.get(r.memberId) || [];
    list.push(r.event?.title || r.event?.id || '');
    regsByMember.set(r.memberId, list);
  }
  const votesByMember = new Map();
  for (const v of votes) {
    const list = votesByMember.get(v.memberId) || [];
    const title = v.poll?.title || v.poll?.id || '';
    if (title && !list.includes(title)) list.push(title);
    votesByMember.set(v.memberId, list);
  }
  return { regsByMember, votesByMember };
}

function mergeUnique(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const x of [...a, ...b]) {
    const s = String(x || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * 单会员详情：补充按行为汇总 + 活动/投票标题
 */
export async function getMemberActivityDetail(memberId, { days = 30, from, to, limit = 80 } = {}) {
  const range = resolveAnalyticsRange({ days, from, to });
  const take = Math.min(Math.max(Number(limit) || 80, 1), 500);

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

  const [events, byEvent, count, allEvents] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { memberId, ...rangeWhere(range) },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.activityEvent.groupBy({
      by: ['event'],
      where: { memberId, ...rangeWhere(range) },
      _count: { _all: true },
    }),
    prisma.activityEvent.count({ where: { memberId, ...rangeWhere(range) } }),
    prisma.activityEvent.findMany({
      where: { memberId, ...rangeWhere(range) },
      select: { event: true, path: true, targetId: true },
    }),
  ]);

  const titleMaps = await loadTargetTitleMaps(allEvents);
  const profile = buildProfileFromEvents(allEvents, titleMaps);
  const { regsByMember, votesByMember } = await loadBizActionsInRange([memberId], range);
  profile.registeredEvents = mergeUnique(profile.registeredEvents, regsByMember.get(memberId));
  profile.votedPolls = mergeUnique(profile.votedPolls, votesByMember.get(memberId));

  return {
    member,
    rangeLabel: range.label,
    from: range.since.toISOString(),
    to: range.until.toISOString(),
    total: count,
    byEvent: byEvent
      .map((row) => ({ event: row.event, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    summary: profile,
    events: events.map((e) => ({
      id: e.id,
      event: e.event,
      path: e.path,
      targetId: e.targetId,
      targetTitle:
        (String(e.event || '').startsWith('event_') && titleMaps.eventTitle.get(e.targetId)) ||
        (String(e.event || '').startsWith('poll_') && titleMaps.pollTitle.get(e.targetId)) ||
        '',
      ip: e.ip,
      device: deviceLabel(e.device),
      userAgent: e.userAgent,
      createdAt: e.createdAt,
    })),
  };
}

/** 导出报告：按人汇总（含报名/投票明细） */
export async function getAnalyticsExportBundle(query = {}) {
  const range = resolveAnalyticsRange(query);
  const take = Math.min(Math.max(Number(query.limit) || 200, 1), 500);
  const [overview, ranks] = await Promise.all([
    getAnalyticsOverview(range),
    getMemberActivityRanks(range, take),
  ]);

  const memberIds = ranks.map((r) => r.memberId);
  const allEvents = memberIds.length
    ? await prisma.activityEvent.findMany({
        where: { memberId: { in: memberIds }, ...rangeWhere(range) },
        select: { memberId: true, event: true, path: true, targetId: true },
      })
    : [];

  const byMember = new Map();
  for (const e of allEvents) {
    const list = byMember.get(e.memberId) || [];
    list.push(e);
    byMember.set(e.memberId, list);
  }

  const titleMaps = await loadTargetTitleMaps(allEvents);
  const { regsByMember, votesByMember } = await loadBizActionsInRange(memberIds, range);

  const profiles = ranks.map((r) => {
    const evs = byMember.get(r.memberId) || [];
    const profile = buildProfileFromEvents(evs, titleMaps);
    profile.registeredEvents = mergeUnique(profile.registeredEvents, regsByMember.get(r.memberId));
    profile.votedPolls = mergeUnique(profile.votedPolls, votesByMember.get(r.memberId));
    return {
      memberId: r.memberId,
      name: r.name,
      company: r.company,
      phone: r.phone,
      status: r.status,
      lastAt: r.lastAt,
      lastEvent: r.lastEvent,
      lastDevice: r.lastDevice,
      ...profile,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    range,
    overview,
    members: ranks,
    profiles,
    eventLabels: EVENT_LABELS,
  };
}

function csvEscape(value) {
  // 全部加引号，避免 Excel 按区域设置误拆列
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function joinList(arr) {
  return (arr || []).filter(Boolean).join(' | ');
}

function formatBeijingCsvTime(input) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 生成 UTF-8 BOM CSV（Excel 可直接打开；首行 sep=, 强制逗号分隔） */
export function buildAnalyticsCsv(bundle) {
  const headers = [
    '姓名',
    '公司',
    '手机',
    '状态',
    '事件总数',
    '打开小程序',
    '浏览页面',
    '切换Tab',
    '查看活动',
    '活动报名次数',
    '报名活动数',
    '取消报名次数',
    '活动分享页',
    '查看投票',
    '提交投票次数',
    '投票数',
    '投票分享页',
    '打开原文',
    '分享点击',
    '订阅授权',
    '提交需求',
    '信息流回顶',
    '其他事件',
    '报名过的活动',
    '取消过的活动',
    '查看过的活动',
    '投过票的投票',
    '查看过的投票',
    '常访问页面',
    '最近活跃',
    '最近动作',
    '设备',
  ];
  const lines = ['sep=,', headers.map(csvEscape).join(',')];
  for (const p of bundle.profiles || []) {
    const c = p.counts || {};
    lines.push(
      [
        p.name,
        p.company,
        p.phone,
        p.status,
        c.total ?? 0,
        c.appOpen ?? 0,
        c.pageView ?? 0,
        c.tabSwitch ?? 0,
        c.eventView ?? 0,
        c.eventRegister ?? 0,
        (p.registeredEvents || []).length,
        c.eventCancel ?? 0,
        c.eventShareView ?? 0,
        c.pollView ?? 0,
        c.pollVote ?? 0,
        (p.votedPolls || []).length,
        c.pollShareView ?? 0,
        c.openSource ?? 0,
        c.shareClick ?? 0,
        c.subscribeAuth ?? 0,
        c.requestSubmit ?? 0,
        c.feedBackTop ?? 0,
        c.other ?? 0,
        joinList(p.registeredEvents),
        joinList(p.cancelledEvents),
        joinList(p.viewedEvents),
        joinList(p.votedPolls),
        joinList(p.viewedPolls),
        joinList(p.topPaths),
        formatBeijingCsvTime(p.lastAt),
        EVENT_LABELS[p.lastEvent] || p.lastEvent || '',
        p.lastDevice || '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

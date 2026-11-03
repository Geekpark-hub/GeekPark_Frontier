/**
 * 微信小程序订阅消息：会员到期 / 报名成功 / 活动开始提醒。
 * 模板 ID 见环境变量；未配置或未授权时仅记日志，不阻断主流程。
 */
import { prisma } from '../prisma.js';
import { getAccessToken } from '../wx.js';
import { writeNotifyLog } from './notifyLog.js';

function envId(...keys) {
  for (const k of keys) {
    const v = String(process.env[k] || '').trim();
    if (v) return v;
  }
  return '';
}

/** @returns {{ expiry: string, register: string, eventRemind: string }} */
export function getSubscribeTemplateIds() {
  const expiry = envId('WX_SUBSCRIBE_TEMPLATE_EXPIRY', 'WX_SUBSCRIBE_TEMPLATE_ID');
  const register = envId('WX_SUBSCRIBE_TEMPLATE_REGISTER');
  const eventRemind = envId('WX_SUBSCRIBE_TEMPLATE_EVENT_REMIND');
  return { expiry, register, eventRemind };
}

export function getNotifyStatus() {
  const ids = getSubscribeTemplateIds();
  return {
    subscribeTemplateId: ids.expiry,
    templates: ids,
    enabled: Boolean(ids.expiry || ids.register || ids.eventRemind),
  };
}

function emptyQuotaBucket(tmplIds) {
  return {
    accepts: Object.fromEntries(tmplIds.map((id) => [id, 0])),
    sent: Object.fromEntries(tmplIds.map((id) => [id, 0])),
    remaining: Object.fromEntries(tmplIds.map((id) => [id, 0])),
    byKind: { expiry: 0, register: 0, eventRemind: 0 },
    minRemaining: 0,
  };
}

function finalizeQuotaBucket(bucket, templates, tmplIds) {
  const remaining = {};
  let minRemaining = tmplIds.length ? Infinity : 0;
  for (const id of tmplIds) {
    remaining[id] = Math.max(0, (bucket.accepts[id] || 0) - (bucket.sent[id] || 0));
    minRemaining = Math.min(minRemaining, remaining[id]);
  }
  if (!Number.isFinite(minRemaining)) minRemaining = 0;
  return {
    accepts: bucket.accepts,
    sent: bucket.sent,
    remaining,
    byKind: {
      expiry: templates.expiry ? remaining[templates.expiry] || 0 : 0,
      register: templates.register ? remaining[templates.register] || 0 : 0,
      eventRemind: templates.eventRemind ? remaining[templates.eventRemind] || 0 : 0,
    },
    minRemaining,
  };
}

/**
 * 批量估算剩余推送机会：授权 accept − 成功发送（微信无官方查询接口）。
 * @param {string[]} memberIds
 */
export async function getMembersSubscribeQuotaMap(memberIds = []) {
  const templates = getSubscribeTemplateIds();
  const tmplIds = [templates.expiry, templates.register, templates.eventRemind].filter(Boolean);
  const ids = [...new Set((memberIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  /** @type {Record<string, ReturnType<typeof emptyQuotaBucket>>} */
  const buckets = {};
  for (const id of ids) buckets[id] = emptyQuotaBucket(tmplIds);

  if (!ids.length || !tmplIds.length) {
    return { templates, tmplIds, byMember: {} };
  }

  const events = await prisma.activityEvent.findMany({
    where: { memberId: { in: ids }, event: 'subscribe_auth' },
    select: { memberId: true, meta: true },
  });
  for (const row of events) {
    const bucket = buckets[row.memberId];
    if (!bucket) continue;
    let meta = {};
    try {
      meta = JSON.parse(row.meta || '{}') || {};
    } catch {
      meta = {};
    }
    const result = meta.result || {};
    for (const tid of tmplIds) {
      if (result[tid] === 'accept') bucket.accepts[tid] += 1;
    }
  }

  const logs = await prisma.notifyLog.groupBy({
    by: ['memberId', 'templateId'],
    where: {
      memberId: { in: ids },
      channel: 'wechat_subscribe',
      success: true,
      templateId: { in: tmplIds },
    },
    _count: { _all: true },
  });
  for (const row of logs) {
    const bucket = row.memberId ? buckets[row.memberId] : null;
    if (!bucket || !row.templateId) continue;
    if (Object.prototype.hasOwnProperty.call(bucket.sent, row.templateId)) {
      bucket.sent[row.templateId] = row._count._all;
    }
  }

  /** @type {Record<string, ReturnType<typeof finalizeQuotaBucket>>} */
  const byMember = {};
  for (const id of ids) {
    byMember[id] = finalizeQuotaBucket(buckets[id], templates, tmplIds);
  }
  return { templates, tmplIds, byMember };
}

/**
 * 估算单人剩余推送机会。
 * @param {string} memberId
 */
export async function getMemberSubscribeQuota(memberId) {
  const { templates, tmplIds, byMember } = await getMembersSubscribeQuotaMap(
    memberId ? [memberId] : []
  );
  const one = (memberId && byMember[memberId]) || emptyQuotaBucket(tmplIds);
  const finalized =
    memberId && byMember[memberId]
      ? byMember[memberId]
      : finalizeQuotaBucket(one, templates, tmplIds);
  return { templates, tmplIds, ...finalized };
}

function clipThing(v, max = 20) {
  const s = String(v || '').trim() || '—';
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function formatWxTime(value) {
  if (!value) return '待定';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return clipThing(value, 20);
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

/** 微信日期类关键词常用：2024年10月31日 */
function formatWxDateCn(value) {
  if (!value) return '待定';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return clipThing(value, 20);
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}年${get('month')}月${get('day')}日`;
}

/** 活动时间：模板示例 2026/06/02 10:00~11:30 */
function formatEventRange(startAt, endAt) {
  const start = formatWxTime(startAt).replace(/-/g, '/');
  if (!endAt) return start;
  const end = formatWxTime(endAt).replace(/-/g, '/');
  if (start === '待定' || end === '待定') return start;
  if (start.slice(0, 10) === end.slice(0, 10)) {
    return `${start}~${end.slice(11)}`;
  }
  return `${start.slice(5)}~${end.slice(5)}`;
}

/**
 * @param {{ openid: string, templateId: string, page: string, data: Record<string, { value: string }> }} opts
 */
async function sendSubscribeMessage(opts) {
  const openid = String(opts.openid || '').trim();
  const templateId = String(opts.templateId || '').trim();
  if (!templateId) {
    return { sent: false, mode: 'log_only', message: '未配置订阅消息模板 ID' };
  }
  if (!openid) {
    return { sent: false, mode: 'log_only', message: '会员未绑定微信 openid，无法推送' };
  }
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: openid,
          template_id: templateId,
          page: opts.page || 'pages/mine/index',
          data: opts.data || {},
          miniprogram_state: process.env.WX_SUBSCRIBE_STATE || 'formal',
        }),
      }
    );
    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      return {
        sent: false,
        mode: 'wechat',
        message: data.errmsg || '订阅消息发送失败',
        raw: data,
      };
    }
    return { sent: true, mode: 'wechat', message: 'ok' };
  } catch (err) {
    return { sent: false, mode: 'wechat', message: err.message || '发送异常' };
  }
}

export async function sendExpiryNotice(member, { daysLeft }) {
  const { expiry } = getSubscribeTemplateIds();
  // 微信模板真实字段：time4 / time2 / thing1 / short_thing5 / character_string6
  const signedAt = member.joinedAt || member.createdAt;
  const remain = daysLeft <= 0 ? '已到期' : `${daysLeft}天`;
  const account =
    String(member.phone || '').replace(/\D/g, '') ||
    String(member.inviteCode || '').replace(/[^\w-]/g, '') ||
    'member';
  const page = 'pages/mine/index';
  const result = await sendSubscribeMessage({
    openid: member.openid,
    templateId: expiry,
    page,
    data: {
      time4: { value: formatWxDateCn(signedAt) },
      time2: { value: formatWxDateCn(member.expiresAt) },
      thing1: { value: clipThing('前沿社会员') },
      short_thing5: { value: clipThing(remain, 5) },
      character_string6: { value: clipThing(account, 32) },
    },
  });
  writeNotifyLog({
    channel: 'wechat_subscribe',
    kind: 'expiry',
    memberId: member.id,
    memberName: member.name || '',
    targetType: 'member',
    targetId: member.id,
    targetTitle: `到期提醒 · 剩余${remain}`,
    templateId: expiry,
    page,
    success: Boolean(result.sent),
    mode: result.mode || '',
    message: result.message || '',
    detail: { daysLeft, raw: result.raw || null },
  });
  if (!result.sent) {
    console.log('[notify] expiry', member.id, result.message);
  }
  return result;
}

export async function sendRegisterSuccessNotice(member, event) {
  const { register } = getSubscribeTemplateIds();
  // 微信模板真实字段：thing1 / time6 / time3 / thing4 / thing5
  const page = `pages/events/share?id=${event.id}`;
  const result = await sendSubscribeMessage({
    openid: member.openid,
    templateId: register,
    page,
    data: {
      thing1: { value: clipThing(event.title) },
      time6: { value: formatEventRange(event.startAt, event.endAt) },
      time3: { value: formatWxTime(event.startAt) },
      thing4: { value: clipThing(event.location || '详见活动页') },
      thing5: { value: clipThing('报名成功，请准时参加') },
    },
  });
  writeNotifyLog({
    channel: 'wechat_subscribe',
    kind: 'register',
    memberId: member.id,
    memberName: member.name || '',
    targetType: 'event',
    targetId: event.id,
    targetTitle: event.title || '',
    templateId: register,
    page,
    success: Boolean(result.sent),
    mode: result.mode || '',
    message: result.message || '',
    detail: { raw: result.raw || null },
  });
  if (!result.sent) {
    console.log('[notify] register', member.id, event.id, result.message);
  }
  return result;
}

export async function sendEventRemindNotice(member, event) {
  const { eventRemind } = getSubscribeTemplateIds();
  // 微信模板真实字段：thing1 / time2 / thing4 / thing8 / thing18
  const guests = String(event.guests || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('、');
  const intro = String(event.description || '').replace(/\s+/g, ' ').trim();
  const page = `pages/events/share?id=${event.id}`;
  const result = await sendSubscribeMessage({
    openid: member.openid,
    templateId: eventRemind,
    page,
    data: {
      thing1: { value: clipThing(event.title) },
      time2: { value: formatWxTime(event.startAt) },
      thing4: { value: clipThing(event.location || '详见活动页') },
      thing8: { value: clipThing(guests || '详见活动页') },
      thing18: { value: clipThing(intro || '活动即将开始，请准时参加') },
    },
  });
  writeNotifyLog({
    channel: 'wechat_subscribe',
    kind: 'event_remind',
    memberId: member.id,
    memberName: member.name || '',
    targetType: 'event',
    targetId: event.id,
    targetTitle: event.title || '',
    templateId: eventRemind,
    page,
    success: Boolean(result.sent),
    mode: result.mode || '',
    message: result.message || '',
    detail: { raw: result.raw || null },
  });
  if (!result.sent) {
    console.log('[notify] eventRemind', member.id, event.id, result.message);
  }
  return result;
}

/**
 * 飞书推送：
 * - 配置 FEISHU_APP_ID + FEISHU_APP_SECRET + FEISHU_CHAT_ID → 应用机器人发卡片，点按钮原地更新
 * - 仅 FEISHU_WEBHOOK_URL → 自定义机器人发卡片，按钮跳转 HTTPS（兼容旧方式）
 */
import crypto from 'crypto';
import { writeNotifyLog } from './notifyLog.js';

function truncate(text, max = 400) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function maskPhone(phone) {
  const s = String(phone || '').replace(/\D/g, '');
  if (!s) return '';
  if (s.length < 7) return '***';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

function formatDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function actionSecret() {
  return (
    process.env.FEISHU_ACTION_SECRET ||
    process.env.JWT_SECRET ||
    'frontier-feishu-action-dev'
  );
}

export function getPublicApiBase() {
  const raw =
    process.env.PUBLIC_API_BASE ||
    process.env.FEISHU_ACTION_BASE_URL ||
    'https://frontier-api.geekpark.net';
  return String(raw).replace(/\/$/, '');
}

export function getFeedPushLimit() {
  const n = Number(process.env.FEISHU_FEED_PUSH_LIMIT || 8);
  if (!Number.isFinite(n) || n < 1) return 8;
  return Math.min(Math.floor(n), 20);
}

/** app_callback | webhook_url | off */
export function getFeishuInteractiveMode() {
  if (
    process.env.FEISHU_APP_ID &&
    process.env.FEISHU_APP_SECRET &&
    process.env.FEISHU_CHAT_ID
  ) {
    return 'app_callback';
  }
  if (process.env.FEISHU_WEBHOOK_URL) return 'webhook_url';
  return 'off';
}

export function getFeishuStatus() {
  const mode = getFeishuInteractiveMode();
  return {
    webhookConfigured: Boolean(process.env.FEISHU_WEBHOOK_URL),
    appConfigured: Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET),
    chatConfigured: Boolean(process.env.FEISHU_CHAT_ID),
    interactiveMode: mode,
    feedPushLimit: getFeedPushLimit(),
    publicApiBase: getPublicApiBase(),
  };
}

function signFeedAction(postId, action, exp) {
  const payload = `${postId}.${action}.${exp}`;
  return crypto.createHmac('sha256', actionSecret()).update(payload).digest('hex').slice(0, 32);
}

/** 生成可点开的批准/拒绝链接（默认 7 天有效；兼容旧卡片） */
export function buildFeedActionUrl(postId, action, ttlSec = 7 * 24 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = signFeedAction(postId, action, exp);
  const base = getPublicApiBase();
  const q = new URLSearchParams({ exp: String(exp), sig });
  return `${base}/api/feishu/feed/${encodeURIComponent(postId)}/${action}?${q}`;
}

export function buildFeedActionValue(postId, action, ttlSec = 7 * 24 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = signFeedAction(postId, action, exp);
  return {
    action,
    postId: String(postId),
    exp: String(exp),
    sig,
  };
}

export function verifyFeedAction(postId, action, exp, sig) {
  const expNum = Number(exp);
  if (!postId || !action || !sig || !Number.isFinite(expNum)) {
    return { ok: false, message: '链接参数无效' };
  }
  if (expNum < Math.floor(Date.now() / 1000)) {
    return { ok: false, message: '操作已过期，请到管理后台处理' };
  }
  if (action !== 'approve' && action !== 'reject') {
    return { ok: false, message: '未知操作' };
  }
  const expect = signFeedAction(postId, action, expNum);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, message: '签名校验失败' };
  }
  return { ok: true };
}

async function postWebhook(body) {
  const webhook = process.env.FEISHU_WEBHOOK_URL;
  if (!webhook) {
    return { sent: false, mode: 'skipped', message: '未配置 FEISHU_WEBHOOK_URL' };
  }
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const ok = data.code === 0 || data.StatusCode === 0 || res.ok;
    if (!ok) {
      return {
        sent: false,
        mode: 'feishu',
        message: data.msg || data.StatusMessage || `HTTP ${res.status}`,
        raw: data,
      };
    }
    return { sent: true, mode: 'feishu', message: 'ok' };
  } catch (err) {
    return { sent: false, mode: 'feishu', message: err.message || '飞书推送异常' };
  }
}

let cachedToken = { token: '', expireAt: 0 };

export async function getTenantAccessToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET');
  }
  if (cachedToken.token && Date.now() < cachedToken.expireAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.tenant_access_token) {
    throw new Error(data.msg || '获取 tenant_access_token 失败');
  }
  cachedToken = {
    token: data.tenant_access_token,
    expireAt: Date.now() + (Number(data.expire) || 7200) * 1000,
  };
  return cachedToken.token;
}

async function sendCardViaApp(card) {
  const chatId = process.env.FEISHU_CHAT_ID;
  if (!chatId) {
    return { sent: false, mode: 'skipped', message: '未配置 FEISHU_CHAT_ID' };
  }
  try {
    const token = await getTenantAccessToken();
    const res = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (data.code !== 0) {
      return {
        sent: false,
        mode: 'feishu_app',
        message: data.msg || `HTTP ${res.status}`,
        raw: data,
      };
    }
    return { sent: true, mode: 'feishu_app', message: 'ok', messageId: data.data?.message_id };
  } catch (err) {
    return { sent: false, mode: 'feishu_app', message: err.message || '飞书应用发消息失败' };
  }
}

/** 发送纯文本 */
export async function sendFeishuText(text) {
  if (getFeishuInteractiveMode() === 'app_callback') {
    // 应用模式用极简卡片代文本
    return sendCardViaApp({
      elements: [
        {
          tag: 'div',
          text: { tag: 'plain_text', content: String(text || '').slice(0, 3500) },
        },
      ],
    });
  }
  return postWebhook({
    msg_type: 'text',
    content: { text: String(text || '').slice(0, 3500) },
  });
}

/** 发送交互卡片 */
export async function sendFeishuCard(card) {
  if (getFeishuInteractiveMode() === 'app_callback') {
    return sendCardViaApp(card);
  }
  return postWebhook({
    msg_type: 'interactive',
    card,
  });
}

function escapeMd(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function feedBodyElements(post) {
  const member = post.relatedMember;
  const memberLine = member
    ? `${escapeMd(member.name)}${member.company ? ` · ${escapeMd(member.company)}` : ''}`
    : '未关联会员';
  const excerpt = truncate(post.content || '', 160);
  const reason = truncate(post.aiReason || '', 80);
  const source = String(post.sourceUrl || '').trim();
  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          `**${escapeMd(truncate(post.title, 80))}**`,
          `会员：${memberLine}`,
          excerpt ? `\n${escapeMd(excerpt)}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    },
  ];
  if (source) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `[查看原文](${source})`,
      },
    });
  }
  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: reason ? `AI：${reason}` : `ID ${post.id}`,
      },
    ],
  });
  return elements;
}

export function feedPendingCard(post, { interactive } = {}) {
  const mode = interactive || getFeishuInteractiveMode();
  const useCallback = mode === 'app_callback';
  const body = feedBodyElements(post);
  const note = body[body.length - 1];
  const elements = body.slice(0, -1);

  const actions = useCallback
    ? [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '批准发布' },
          type: 'primary',
          value: buildFeedActionValue(post.id, 'approve'),
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '拒绝' },
          type: 'danger',
          value: buildFeedActionValue(post.id, 'reject'),
        },
      ]
    : [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '批准发布' },
          type: 'primary',
          url: buildFeedActionUrl(post.id, 'approve'),
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '拒绝' },
          type: 'danger',
          url: buildFeedActionUrl(post.id, 'reject'),
        },
      ];

  elements.push({ tag: 'action', actions });
  elements.push(note);

  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: '待审核 · 前沿社动态',
      },
    },
    elements,
  };
}

/** 审批结果卡：无按钮，原地替换 */
export function feedResultCard(post, { ok, title, detail }) {
  const body = feedBodyElements(post);
  const note = body[body.length - 1];
  const elements = body.slice(0, -1);
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**${escapeMd(title)}**\n${escapeMd(detail || '')}`,
    },
  });
  elements.push(note);
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: ok ? 'green' : 'red',
      title: {
        tag: 'plain_text',
        content: ok ? '已处理 · 前沿社动态' : '处理失败 · 前沿社动态',
      },
    },
    elements,
  };
}

function feedSummaryCard({ total, pushed, interactive }) {
  const tip =
    interactive === 'app_callback'
      ? '点下方卡片按钮即可批准/拒绝（卡片会直接更新）。'
      : '可直接点下方卡片批准/拒绝。';
  const extra =
    pushed < total ? `其余 ${total - pushed} 条请到管理后台「动态」查看。` : tip;
  return {
    header: {
      template: 'turquoise',
      title: {
        tag: 'plain_text',
        content: 'AI 抓取完成',
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `新增待审 **${total}** 条，本群推送 **${pushed}** 条。${extra}`,
        },
      },
    ],
  };
}

/**
 * 维护任务：订阅消息未送达提醒卡（颜色区分失败 / 未推送）
 * @param {{
 *   at?: Date|string,
 *   expiredMembers?: number,
 *   expiryOk?: number,
 *   expirySkipped?: number,
 *   expiryFailed?: number,
 *   remindOk?: number,
 *   remindSkipped?: number,
 *   remindFailed?: number,
 *   expirySkipRows?: { name: string, tip: string, reason: string }[],
 *   expiryFailRows?: { name: string, tip: string, reason: string }[],
 *   remindSkipRows?: { name: string, tip: string, reason: string }[],
 *   remindFailRows?: { name: string, tip: string, reason: string }[],
 * }} payload
 */
export function maintenanceAlertCard(payload = {}) {
  const failN = (payload.expiryFailed || 0) + (payload.remindFailed || 0);
  const skipN = (payload.expirySkipped || 0) + (payload.remindSkipped || 0);
  const headerTemplate = failN > 0 ? 'red' : 'orange';
  const headerTitle =
    failN > 0 ? '维护提醒 · 有推送失败' : '维护提醒 · 有消息未推送';

  const timeText =
    payload.at instanceof Date
      ? payload.at.toISOString()
      : String(payload.at || new Date().toISOString());

  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          `**本轮结果**`,
          `状态改为已过期：**${payload.expiredMembers || 0}** 人（只改库，不是发微信）`,
          `会员到期订阅消息：成功 **${payload.expiryOk || 0}** / 未推送 **${payload.expirySkipped || 0}** / 失败 **${payload.expiryFailed || 0}**`,
          `活动开始订阅消息：成功 **${payload.remindOk || 0}** / 未推送 **${payload.remindSkipped || 0}** / 失败 **${payload.remindFailed || 0}**`,
        ].join('\n'),
      },
    },
  ];

  function pushRows(title, rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return;
    const lines = list.slice(0, 8).map((r) => {
      const who = escapeMd(r.name || '未知');
      const tip = r.tip ? `（${escapeMd(r.tip)}）` : '';
      const reason = escapeMd(r.reason || '');
      return `· ${who}${tip}：${reason}`;
    });
    if (list.length > 8) lines.push(`· …另有 ${list.length - 8} 人`);
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${escapeMd(title)}**\n${lines.join('\n')}`,
      },
    });
  }

  pushRows('会员到期 · 未推送', payload.expirySkipRows);
  pushRows('会员到期 · 失败待重试', payload.expiryFailRows);
  pushRows('活动开始 · 未推送', payload.remindSkipRows);
  pushRows('活动开始 · 失败待重试', payload.remindFailRows);

  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: [
        '**说明**',
        '· 未推送：没绑微信 / 没模板等，本阶段不自动重发',
        '· 失败：微信接口报错，下次维护会重试',
        '· 明细见后台「消息中心」',
      ].join('\n'),
    },
  });

  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: `时间 ${timeText} · 未推送 ${skipN} · 失败 ${failN}`,
      },
    ],
  });

  return {
    config: { wide_screen_mode: true },
    header: {
      template: headerTemplate,
      title: { tag: 'plain_text', content: headerTitle },
    },
    elements,
  };
}

/**
 * AI 抓取后：汇总卡 + 限量待审卡
 * @param {object[]} posts FeedPost（含 relatedMember）
 */
export async function notifyPendingFeedPosts(posts, { summary = '' } = {}) {
  const mode = getFeishuInteractiveMode();
  if (mode === 'off') {
    return { sent: false, mode: 'skipped', pushed: 0, total: 0 };
  }
  const list = Array.isArray(posts) ? posts.filter((p) => p && p.id) : [];
  if (!list.length) {
    return { sent: false, mode: 'skipped', pushed: 0, total: 0, message: '无待审' };
  }

  const limit = getFeedPushLimit();
  const batch = list.slice(0, limit);
  const results = { total: list.length, pushed: 0, failed: 0, mode };

  let sum = { sent: false, mode: 'skipped' };
  if (list.length > 1 || batch.length < list.length) {
    sum = await sendFeishuCard(
      feedSummaryCard({ total: list.length, pushed: batch.length, interactive: mode })
    );
    if (!sum.sent && sum.mode !== 'skipped') {
      console.warn('[feishu] feed summary failed:', sum.message);
    }
  }

  for (const post of batch) {
    await sleep(350);
    const r = await sendFeishuCard(feedPendingCard(post, { interactive: mode }));
    if (r.sent) results.pushed += 1;
    else {
      results.failed += 1;
      if (r.mode !== 'skipped') {
        console.warn('[feishu] feed card failed:', post.id, r.message);
      }
    }
  }

  console.log(
    `[feishu] feed notify mode=${mode} total=${results.total} pushed=${results.pushed} failed=${results.failed}`
  );
  return { sent: results.pushed > 0 || sum.sent, ...results };
}

/** 会员新需求 → 运营群（交互卡片） */
export async function notifyRequestSubmitted({ member, request }) {
  if (getFeishuInteractiveMode() === 'off') {
    return { sent: false, mode: 'skipped', message: '未配置飞书' };
  }
  const name = (member && member.name) || '会员';
  const company = (member && member.company) || '';
  const phone = maskPhone(member && member.phone);
  const lines = [
    `**会员**：${escapeMd(name)}${company ? ` · ${escapeMd(company)}` : ''}`,
    phone ? `**手机**：${phone}` : '',
    `**内容**：${escapeMd(truncate(request.content, 500))}`,
  ];
  if (request.location) lines.push(`**地点**：${escapeMd(request.location)}`);
  if (request.connectWith) {
    lines.push(`**希望连接**：${escapeMd(truncate(request.connectWith, 120))}`);
  }
  const range = [request.startAt, request.endAt]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ~ ');
  if (range) lines.push(`**时间**：${escapeMd(range)}`);
  lines.push(`**状态**：${request.status || 'submitted'}`);

  const card = {
    header: {
      template: 'orange',
      title: { tag: 'plain_text', content: '新会员需求 · 前沿社' },
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: lines.filter(Boolean).join('\n') },
      },
    ],
  };

  let result = await sendFeishuCard(card);
  if (!result.sent && result.mode !== 'skipped' && process.env.FEISHU_WEBHOOK_URL) {
    const text = [
      '【前沿社】新会员需求',
      `会员：${name}${company ? ` · ${company}` : ''}`,
      phone ? `手机：${phone}` : '',
      `内容：${truncate(request.content, 500)}`,
    ]
      .filter(Boolean)
      .join('\n');
    result = await postWebhook({
      msg_type: 'text',
      content: { text },
    });
  }
  if (!result.sent && result.mode !== 'skipped') {
    console.warn('[feishu] request notify failed:', result.message);
  } else if (result.sent) {
    console.log('[feishu] request notify sent', request.id);
  }
  return result;
}

/** 会员活动报名成功 → 运营群 */
export async function notifyEventRegistered({ member, event, registration }) {
  if (getFeishuInteractiveMode() === 'off') {
    return { sent: false, mode: 'skipped', message: '未配置飞书' };
  }
  const name = (member && member.name) || '会员';
  const company = (member && member.company) || '';
  const phone = maskPhone(member && member.phone);
  const regName = (registration && registration.name) || name;
  const lines = [
    `**活动**：${escapeMd(truncate(event.title, 80))}`,
    `**会员**：${escapeMd(name)}${company ? ` · ${escapeMd(company)}` : ''}`,
    phone ? `**手机**：${phone}` : '',
    `**报名姓名**：${escapeMd(regName)}`,
  ];
  if (event.startAt) lines.push(`**开始**：${escapeMd(formatDate(event.startAt))}`);
  if (event.location) lines.push(`**地点**：${escapeMd(event.location)}`);
  if (registration?.companions) {
    lines.push(`**同行**：${escapeMd(truncate(registration.companions, 80))}`);
  }
  if (registration?.specialNeeds) {
    lines.push(`**特殊需求**：${escapeMd(truncate(registration.specialNeeds, 120))}`);
  }
  lines.push(`**状态**：${registration?.status || 'approved'}`);

  const card = {
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: '活动新报名 · 前沿社' },
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: lines.filter(Boolean).join('\n') },
      },
    ],
  };

  let result = await sendFeishuCard(card);
  if (!result.sent && result.mode !== 'skipped' && process.env.FEISHU_WEBHOOK_URL) {
    const text = [
      '【前沿社】活动新报名',
      `活动：${truncate(event.title, 80)}`,
      `会员：${name}${company ? ` · ${company}` : ''}`,
      phone ? `手机：${phone}` : '',
      `报名姓名：${regName}`,
    ]
      .filter(Boolean)
      .join('\n');
    result = await postWebhook({
      msg_type: 'text',
      content: { text },
    });
  }
  writeNotifyLog({
    channel: 'feishu',
    kind: 'event_register_feishu',
    memberId: member?.id || null,
    memberName: name,
    targetType: 'event',
    targetId: event?.id || '',
    targetTitle: event?.title || '',
    success: Boolean(result.sent),
    mode: result.mode || '',
    message: result.message || '',
    detail: { registrationId: registration?.id || '' },
  });
  if (!result.sent && result.mode !== 'skipped') {
    console.warn('[feishu] event register notify failed:', result.message);
  } else if (result.sent) {
    console.log('[feishu] event register notify sent', event.id, registration?.id);
  }
  return result;
}

/** 会员取消活动报名 → 运营群 */
export async function notifyEventCancelled({ member, event, registration }) {
  if (getFeishuInteractiveMode() === 'off') {
    return { sent: false, mode: 'skipped', message: '未配置飞书' };
  }
  const name = (member && member.name) || '会员';
  const company = (member && member.company) || '';
  const phone = maskPhone(member && member.phone);
  const regName = (registration && registration.name) || name;
  const lines = [
    `**活动**：${escapeMd(truncate(event.title, 80))}`,
    `**会员**：${escapeMd(name)}${company ? ` · ${escapeMd(company)}` : ''}`,
    phone ? `**手机**：${phone}` : '',
    `**报名姓名**：${escapeMd(regName)}`,
    '**状态**：已取消报名',
  ];

  const card = {
    header: {
      template: 'grey',
      title: { tag: 'plain_text', content: '活动取消报名 · 前沿社' },
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: lines.filter(Boolean).join('\n') },
      },
    ],
  };

  let result = await sendFeishuCard(card);
  if (!result.sent && result.mode !== 'skipped' && process.env.FEISHU_WEBHOOK_URL) {
    const text = [
      '【前沿社】活动取消报名',
      `活动：${truncate(event.title, 80)}`,
      `会员：${name}${company ? ` · ${company}` : ''}`,
      phone ? `手机：${phone}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    result = await postWebhook({
      msg_type: 'text',
      content: { text },
    });
  }
  writeNotifyLog({
    channel: 'feishu',
    kind: 'event_cancel_feishu',
    memberId: member?.id || null,
    memberName: name,
    targetType: 'event',
    targetId: event?.id || '',
    targetTitle: event?.title || '',
    success: Boolean(result.sent),
    mode: result.mode || '',
    message: result.message || '',
    detail: { registrationId: registration?.id || '' },
  });
  if (!result.sent && result.mode !== 'skipped') {
    console.warn('[feishu] event cancel notify failed:', result.message);
  } else if (result.sent) {
    console.log('[feishu] event cancel notify sent', event.id, registration?.id);
  }
  return result;
}

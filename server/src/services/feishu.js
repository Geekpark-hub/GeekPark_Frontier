/**
 * 飞书自定义机器人 Webhook 推送。
 * 配置 FEISHU_WEBHOOK_URL 后生效；未配置则静默跳过。
 */

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

export function getFeishuStatus() {
  return {
    webhookConfigured: Boolean(process.env.FEISHU_WEBHOOK_URL),
  };
}

/**
 * 发送纯文本（兼容大多数自定义机器人）
 */
export async function sendFeishuText(text) {
  const webhook = process.env.FEISHU_WEBHOOK_URL;
  if (!webhook) {
    return { sent: false, mode: 'skipped', message: '未配置 FEISHU_WEBHOOK_URL' };
  }

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: String(text || '').slice(0, 3500) },
      }),
    });
    const data = await res.json().catch(() => ({}));
    // 飞书成功一般为 code === 0；部分旧机器人用 StatusCode
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

/** 会员新需求 → 运营群 */
export async function notifyRequestSubmitted({ member, request }) {
  const name = (member && member.name) || '会员';
  const company = (member && member.company) || '';
  const phone = maskPhone(member && member.phone);
  const lines = [
    '【前沿社】新会员需求',
    `会员：${name}${company ? ` · ${company}` : ''}`,
    phone ? `手机：${phone}` : '',
    `内容：${truncate(request.content, 500)}`,
  ];

  if (request.location) lines.push(`地点：${request.location}`);
  if (request.connectWith) lines.push(`希望连接：${truncate(request.connectWith, 120)}`);

  const range = [formatDate(request.startAt), formatDate(request.endAt)].filter(Boolean).join(' ~ ');
  if (range) lines.push(`时间：${range}`);

  lines.push(`状态：${request.status || 'submitted'}`);

  const text = lines.filter(Boolean).join('\n');
  const result = await sendFeishuText(text);
  if (!result.sent && result.mode !== 'skipped') {
    console.warn('[feishu] request notify failed:', result.message);
  } else if (result.sent) {
    console.log('[feishu] request notify sent', request.id);
  }
  return result;
}

/**
 * 到期提醒：有订阅消息模板则尝试发送；否则仅记日志供运营跟进。
 */

export function getNotifyStatus() {
  return {
    subscribeTemplateId: process.env.WX_SUBSCRIBE_TEMPLATE_ID || '',
    enabled: Boolean(process.env.WX_SUBSCRIBE_TEMPLATE_ID),
  };
}

export async function sendExpiryNotice(member, { daysLeft }) {
  const templateId = process.env.WX_SUBSCRIBE_TEMPLATE_ID;
  if (!templateId || !member.openid) {
    return {
      sent: false,
      mode: 'log_only',
      message: !templateId
        ? '未配置 WX_SUBSCRIBE_TEMPLATE_ID，仅记录待提醒'
        : '会员未绑定微信 openid，无法推送',
    };
  }

  // 真实发送需要用户曾授权订阅消息；此处预留接口，失败不阻断主流程
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: member.openid,
          template_id: templateId,
          page: 'pages/mine/index',
          data: {
            thing1: { value: member.name.slice(0, 20) },
            thing2: { value: daysLeft <= 0 ? '会员已到期' : `${daysLeft}天后到期` },
          },
        }),
      }
    );
    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      return { sent: false, mode: 'wechat', message: data.errmsg || '订阅消息发送失败', raw: data };
    }
    return { sent: true, mode: 'wechat', message: 'ok' };
  } catch (err) {
    return { sent: false, mode: 'wechat', message: err.message || '发送异常' };
  }
}

async function getAccessToken() {
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appid || !secret) throw new Error('缺少 WX_APPID / WX_SECRET');
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.access_token) throw new Error(data.errmsg || '获取 access_token 失败');
  return data.access_token;
}

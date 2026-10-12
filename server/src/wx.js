let cachedToken = null;
let cachedExpireAt = 0;

export async function getAccessToken() {
  const appId = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appId || !secret) {
    const err = new Error('微信尚未配置');
    err.status = 501;
    throw err;
  }

  if (cachedToken && Date.now() < cachedExpireAt) {
    return cachedToken;
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${secret}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.access_token) {
    const err = new Error(data.errmsg || '获取 access_token 失败');
    err.status = 400;
    err.detail = data;
    throw err;
  }

  cachedToken = data.access_token;
  cachedExpireAt = Date.now() + (Number(data.expires_in || 7200) - 120) * 1000;
  return cachedToken;
}

export async function codeToOpenid(code) {
  const appId = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appId || !secret) {
    const err = new Error('微信登录尚未配置');
    err.status = 501;
    throw err;
  }
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
  const wxRes = await fetch(url);
  const data = await wxRes.json();
  if (data.errcode) {
    const err = new Error(data.errmsg || '微信登录失败');
    err.status = 400;
    err.detail = data;
    throw err;
  }
  return data.openid;
}

export async function phoneCodeToNumber(phoneCode) {
  const token = await getAccessToken();
  const res = await fetch(
    `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: phoneCode }),
    }
  );
  const data = await res.json();
  if (data.errcode) {
    const err = new Error(data.errmsg || '获取手机号失败');
    err.status = 400;
    err.detail = data;
    throw err;
  }
  const phone = data.phone_info?.purePhoneNumber || data.phone_info?.phoneNumber;
  if (!phone) {
    const err = new Error('未获取到手机号');
    err.status = 400;
    throw err;
  }
  return String(phone).replace(/\D/g, '').slice(-11);
}

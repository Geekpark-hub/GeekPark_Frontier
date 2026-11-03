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

async function requestUrlLink({ path, query, expireInterval, envVersion }) {
  const token = await getAccessToken();
  const res = await fetch(
    `https://api.weixin.qq.com/wxa/generate_urllink?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        query,
        expire_type: 1,
        expire_interval: expireInterval,
        env_version: envVersion,
      }),
    }
  );
  return res.json();
}

/**
 * 生成可外部分享的小程序 URL Link（短信/邮件/浏览器可点，跳转进微信小程序）
 * @param {{ path: string, query?: string, expireIntervalDays?: number, envVersion?: string }} opts
 * @returns {Promise<{ urlLink: string, envVersion: string }>}
 */
export async function generateUrlLink(opts = {}) {
  const path = String(opts.path || '').replace(/^\//, '');
  const query = String(opts.query || '').replace(/^\?/, '');
  const expireInterval = Math.min(Math.max(Number(opts.expireIntervalDays) || 30, 1), 30);
  const preferred = opts.envVersion || process.env.WX_URL_LINK_ENV || 'release';
  const versions = preferred === 'release' ? ['release', 'trial'] : [preferred];

  let last = null;
  for (const envVersion of versions) {
    const data = await requestUrlLink({ path, query, expireInterval, envVersion });
    last = data;
    if (!data.errcode && data.url_link) {
      return { urlLink: data.url_link, envVersion };
    }
    // 85079：无正式版；可继续试体验版
    if (data.errcode !== 85079) break;
  }

  const err = new Error(
    last?.errcode === 85079
      ? '微信规定外部分享短链必须已有正式版，只上传体验版无法生成'
      : (last?.errmsg || '生成分享链接失败')
  );
  err.status = 400;
  err.detail = last;
  throw err;
}

function detectImageMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return '';
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // JPEG（微信 getwxacodeunlimit 常返回 JPEG）
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return '';
}

function parseWxCodeResponse(buf) {
  const mime = detectImageMime(buf);
  if (mime) return { ok: true, buffer: buf, contentType: mime };
  // 失败时微信返回 JSON；成功图不要当文本解析
  if (Buffer.isBuffer(buf) && buf[0] === 0x7b) {
    try {
      return { ok: false, error: JSON.parse(buf.toString('utf8')) };
    } catch {
      // fallthrough
    }
  }
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8').replace(/^\uFEFF/, '').trim() : '';
  return {
    ok: false,
    error: {
      errmsg: '生成小程序码失败',
      raw: text.slice(0, 240),
      hex: Buffer.isBuffer(buf) ? buf.slice(0, 24).toString('hex') : '',
      bytes: Buffer.isBuffer(buf) ? buf.length : 0,
    },
  };
}

async function requestWxaCodeLimited({ pathWithQuery, width, envVersion, token, hyaline }) {
  const res = await fetch(
    `https://api.weixin.qq.com/wxa/getwxacode?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: pathWithQuery,
        width,
        // 官方默认黑码，勿开 auto_color（会变成非标准配色）
        auto_color: false,
        line_color: { r: 0, g: 0, b: 0 },
        // is_hyaline=true：微信官方透明底圆形码；false：白底方图（圆形码+白边）
        is_hyaline: Boolean(hyaline),
        env_version: envVersion,
      }),
    }
  );
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 无限量小程序码：支持 check_path=false，未正式发布时也可生成体验版码。
 * scene 最大 32 字符；page 不可带 query。
 */
async function requestWxaCodeUnlimited({ page, scene, width, envVersion, token, hyaline }) {
  const res = await fetch(
    `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page,
        scene,
        check_path: false,
        width,
        auto_color: false,
        line_color: { r: 0, g: 0, b: 0 },
        is_hyaline: Boolean(hyaline),
        env_version: envVersion,
      }),
    }
  );
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 生成小程序码（圆形码，可带 query）
 * 无正式版时用无限码 + 体验版（check_path=false）。
 * @param {{ path: string, width?: number, envVersion?: string, scene?: string, hyaline?: boolean }} opts
 * @returns {Promise<{ buffer: Buffer, contentType: string, envVersion: string }>}
 */
export async function generateWxaCode(opts = {}) {
  const pathWithQuery = String(opts.path || '').replace(/^\//, '');
  if (!pathWithQuery) {
    const err = new Error('缺少小程序路径');
    err.status = 400;
    throw err;
  }
  const [pagePart, queryPart = ''] = pathWithQuery.split('?');
  const page = pagePart.replace(/^\//, '');
  const width = Math.min(Math.max(Number(opts.width) || 430, 280), 1280);
  const hyaline = Boolean(opts.hyaline);
  const preferred = opts.envVersion || process.env.WX_URL_LINK_ENV || 'release';
  const token = await getAccessToken();

  let last = null;

  // 1) 正式版优先普通码（可直接带 query）
  if (preferred === 'release' && pathWithQuery.length <= 128) {
    for (const envVersion of ['release', 'trial']) {
      const parsed = parseWxCodeResponse(
        await requestWxaCodeLimited({ pathWithQuery, width, envVersion, token, hyaline })
      );
      if (parsed.ok) {
        return { buffer: parsed.buffer, contentType: parsed.contentType, envVersion };
      }
      last = parsed.error;
      if (last?.errcode && last.errcode !== 85079 && last.errcode !== 41030) break;
    }
  }

  // 2) 无限码：未发布 / 新页面也可用（check_path=false）
  let scene = String(opts.scene || '').trim();
  if (!scene) {
    const idMatch = queryPart.match(/(?:^|&)id=([^&]+)/);
    scene = idMatch ? String(idMatch[1]) : queryPart;
  }
  // scene 仅允许有限字符；去掉 id= 前缀更稳
  scene = scene.replace(/^id=/, '').replace(/[^A-Za-z0-9!#$&'()*+,/:;=?@\-._~]/g, '').slice(0, 32);
  if (!scene) {
    const err = new Error('缺少小程序码 scene 参数');
    err.status = 400;
    err.detail = last;
    throw err;
  }

  const trialFirst = preferred !== 'release';
  const versions = trialFirst ? ['trial', 'release'] : ['release', 'trial'];
  for (const envVersion of versions) {
    const parsed = parseWxCodeResponse(
      await requestWxaCodeUnlimited({ page, scene, width, envVersion, token, hyaline })
    );
    if (parsed.ok) {
      return { buffer: parsed.buffer, contentType: parsed.contentType, envVersion };
    }
    last = parsed.error;
  }

  const err = new Error(
    last?.errcode
      ? `生成小程序码失败（${last.errcode} ${last.errmsg || ''}）`.trim()
      : (last?.errmsg || '生成小程序码失败')
  );
  err.status = 400;
  err.detail = last;
  throw err;
}

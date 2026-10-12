function getAppSafe() {
  try {
    return getApp();
  } catch (e) {
    return null;
  }
}

function request({ url, method = 'GET', data = {}, auth = true }) {
  const app = getAppSafe();
  const base = (app && app.globalData.apiBase) || 'http://127.0.0.1:3000';
  const header = { 'Content-Type': 'application/json' };
  if (auth && app && app.globalData.token) {
    header.Authorization = `Bearer ${app.globalData.token}`;
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: base + url,
      method,
      data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 400) {
          const err = res.data || {};
          if (
            err.code === 'NOT_MEMBER' ||
            err.code === 'NEED_PHONE' ||
            err.code === 'PHONE_BOUND' ||
            err.code === 'OPENID_BOUND'
          ) {
            reject(Object.assign(new Error(err.message || err.error || '无法登录'), err));
            return;
          }
        }
        if (res.statusCode === 502 || res.statusCode === 503 || res.statusCode === 504) {
          reject(new Error(`后端连不上(${res.statusCode})，请确认电脑已启动 server，且手机与电脑同一 WiFi`));
          return;
        }
        const msg = (res.data && (res.data.error || res.data.message)) || `请求失败(${res.statusCode})`;
        reject(new Error(msg));
      },
      fail(err) {
        const tip = (err && err.errMsg) || '网络错误';
        reject(new Error(`${tip}。请检查 apiBase=${base} 是否可达`));
      },
    });
  });
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (startToday - startThat) / (24 * 60 * 60 * 1000);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  if (diff === 0) return `今天 · ${md}`;
  if (diff === 1) return `昨天 · ${md}`;
  return md;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = {
  request,
  formatDateLabel,
  formatDateTime,
};

function getAppSafe() {
  try {
    return getApp();
  } catch (e) {
    return null;
  }
}

/** 业务接口统一走 /api，避免与后台页面路径冲突 */
function toApiUrl(url) {
  const raw = String(url || '');
  if (!raw) return '/api';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/api/') || raw === '/api') return raw;
  if (raw.startsWith('/')) return `/api${raw}`;
  return `/api/${raw}`;
}

let loadingPending = 0;
let loadingTimer = null;

function beginLoading(enabled) {
  if (!enabled) return;
  loadingPending += 1;
  if (loadingPending === 1 && !loadingTimer) {
    loadingTimer = setTimeout(() => {
      loadingTimer = null;
      if (loadingPending > 0) {
        wx.showLoading({ title: '加载中', mask: true });
      }
    }, 280);
  }
}

function endLoading(enabled) {
  if (!enabled) return;
  loadingPending = Math.max(0, loadingPending - 1);
  if (loadingPending === 0) {
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      loadingTimer = null;
    }
    wx.hideLoading();
  }
}

/**
 * @param {{ url: string, method?: string, data?: object, auth?: boolean, loading?: boolean }} opts
 * loading: 慢请求自动 showLoading（默认 false，由页面控制首屏遮罩）
 */
function request({ url, method = 'GET', data = {}, auth = true, loading = false } = {}) {
  const app = getAppSafe();
  const base = (app && app.globalData.apiBase) || 'http://127.0.0.1:3000';
  const header = { 'Content-Type': 'application/json' };
  if (auth && app && app.globalData.token) {
    header.Authorization = `Bearer ${app.globalData.token}`;
  }

  beginLoading(loading);
  return new Promise((resolve, reject) => {
    wx.request({
      url: base.replace(/\/$/, '') + toApiUrl(url),
      method,
      data,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        if (res.statusCode === 502 || res.statusCode === 503 || res.statusCode === 504) {
          const usingProd = /frontier-api\.geekpark\.net/i.test(base);
          reject(
            new Error(
              usingProd
                ? `服务暂时不可用(${res.statusCode})，请稍后重试`
                : `后端连不上(${res.statusCode})，请确认本机 server 已启动，且手机与电脑同一 WiFi`
            )
          );
          return;
        }
        // 解绑/删微信进入后旧 token 会 401：清本地会话并回到门禁
        if (res.statusCode === 401 && auth) {
          try {
            if (app && typeof app.clearSession === 'function') app.clearSession();
            const pages = getCurrentPages();
            const cur = pages[pages.length - 1];
            if (cur && typeof cur.applyAccess === 'function') {
              cur.applyAccess();
            } else {
              wx.switchTab({ url: '/pages/feed/index' });
            }
          } catch (e) {
            // ignore
          }
        }
        // 4xx：保留服务端 code / member，供门禁与手机号授权分支判断
        if (res.statusCode >= 400 && res.statusCode < 500) {
          const body = res.data || {};
          const msg = body.error || body.message || `请求失败(${res.statusCode})`;
          reject(Object.assign(new Error(msg), body, { statusCode: res.statusCode }));
          return;
        }
        const msg = (res.data && (res.data.error || res.data.message)) || `请求失败(${res.statusCode})`;
        reject(new Error(msg));
      },
      fail(err) {
        const tip = (err && err.errMsg) || '网络错误';
        reject(new Error(`${tip}。请检查 apiBase=${base} 是否可达`));
      },
      complete() {
        endLoading(loading);
      },
    });
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 北京时间拆分；不用 Intl（不少基础库无此全局，会白屏） */
function beijingParts(date, withTime) {
  const d = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const parts = {
    year: String(d.getUTCFullYear()),
    month: pad2(d.getUTCMonth() + 1),
    day: pad2(d.getUTCDate()),
  };
  if (withTime) {
    parts.hour = pad2(d.getUTCHours());
    parts.minute = pad2(d.getUTCMinutes());
  }
  return parts;
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const that = beijingParts(d, false);
  const now = beijingParts(new Date(), false);
  const thatKey = `${that.year}-${that.month}-${that.day}`;
  const nowKey = `${now.year}-${now.month}-${now.day}`;
  const thatUtc = Date.parse(`${thatKey}T00:00:00+08:00`);
  const nowUtc = Date.parse(`${nowKey}T00:00:00+08:00`);
  const diff = Math.round((nowUtc - thatUtc) / 86400000);
  const md = `${Number(that.month)}月${Number(that.day)}日`;
  if (diff === 0) return `今天 · ${md}`;
  if (diff === 1) return `昨天 · ${md}`;
  return md;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = beijingParts(d, true);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

module.exports = {
  request,
  formatDateLabel,
  formatDateTime,
};

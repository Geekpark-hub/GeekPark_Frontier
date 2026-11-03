const { request } = require('./request');

/** 与线上一致；预加载失败时仍可同步拉起授权（不可先 await 再订阅） */
const FALLBACK = {
  expiry: 'GA0JfTFGL3MSejosP8zDc1wuTcC9XAWHb2nyZT6vI3o',
  register: 'LGKkrn--DO4u2vxyU4vVx1-zI1yJ0pRyuTcEoWp34S0',
  eventRemind: 'gZOoiCjD-ktnDLGeetPz2uu3_FfTuYDtGwuQntts-y4',
};

/** 三个模板都至少还剩这么多次推送机会时，「我的」不再拉起授权 */
const MINE_QUOTA_SKIP_AT = 2;

const QUOTA_STORAGE_KEY = 'subscribe_quota_v1';

let cached = null;
/** @type {{ remaining: Record<string, number>, minRemaining: number } | null} */
let quotaCache = null;

function pickId(v, fallback) {
  const s = String(v || '').trim();
  return s || fallback;
}

function mergedTemplates() {
  const c = readCached() || {};
  return {
    expiry: pickId(c.expiry, FALLBACK.expiry),
    register: pickId(c.register, FALLBACK.register),
    eventRemind: pickId(c.eventRemind, FALLBACK.eventRemind),
  };
}

function readCached() {
  if (cached) return cached;
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.subscribeTemplates) {
      cached = app.globalData.subscribeTemplates;
      return cached;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function tmplFor(purpose) {
  const t = mergedTemplates();
  // 始终用 FALLBACK 兜底，避免缓存缺字段时只剩 1 个 ID
  let tmplIds = [];
  if (purpose === 'expiry') {
    tmplIds = [t.expiry || FALLBACK.expiry];
  } else {
    // register / all：到期 + 报名成功 + 活动开始（一次必须 3 个）
    tmplIds = [
      t.expiry || FALLBACK.expiry,
      t.register || FALLBACK.register,
      t.eventRemind || FALLBACK.eventRemind,
    ];
  }
  const seen = {};
  return tmplIds.filter((id) => {
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  }).slice(0, 3);
}

function readLocalRemaining() {
  try {
    const raw = wx.getStorageSync(QUOTA_STORAGE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (e) {
    // ignore
  }
  return {};
}

function writeLocalRemaining(remaining) {
  try {
    wx.setStorageSync(QUOTA_STORAGE_KEY, remaining || {});
  } catch (e) {
    // ignore
  }
}

function recomputeMin(remaining, tmplIds) {
  const ids = tmplIds && tmplIds.length ? tmplIds : tmplFor('all');
  if (!ids.length) return 0;
  return Math.min(...ids.map((id) => Math.max(0, Number(remaining[id]) || 0)));
}

function applyQuota(remaining, minRemaining) {
  const next = remaining && typeof remaining === 'object' ? remaining : {};
  const min =
    typeof minRemaining === 'number' && Number.isFinite(minRemaining)
      ? minRemaining
      : recomputeMin(next);
  quotaCache = { remaining: next, minRemaining: min };
  writeLocalRemaining(next);
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.subscribeQuota = quotaCache;
  } catch (e) {
    // ignore
  }
}

function bumpLocalAccepts(tmplIds, res) {
  if (!res || !tmplIds || !tmplIds.length) return;
  const remaining = { ...(quotaCache && quotaCache.remaining) || readLocalRemaining() };
  let changed = false;
  for (const id of tmplIds) {
    if (res[id] === 'accept') {
      remaining[id] = Math.max(0, Number(remaining[id]) || 0) + 1;
      changed = true;
    }
  }
  if (changed) applyQuota(remaining);
}

/** 同步可读：三个模板里最少的剩余机会（始终按 3 个 ID 重算，避免旧缓存只含到期） */
function getMinRemaining() {
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.subscribeQuota) {
      quotaCache = app.globalData.subscribeQuota;
    }
  } catch (e) {
    // ignore
  }
  const remaining = (quotaCache && quotaCache.remaining) || readLocalRemaining();
  const t = mergedTemplates();
  const ids = [
    t.expiry || FALLBACK.expiry,
    t.register || FALLBACK.register,
    t.eventRemind || FALLBACK.eventRemind,
  ].filter(Boolean);
  return recomputeMin(remaining, ids);
}

/**
 * 「我的」是否还需要拉起授权：到期/报名/提醒 任一剩余 < 2 就拉。
 * 不能只看「到期」——否则会出现到2·报0·提0 却不再弹的情况。
 * 须同步调用（跟在点击手势上）。
 */
function shouldPromptSubscribeForMine() {
  const t = mergedTemplates();
  const ids = [
    t.expiry || FALLBACK.expiry,
    t.register || FALLBACK.register,
    t.eventRemind || FALLBACK.eventRemind,
  ].filter(Boolean);
  const remaining = (quotaCache && quotaCache.remaining) || readLocalRemaining();
  // 缺记录的模板按 0 算，必须继续拉
  return ids.some((id) => (Number(remaining[id]) || 0) < MINE_QUOTA_SKIP_AT);
}

/** 页面 onShow / onLoad 时预拉，勿放在点击提交的 await 链里 */
async function preloadTemplates() {
  try {
    const res = await request({ url: '/notify/templates', auth: false });
    const t = (res && res.templates) || {};
    cached = {
      expiry: pickId(t.expiry, FALLBACK.expiry),
      register: pickId(t.register, FALLBACK.register),
      eventRemind: pickId(t.eventRemind, FALLBACK.eventRemind),
    };
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.subscribeTemplates = cached;
    } catch (e) {
      // ignore
    }
    return cached;
  } catch (e) {
    cached = cached || { ...FALLBACK };
    return cached;
  }
}

/** 预拉剩余推送机会（可 await；结果供点击时同步判断） */
async function preloadQuota() {
  try {
    const res = await request({ url: '/notify/quota' });
    if (res && res.remaining) {
      applyQuota(res.remaining, res.minRemaining);
      return quotaCache;
    }
  } catch (e) {
    // 未登录或接口未上线：沿用本地缓存
  }
  if (!quotaCache) {
    const remaining = readLocalRemaining();
    applyQuota(remaining, recomputeMin(remaining));
  }
  return quotaCache;
}

/**
 * 同步拉起订阅授权（必须紧挨用户点击，不能先 await 网络）
 * @param {'register' | 'expiry' | 'all'} purpose
 */
function requestSubscribe(purpose = 'all') {
  // 「我的」/报名：必须一次 3 个；不足则用 FALLBACK 补齐
  let tmplIds = tmplFor(purpose);
  if (purpose !== 'expiry') {
    const need = [
      FALLBACK.expiry,
      FALLBACK.register,
      FALLBACK.eventRemind,
    ];
    const have = new Set(tmplIds);
    for (const id of need) {
      if (tmplIds.length >= 3) break;
      if (id && !have.has(id)) {
        tmplIds.push(id);
        have.add(id);
      }
    }
    tmplIds = tmplIds.slice(0, 3);
  }
  if (!tmplIds.length) return Promise.resolve({ ok: false, reason: 'no_template' });
  if (purpose !== 'expiry' && tmplIds.length < 3) {
    console.warn('[subscribe] expected 3 tmplIds, got', tmplIds.length, tmplIds);
  }

  console.log('[subscribe] request', purpose, tmplIds.length, tmplIds);

  return new Promise((resolve) => {
    try {
      wx.requestSubscribeMessage({
        tmplIds,
        success(res) {
          console.log('[subscribe] success', purpose, res);
          bumpLocalAccepts(tmplIds, res);
          try {
            const { track } = require('./track');
            track('subscribe_auth', {
              path: purpose,
              meta: { tmplIds, result: res },
            });
          } catch (e) {
            // ignore
          }
          resolve({ ok: true, res, tmplIds });
        },
        fail(err) {
          console.warn('[subscribe] fail', purpose, err);
          resolve({ ok: false, reason: 'fail', err, tmplIds });
        },
      });
    } catch (err) {
      console.warn('[subscribe] throw', purpose, err);
      resolve({ ok: false, reason: 'throw', err, tmplIds });
    }
  });
}

module.exports = {
  preloadTemplates,
  preloadQuota,
  requestSubscribe,
  shouldPromptSubscribeForMine,
  getMinRemaining,
};

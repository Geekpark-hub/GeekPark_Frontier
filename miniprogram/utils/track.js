const { request } = require('./request');

let deviceCache = null;

function getDeviceInfo() {
  if (deviceCache) return deviceCache;
  try {
    const sys = wx.getSystemInfoSync() || {};
    deviceCache = {
      brand: sys.brand || '',
      model: sys.model || '',
      system: sys.system || '',
      platform: sys.platform || '',
      SDKVersion: sys.SDKVersion || '',
      windowWidth: sys.windowWidth || 0,
      windowHeight: sys.windowHeight || 0,
    };
  } catch (e) {
    deviceCache = {};
  }
  return deviceCache;
}

/**
 * 轻量埋点：失败静默，不打扰用户
 * @param {string} event
 * @param {{ path?: string, targetId?: string, meta?: object }} [extra]
 */
function track(event, extra = {}) {
  try {
    const app = getApp();
    if (!app?.globalData?.token || !app?.globalData?.member) return;

    const payload = {
      event,
      path: extra.path || '',
      targetId: extra.targetId || '',
      meta: extra.meta || {},
      device: getDeviceInfo(),
    };

    // fire-and-forget
    request({
      url: '/analytics/track',
      method: 'POST',
      data: payload,
    }).catch(() => {});
  } catch (e) {
    // ignore
  }
}

function trackPage(path) {
  track('page_view', { path });
}

module.exports = {
  track,
  trackPage,
  getDeviceInfo,
};

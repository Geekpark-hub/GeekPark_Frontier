/**
 * 解析分享页 id：支持 ?id= / 无限小程序码 scene / 冷启动 enterOptions
 */
function resolveShareId(query = {}) {
  let id = String(query.id || '').trim();
  let scene = query.scene;

  if (!id || !scene) {
    try {
      const enter = typeof wx.getEnterOptionsSync === 'function' ? wx.getEnterOptionsSync() : null;
      const q = (enter && enter.query) || {};
      if (!id) id = String(q.id || '').trim();
      if (!scene) scene = q.scene;
    } catch (e) {
      // ignore
    }
  }

  if (!id && scene != null && scene !== '') {
    let raw = String(scene);
    try {
      raw = decodeURIComponent(raw);
    } catch (e) {
      // keep raw
    }
    const m = raw.match(/(?:^|&)id=([^&]+)/);
    id = ((m && m[1]) || raw).trim();
  }

  if (id.startsWith('id=')) id = id.slice(3).trim();
  return id;
}

module.exports = { resolveShareId };

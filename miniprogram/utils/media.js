function resolveMediaUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) {
    try {
      const app = getApp();
      const base = (app && app.globalData && app.globalData.apiBase) || 'http://127.0.0.1:3000';
      return base.replace(/\/$/, '') + raw;
    } catch (e) {
      return 'http://127.0.0.1:3000' + raw;
    }
  }
  return raw;
}

/** 把多行文本拆成列表，便于详情页展示 */
function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  resolveMediaUrl,
  splitLines,
};

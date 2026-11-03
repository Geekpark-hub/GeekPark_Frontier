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

function getDisplayMetrics() {
  try {
    const sys = wx.getSystemInfoSync();
    return {
      windowWidth: Number(sys.windowWidth) || 375,
      pixelRatio: Math.min(Math.max(Number(sys.pixelRatio) || 2, 2), 3),
    };
  } catch (e) {
    return { windowWidth: 375, pixelRatio: 2 };
  }
}

/**
 * 封面/头图 URL：
 * - 本地资源原样返回
 * - 七牛等 CDN：按屏幕宽度 × DPR 请求高清缩放（不放大原图；大图按需裁网，避免整图下采样发糊）
 */
function resolveCoverUrl(url, opts = {}) {
  const resolved = resolveMediaUrl(url);
  if (!resolved) return '';
  if (!/^https?:\/\//i.test(resolved)) return resolved;
  if (/[?&](imageView2|imageMogr2|imageslim)\b/i.test(resolved)) return resolved;
  if (!/(geekpark\.net|qiniucdn\.com|clouddn\.com|qnssl\.com)/i.test(resolved)) {
    return resolved;
  }

  const { windowWidth, pixelRatio } = getDisplayMetrics();
  const cssW = Number(opts.cssWidth) > 0 ? Number(opts.cssWidth) : windowWidth;
  // 封面一般接近屏宽；取 2～3 倍像素，上限 1600
  const w = Math.round(Math.min(Math.max(cssW * pixelRatio, 750), 1600));
  const sep = resolved.includes('?') ? '&' : '?';
  // q/90 在清晰度与体积间更稳；不强制 webp，兼容性更好
  return `${resolved}${sep}imageView2/2/w/${w}/q/90`;
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
  resolveCoverUrl,
  splitLines,
};

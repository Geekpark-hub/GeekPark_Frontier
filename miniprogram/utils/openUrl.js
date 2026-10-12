/**
 * 打开原文链接。
 *
 * 微信限制：web-view 只能打开「已配置业务域名」的站点。
 * AI 抓取的新闻站每次都不一样，无法穷举配置，因此默认：
 *   复制链接 → 引导用户在系统浏览器打开。
 */
function normalizeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  return '';
}

function copyUrl(href, tip) {
  wx.setClipboardData({
    data: href,
    success() {
      wx.showToast({ title: tip || '链接已复制', icon: 'none', duration: 2500 });
    },
  });
}

function openExternalUrl(url, options = {}) {
  const href = normalizeUrl(url);
  if (!href) {
    // 非 URL（如公众号名、短柄）走复制
    const raw = String(url || '').trim();
    if (raw) {
      copyPlainText(raw, options.copyTip || '已复制');
      return;
    }
    wx.showToast({ title: '暂无链接', icon: 'none' });
    return;
  }

  wx.showModal({
    title: options.title || '打开链接',
    content:
      options.content ||
      '小程序无法直接内嵌打开外部站点。将复制链接，请到手机浏览器粘贴访问。',
    confirmText: '复制链接',
    cancelText: '取消',
    success(res) {
      if (res.confirm) copyUrl(href, '已复制，请到浏览器打开');
    },
  });
}

function copyPlainText(text, tip) {
  const raw = String(text || '').trim();
  if (!raw) {
    wx.showToast({ title: '暂无内容', icon: 'none' });
    return;
  }
  copyUrl(raw, tip || '已复制');
}

module.exports = {
  normalizeUrl,
  openExternalUrl,
  copyPlainText,
};

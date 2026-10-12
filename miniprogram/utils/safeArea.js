function getStatusBarHeight() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      return Number(wx.getWindowInfo().statusBarHeight || 20);
    }
    return Number(wx.getSystemInfoSync().statusBarHeight || 20);
  } catch (e) {
    return 20;
  }
}

module.exports = {
  getStatusBarHeight,
};

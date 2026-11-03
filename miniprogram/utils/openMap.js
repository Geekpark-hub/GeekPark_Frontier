/**
 * 打开活动地点地图；无经纬度时复制地址供用户自行搜索。
 */
function openEventLocation(event) {
  const address = String((event && event.location) || '').trim();
  if (!address || address === '地点待定') {
    wx.showToast({ title: '地点待定', icon: 'none' });
    return;
  }

  const rawLat = event && event.locationLat;
  const rawLng = event && event.locationLng;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const hasCoord =
    rawLat != null &&
    rawLat !== '' &&
    rawLng != null &&
    rawLng !== '' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) >= 1e-6 &&
    Math.abs(lng) >= 1e-6;

  if (hasCoord) {
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name: String((event && event.title) || '活动地点').slice(0, 32),
      address,
      scale: 16,
      fail(err) {
        console.warn('[openMap]', err);
        wx.showToast({ title: '无法打开地图', icon: 'none' });
      },
    });
    return;
  }

  wx.setClipboardData({
    data: address,
    success() {
      wx.showToast({ title: '地址已复制', icon: 'none' });
    },
    fail() {
      wx.showToast({ title: '复制失败', icon: 'none' });
    },
  });
}

module.exports = { openEventLocation };

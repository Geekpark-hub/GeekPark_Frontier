const { request, formatDateTime } = require('../../utils/request');
const { getAccessState, gateModeFromState, syncTabBar, hasActiveCachedAccess } = require('../../utils/auth');
const { resolveMediaUrl } = require('../../utils/media');
const { eventFallbackCover } = require('../../utils/brand');
const { trackPage } = require('../../utils/track');

const cachedOk = hasActiveCachedAccess();

Page({
  data: {
    ready: cachedOk,
    showGate: !cachedOk,
    gateMode: 'needPhone',
    visitorMessage: '',
    checkedPhone: '',
    tab: 'upcoming',
    upcoming: [],
    past: [],
    list: [],
    statusText: {
      pending: '待审核',
      approved: '已通过',
      waitlist: '候补',
      cancelled: '已取消',
    },
  },

  async onShow() {
    const app = getApp();
    this.applyAccess();
    if (app.globalData.sessionReady) await app.globalData.sessionReady;
    this.applyAccess();
    syncTabBar(1);
    if (this.data.showGate) return;
    trackPage('/pages/events/index');
    this.load();
  },

  applyAccess() {
    const state = getAccessState();
    if (state.kind === 'member') {
      this.setData({ showGate: false, ready: true });
      syncTabBar(1);
      return;
    }
    this.setData({
      showGate: true,
      gateMode: gateModeFromState(state),
      visitorMessage: state.message || '',
      checkedPhone: state.phone || '',
      ready: true,
      list: [],
    });
    syncTabBar(1);
  },

  onActivated() {
    this.applyAccess();
    this.load();
  },

  onNotMember(e) {
    const detail = (e && e.detail) || {};
    this.setData({
      showGate: true,
      gateMode: detail.kind === 'inactive' ? 'inactive' : 'notMember',
      visitorMessage: detail.message || '',
      checkedPhone: detail.phone || '',
    });
  },

  onPullDownRefresh() {
    if (this.data.showGate) {
      wx.stopPullDownRefresh();
      return;
    }
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      tab,
      list: tab === 'upcoming' ? this.data.upcoming : this.data.past,
    });
  },

  async load() {
    if (this.data.showGate) return;
    try {
      const res = await request({ url: '/events' });
      if (this.data.showGate) return;
      const mapItem = (item, index) => {
        const cover = resolveMediaUrl(item.coverUrl);
        return {
          ...item,
          coverDisplay: cover || eventFallbackCover(index),
          timeLabel: `${formatDateTime(item.startAt)}`,
          deadlineLabel: item.registerDeadline
            ? formatDateTime(item.registerDeadline).slice(5, 16)
            : '',
        };
      };
      const upcoming = (res.upcoming || []).map(mapItem);
      const past = (res.past || []).map(mapItem);
      this.setData({
        upcoming,
        past,
        list: this.data.tab === 'upcoming' ? upcoming : past,
        ready: true,
      });
    } catch (err) {
      this.setData({ ready: true });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/events/detail?id=${e.currentTarget.dataset.id}` });
  },
});

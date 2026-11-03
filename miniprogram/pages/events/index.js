const { request, formatDateTime } = require('../../utils/request');
const {
  getAccessState,
  gateModeFromState,
  syncTabBar,
  hasActiveCachedAccess,
  syncSession,
} = require('../../utils/auth');
const { resolveCoverUrl } = require('../../utils/media');
const { trackPage } = require('../../utils/track');

const cachedOk = hasActiveCachedAccess();

Page({
  data: {
    ready: cachedOk,
    showGate: !cachedOk,
    gateMode: 'needInvite',
    visitorMessage: '',
    checkedPhone: '',
    tab: 'upcoming',
    pageLoading: false,
    upcoming: [],
    past: [],
    list: [],
    statusText: {
      pending: '已报名',
      approved: '已报名',
      waitlist: '候补',
      cancelled: '已取消',
    },
  },

  async onShow() {
    const app = getApp();
    this.applyAccess();
    if (app.globalData.sessionReady) await app.globalData.sessionReady;
    if (app.globalData.gateMode === 'pending') {
      await syncSession({ quiet: false });
    }
    this.applyAccess();
    syncTabBar(1);
    if (this.data.showGate) return;
    trackPage('/pages/events/index');
    // 首屏骨架；已有列表则静默刷新（不盖 loading）
    this.load();
  },

  applyAccess() {
    const state = getAccessState();
    if (state.kind === 'member' || state.kind === 'pending' || state.kind === 'inactive') {
      if (this.data.showGate || !this.data.ready) {
        this.setData({ showGate: false, ready: true });
      }
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
  },

  onActivated() {
    this.applyAccess();
    this.load();
  },

  onNotMember(e) {
    const detail = (e && e.detail) || {};
    const kind = detail.kind || 'notMember';
    const gateMode =
      kind === 'inactive' ? 'inactive' : kind === 'needPhone' || kind === 'phoneAuth' ? 'needPhone' : 'notMember';
    this.setData({
      showGate: true,
      gateMode,
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
    const showPageLoading = !this.data.list.length;
    if (showPageLoading) this.setData({ pageLoading: true, ready: true });
    try {
      // 骨架屏承接首屏，不再弹 wx.showLoading
      const res = await request({ url: '/events', loading: false });
      if (this.data.showGate) return;
      const now = new Date();
      const mapItem = (item, index) => {
        const cover = resolveCoverUrl(item.coverUrl);
        const ended =
          item.status === 'closed' || (item.endAt && new Date(item.endAt) < now);
        const started = !!(item.startAt && new Date(item.startAt) <= now);
        let coverTag = '';
        if (ended) coverTag = '已结束';
        else if (started) coverTag = '进行中';
        else if (item.myStatus === 'waitlist') coverTag = '候补';
        else if (item.myStatus && item.myStatus !== 'cancelled') coverTag = '已报名';
        return {
          ...item,
          coverDisplay: cover || '',
          timeLabel: `${formatDateTime(item.startAt)}`,
          deadlineLabel: item.registerDeadline
            ? formatDateTime(item.registerDeadline).slice(5, 16)
            : '',
          coverTag,
          phase: ended ? 'ended' : started ? 'ongoing' : 'upcoming',
        };
      };
      // 进行中排前面，再按开始时间
      const upcoming = (res.upcoming || [])
        .map(mapItem)
        .sort((a, b) => {
          if (a.phase !== b.phase) return a.phase === 'ongoing' ? -1 : 1;
          return new Date(a.startAt) - new Date(b.startAt);
        });
      const past = (res.past || []).map(mapItem);
      this.setData({
        upcoming,
        past,
        list: this.data.tab === 'upcoming' ? upcoming : past,
        ready: true,
        pageLoading: false,
      });
    } catch (err) {
      this.setData({ ready: true, pageLoading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/events/detail?id=${e.currentTarget.dataset.id}` });
  },
});

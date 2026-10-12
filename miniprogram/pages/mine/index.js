const {
  getAccessState,
  gateModeFromState,
  maskPhone,
  syncTabBar,
  hasActiveCachedAccess,
  isActiveMember,
} = require('../../utils/auth');
const { request } = require('../../utils/request');
const { openExternalUrl, copyPlainText } = require('../../utils/openUrl');
const { trackPage } = require('../../utils/track');

function formatExpiresLabel(expiresAt) {
  if (!expiresAt) return '';
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `会员有效期至 ${y}-${mm}`;
}

function readActiveCachedMember() {
  try {
    const token = wx.getStorageSync('token');
    const member = wx.getStorageSync('member');
    if (token && isActiveMember(member)) return member;
  } catch (e) {
    // ignore
  }
  return null;
}

const cachedMember = hasActiveCachedAccess() ? readActiveCachedMember() : null;

Page({
  data: {
    member: cachedMember,
    phoneMasked: maskPhone(cachedMember && cachedMember.phone),
    expiresLabel: formatExpiresLabel(cachedMember && cachedMember.expiresAt),
    hasLinks: Boolean(
      cachedMember &&
        (cachedMember.linkedin ||
          cachedMember.wechatMp ||
          cachedMember.xAccount ||
          cachedMember.youtube ||
          cachedMember.bilibili)
    ),
    showGate: !cachedMember,
    gateMode: 'needPhone',
    visitorMessage: '',
    checkedPhone: '',
    eventsDot: false,
    requestsDot: false,
    statusText: {
      active: '活跃中',
      pending: '待更新',
      expired: '已过期',
    },
  },

  async onShow() {
    const app = getApp();
    this.applyAccess();
    if (app.globalData.sessionReady) await app.globalData.sessionReady;
    this.applyAccess();
    syncTabBar(2);
    if (this.data.showGate) return;
    trackPage('/pages/mine/index');
    this.loadMenuDots();
  },

  applyAccess() {
    const state = getAccessState();
    if (state.kind === 'member') {
      const member = state.member || {};
      const hasLinks = Boolean(
        member.linkedin || member.wechatMp || member.xAccount || member.youtube || member.bilibili
      );
      this.setData({
        showGate: false,
        member,
        phoneMasked: maskPhone(member.phone),
        expiresLabel: formatExpiresLabel(member.expiresAt),
        hasLinks,
        gateMode: 'member',
        visitorMessage: '',
        checkedPhone: '',
      });
      syncTabBar(2);
      return;
    }
    this.setData({
      showGate: true,
      member: null,
      phoneMasked: '',
      expiresLabel: '',
      hasLinks: false,
      eventsDot: false,
      requestsDot: false,
      gateMode: gateModeFromState(state),
      visitorMessage: state.message || '',
      checkedPhone: state.phone || '',
    });
    syncTabBar(2);
  },

  async loadMenuDots() {
    try {
      const [eventsRes, requestsRes] = await Promise.all([
        request({ url: '/events/mine' }),
        request({ url: '/requests/mine' }),
      ]);
      if (this.data.showGate) return;
      const eventsDot = (eventsRes.items || []).some(
        (item) => item.status === 'pending' || item.status === 'waitlist'
      );
      const requestsDot = (requestsRes.items || []).some(
        (item) => item.status === 'submitted' || item.status === 'processing'
      );
      this.setData({ eventsDot, requestsDot });
    } catch (e) {
      // 角标失败不打扰主流程
    }
  },

  onActivated() {
    this.applyAccess();
    if (!this.data.showGate) this.loadMenuDots();
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

  go(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url });
  },

  openLink(e) {
    const { url, text, kind } = e.currentTarget.dataset;
    if (kind === 'wechatMp' || kind === 'text') {
      copyPlainText(text || url, kind === 'wechatMp' ? '公众号名已复制' : '已复制');
      return;
    }
    openExternalUrl(url || text, { title: '打开链接' });
  },

  logout() {
    getApp().clearSession();
    getApp().setNeedPhoneSession('');
    this.applyAccess();
    syncTabBar(2);
    wx.showToast({ title: '已退出', icon: 'none' });
  },
});

const { request, formatDateTime } = require('../../utils/request');
const {
  getAccessState,
  gateModeFromState,
  hasActiveCachedAccess,
  ensureMemberForAction,
} = require('../../utils/auth');
const { track } = require('../../utils/track');
const { resolveShareId } = require('../../utils/shareScene');

const cachedOk = hasActiveCachedAccess();

Page({
  data: {
    id: '',
    ready: cachedOk,
    showGate: !cachedOk,
    gateMode: 'needInvite',
    visitorMessage: '',
    checkedPhone: '',
    isPending: false,
    isExpired: false,
    poll: null,
    selectedMap: {},
    endLabel: '',
    loading: true,
    error: '',
  },

  onLoad(query) {
    const id = resolveShareId(query || {});
    this.setData({
      id,
      error: id ? '' : '缺少投票参数，请重新扫码',
      loading: !!id,
    });
  },

  async onShow() {
    const app = getApp();
    if (!this.data.id) {
      const again = resolveShareId({});
      if (again) this.setData({ id: again, error: '', loading: true });
    }
    this.applyAccess();
    if (app.globalData.sessionReady) {
      await Promise.race([
        app.globalData.sessionReady,
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    }
    this.applyAccess();
    if (this.data.showGate) return;
    if (!this.data.id) {
      this.setData({ loading: false, error: this.data.error || '缺少投票参数，请重新扫码' });
      return;
    }
    this.load();
  },

  applyAccess() {
    const state = getAccessState();
    if (state.kind === 'member' || state.kind === 'pending' || state.kind === 'inactive') {
      const isExpired =
        state.kind === 'inactive' && state.member && state.member.status === 'expired';
      this.setData({
        showGate: false,
        ready: true,
        isPending: state.kind === 'pending' || state.kind === 'inactive',
        isExpired,
      });
      return;
    }
    this.setData({
      showGate: true,
      gateMode: gateModeFromState(state),
      visitorMessage: state.message || '',
      checkedPhone: state.phone || '',
      ready: true,
      loading: false,
      isPending: false,
    });
  },

  onActivated() {
    this.applyAccess();
    if (this.data.id) this.load();
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

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await request({ url: `/polls/${this.data.id}` });
      const selectedMap = {};
      (res.poll.myOptionIds || []).forEach((id) => {
        selectedMap[id] = true;
      });
      this.setData({
        poll: res.poll,
        selectedMap,
        endLabel: formatDateTime(res.poll.endAt),
        loading: false,
        error: '',
      });
      track('poll_share_view', { path: '/pages/poll/share', targetId: this.data.id });
    } catch (err) {
      this.setData({
        poll: null,
        loading: false,
        error: err.message || '加载失败',
      });
    }
  },

  retry() {
    this.load();
  },

  toggleOption(e) {
    const poll = this.data.poll;
    if (!poll || poll.hasVoted || this.data.isPending) return;
    const id = e.currentTarget.dataset.id;
    let selectedMap = { ...this.data.selectedMap };
    if (poll.multiSelect) {
      if (selectedMap[id]) delete selectedMap[id];
      else selectedMap[id] = true;
    } else {
      selectedMap = { [id]: true };
    }
    this.setData({ selectedMap });
  },

  async submitVote() {
    if (!(await ensureMemberForAction('投票'))) return;
    const optionIds = Object.keys(this.data.selectedMap);
    if (!optionIds.length) {
      wx.showToast({ title: '请选择选项', icon: 'none' });
      return;
    }
    try {
      await request({
        url: `/polls/${this.data.id}/vote`,
        method: 'POST',
        loading: true,
        data: { optionIds },
      });
      const app = getApp();
      app.globalData.justVotedPollId = this.data.id;
      track('poll_vote', { path: '/pages/poll/share', targetId: this.data.id });
      wx.showToast({ title: '投票成功', icon: 'success' });
      setTimeout(() => this.load(), 520);
    } catch (err) {
      wx.showToast({ title: err.message || '投票失败', icon: 'none' });
    }
  },

  onShareAppMessage() {
    const poll = this.data.poll;
    return {
      title: (poll && poll.title) || '前沿社社群投票',
      path: `/pages/poll/share?id=${this.data.id}`,
    };
  },
});

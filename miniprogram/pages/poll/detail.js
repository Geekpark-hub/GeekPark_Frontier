const { request, formatDateTime } = require('../../utils/request');
const { requireMemberOrBackHome } = require('../../utils/auth');
const { track } = require('../../utils/track');

Page({
  data: {
    id: '',
    poll: null,
    selectedMap: {},
    endLabel: '',
    loading: true,
    error: '',
  },

  onLoad(query) {
    this.setData({ id: query.id || '' });
  },

  async onShow() {
    if (!(await requireMemberOrBackHome())) return;
    if (this.data.id) this.load();
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
      track('poll_view', { path: '/pages/poll/detail', targetId: this.data.id });
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
    if (!poll || poll.hasVoted) return;
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
    const optionIds = Object.keys(this.data.selectedMap);
    if (!optionIds.length) {
      wx.showToast({ title: '请选择选项', icon: 'none' });
      return;
    }
    try {
      await request({
        url: `/polls/${this.data.id}/vote`,
        method: 'POST',
        data: { optionIds },
      });
      const app = getApp();
      app.globalData.justVotedPollId = this.data.id;
      track('poll_vote', { path: '/pages/poll/detail', targetId: this.data.id });
      wx.showToast({ title: '投票成功', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => this.load(),
        });
      }, 520);
    } catch (err) {
      wx.showToast({ title: err.message || '投票失败', icon: 'none' });
    }
  },
});

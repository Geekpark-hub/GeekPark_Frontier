const { request } = require('../../utils/request');
const { requireMemberOrBackHome } = require('../../utils/auth');

Page({
  data: {
    items: [],
    loading: true,
    error: '',
    statusText: {
      submitted: '已提交',
      processing: '处理中',
      done: '已完成',
    },
  },

  async onShow() {
    if (!(await requireMemberOrBackHome())) return;
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await request({ url: '/requests/mine' });
      this.setData({ items: res.items || [], loading: false, error: '' });
    } catch (err) {
      this.setData({
        items: [],
        loading: false,
        error: err.message || '加载失败',
      });
    }
  },

  retry() {
    this.load();
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/mine/request-create' });
  },
});

const { request, formatDateTime } = require('../../utils/request');
const { requireMemberOrBackHome } = require('../../utils/auth');

Page({
  data: {
    items: [],
    loading: true,
    error: '',
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
      const res = await request({ url: '/polls/mine' });
      const items = (res.items || []).map((item) => ({
        ...item,
        optionText: (item.options || []).map((o) => o.text).join('、'),
        endLabel: item.poll && item.poll.endAt ? formatDateTime(item.poll.endAt).slice(0, 16) : '',
      }));
      this.setData({ items, loading: false, error: '' });
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

  goDetail(e) {
    wx.navigateTo({ url: '/pages/poll/detail?id=' + e.currentTarget.dataset.id });
  },
});

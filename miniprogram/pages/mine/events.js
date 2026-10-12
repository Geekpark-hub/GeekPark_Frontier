const { request, formatDateTime } = require('../../utils/request');
const { requireMemberOrBackHome } = require('../../utils/auth');

Page({
  data: {
    items: [],
    loading: true,
    error: '',
    statusText: {
      pending: '待审核',
      approved: '已通过',
      waitlist: '候补',
      cancelled: '已取消',
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
      const res = await request({ url: '/events/mine' });
      const items = (res.items || []).map((item) => ({
        ...item,
        timeLabel:
          item.event && item.event.startAt
            ? formatDateTime(item.event.startAt).slice(0, 16)
            : '',
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
    wx.navigateTo({ url: '/pages/events/detail?id=' + e.currentTarget.dataset.id });
  },
});

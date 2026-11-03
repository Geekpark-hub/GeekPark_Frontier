const { request, formatDateTime } = require('../../utils/request');
const { requireBoundMemberOrBackHome } = require('../../utils/auth');
const { track } = require('../../utils/track');

Page({
  data: {
    list: [],
    loading: true,
    error: '',
    page: 1,
    hasMore: true,
  },

  async onShow() {
    if (!(await requireBoundMemberOrBackHome())) return;
    try {
      wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    } catch (e) {
      // ignore
    }
    this.load(true);
  },

  async load(reset) {
    if (reset) {
      this.setData({ page: 1, hasMore: true, list: [], loading: true, error: '' });
    } else {
      if (!this.data.hasMore || this.data.loading) return;
      this.setData({ loading: true });
    }
    try {
      const page = reset ? 1 : this.data.page;
      const res = await request({
        url: '/briefs',
        data: { page, pageSize: 20 },
      });
      const rows = res.briefs || [];
      const mapped = rows.map((b) => ({
        ...b,
        publishedLabel: b.publishedAt ? formatDateTime(b.publishedAt) : '',
      }));
      const list = reset ? mapped : this.data.list.concat(mapped);
      const total = res.total || 0;
      this.setData({
        list,
        page: page + 1,
        hasMore: list.length < total,
        loading: false,
        error: '',
      });
      if (reset) track('brief_list', { path: '/pages/briefs/index' });
    } catch (err) {
      this.setData({
        loading: false,
        error: err.message || '加载失败',
      });
    }
  },

  onReachBottom() {
    this.load(false);
  },

  openBrief(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/briefs/share?id=${id}` });
  },

  retry() {
    this.load(true);
  },
});

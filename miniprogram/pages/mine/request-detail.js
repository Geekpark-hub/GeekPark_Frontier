const { request, formatDateTime } = require('../../utils/request');
const { requireMemberOrBackHome } = require('../../utils/auth');

Page({
  data: {
    ready: false,
    loading: true,
    error: '',
    item: null,
    createdLabel: '',
    statusText: {
      submitted: '已提交',
      processing: '处理中',
      done: '已完成',
    },
  },

  onLoad(query) {
    this._id = (query && query.id) || '';
  },

  async onShow() {
    if (!(await requireMemberOrBackHome())) return;
    this.setData({ ready: true });
    this.load();
  },

  async load() {
    if (!this._id) {
      this.setData({ loading: false, error: '缺少需求信息', item: null });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const res = await request({ url: `/requests/${this._id}` });
      const item = res.request || null;
      this.setData({
        item,
        createdLabel: item && item.createdAt ? formatDateTime(item.createdAt) : '',
        loading: false,
        error: '',
      });
    } catch (err) {
      this.setData({
        item: null,
        loading: false,
        error: err.message || '加载失败',
      });
    }
  },

  retry() {
    this.load();
  },
});

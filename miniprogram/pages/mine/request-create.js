const { request } = require('../../utils/request');
const { requireMemberOrBackHome } = require('../../utils/auth');
const { track } = require('../../utils/track');

Page({
  data: {
    allowed: false,
    form: {
      content: '',
      startAt: '',
      endAt: '',
      location: '',
      connectWith: '',
    },
  },

  async onShow() {
    const ok = await requireMemberOrBackHome();
    if (!ok) {
      this.setData({ allowed: false });
      return;
    }
    this.setData({ allowed: true });
  },

  onInput(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.key]: e.detail.value });
  },

  onDate(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.key]: e.detail.value });
  },

  async submit() {
    if (!this.data.allowed) return;
    if (!this.data.form.content.trim()) {
      wx.showToast({ title: '请填写需求内容', icon: 'none' });
      return;
    }
    try {
      await request({
        url: '/requests',
        method: 'POST',
        data: this.data.form,
      });
      track('request_submit', { path: '/pages/mine/request-create' });
      wx.showToast({ title: '已提交', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/mine/requests' });
      }, 500);
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    }
  },
});

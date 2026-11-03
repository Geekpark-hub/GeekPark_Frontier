const { request } = require('../../utils/request');
const { requireMemberOrBackHome } = require('../../utils/auth');
const { track } = require('../../utils/track');

Page({
  data: {
    allowed: false,
    contentError: false,
    form: {
      content: '',
      time: '',
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
    const key = e.currentTarget.dataset.key;
    const patch = { ['form.' + key]: e.detail.value };
    if (key === 'content' && this.data.contentError && String(e.detail.value || '').trim()) {
      patch.contentError = false;
    }
    this.setData(patch);
  },

  async submit() {
    if (!this.data.allowed) return;
    if (!this.data.form.content.trim()) {
      this.setData({ contentError: true });
      return;
    }
    this.setData({ contentError: false });
    try {
      const time = String(this.data.form.time || '').trim();
      await request({
        url: '/requests',
        method: 'POST',
        loading: true,
        data: {
          content: this.data.form.content,
          startAt: time,
          endAt: '',
          location: this.data.form.location,
          connectWith: this.data.form.connectWith,
        },
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

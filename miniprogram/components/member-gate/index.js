const {
  bindPhoneByWx,
  maskPhone,
  syncTabBar,
  getAccessState,
} = require('../../utils/auth');
const { track } = require('../../utils/track');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    mode: { type: String, value: 'needPhone' }, // needPhone | notMember | inactive
    message: { type: String, value: '' },
    phone: { type: String, value: '' },
  },

  data: {
    phoneMasked: '',
  },

  observers: {
    visible() {
      syncTabBar();
    },
    phone(v) {
      this.setData({ phoneMasked: maskPhone(v) });
    },
  },

  lifetimes: {
    attached() {
      this.setData({ phoneMasked: maskPhone(this.data.phone) });
      syncTabBar();
    },
    detached() {
      syncTabBar();
    },
  },

  pageLifetimes: {
    show() {
      syncTabBar();
    },
  },

  methods: {
    async onGetPhoneNumber(e) {
      const detail = e.detail || {};
      if (detail.errMsg && detail.errMsg.indexOf('ok') === -1) {
        wx.showToast({ title: '请授权手机号后进入', icon: 'none' });
        return;
      }
      if (!detail.code) {
        wx.showToast({ title: '未拿到手机号，请用真机授权', icon: 'none' });
        return;
      }

      wx.showLoading({ title: '验证中' });
      try {
        const res = await bindPhoneByWx(detail.code);
        wx.hideLoading();
        this.handleResult(res);
      } catch (err) {
        wx.hideLoading();
        wx.showModal({
          title: '验证失败',
          content: err.message || '请稍后重试',
          showCancel: false,
        });
      }
    },

    handleResult(res) {
      const state = getAccessState();
      if (state.kind === 'member') {
        syncTabBar();
        track('app_open', { path: 'auth' });
        wx.showToast({ title: '验证成功', icon: 'success' });
        this.triggerEvent('activated');
        wx.switchTab({
          url: '/pages/feed/index',
          complete() {
            setTimeout(() => syncTabBar(0), 50);
            setTimeout(() => syncTabBar(0), 300);
          },
        });
        return;
      }

      const phone = (res && res.phone) || state.phone || '';
      const message = (res && res.message) || state.message || '该手机号未匹配到会员信息';
      this.triggerEvent('notmember', {
        kind: state.kind,
        message,
        phone,
      });
      syncTabBar();
    },
  },
});

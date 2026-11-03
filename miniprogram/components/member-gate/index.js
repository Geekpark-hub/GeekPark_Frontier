const {
  bindWxNick,
  syncTabBar,
  getAccessState,
} = require('../../utils/auth');
const { track } = require('../../utils/track');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    mode: { type: String, value: 'needInvite' },
    message: { type: String, value: '' },
    phone: { type: String, value: '' },
  },

  data: {
    nickname: '',
    canSubmit: false,
    submitting: false,
    blockedHeadline: '未匹配到会员',
  },

  observers: {
    visible(v) {
      syncTabBar();
      if (!v) this.setData({ submitting: false });
    },
    message(v) {
      const msg = String(v || '');
      this.setData({
        blockedHeadline: msg.indexOf('已绑定') !== -1 ? '微信绑定冲突' : '未匹配到会员',
      });
    },
  },

  lifetimes: {
    attached() {
      const msg = String(this.data.message || '');
      this.setData({
        blockedHeadline: msg.indexOf('已绑定') !== -1 ? '微信绑定冲突' : '未匹配到会员',
      });
      try {
        const app = getApp();
        const entry = app && app.globalData && app.globalData.wxEntry;
        if (entry && entry.wxNickname) {
          this.setData({
            nickname: entry.wxNickname,
            canSubmit: Boolean(String(entry.wxNickname).trim()),
          });
        }
      } catch (e) {
        // ignore
      }
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
    onNickInput(e) {
      const nickname = String((e.detail && e.detail.value) || '');
      this.setData({
        nickname,
        canSubmit: Boolean(nickname.trim()),
      });
    },

    onNickBlur(e) {
      const v = String((e.detail && e.detail.value) || this.data.nickname || '').trim();
      if (v) this.setData({ nickname: v, canSubmit: true });
    },

    async onGetPhoneNumber(e) {
      const nick = String(this.data.nickname || '').trim();
      if (!nick) {
        wx.showToast({ title: '请先选用微信昵称', icon: 'none' });
        return;
      }
      if (this.data.submitting) return;

      const detail = (e && e.detail) || {};
      const phoneCode = detail.code || '';
      const errMsg = String(detail.errMsg || '');
      const accepted = Boolean(phoneCode);
      const denied =
        !accepted &&
        (/deny|cancel|fail/i.test(errMsg) || detail.errno === 103 || detail.errno === 104);

      this.setData({ submitting: true });
      try {
        const res = await bindWxNick(nick, accepted ? phoneCode : '');
        track('phone_auth', {
          path: '/auth/bind-wx-nick',
          meta: { result: accepted ? 'accept' : denied ? 'reject' : 'skip' },
        });
        this.handleResult(res);
      } catch (err) {
        wx.showModal({
          title: '进入失败',
          content: (err && (err.error || err.message)) || '请稍后重试',
          showCancel: false,
        });
      } finally {
        this.setData({ submitting: false });
      }
    },

    handleResult(res) {
      const state = getAccessState();
      if (state.kind === 'member' || state.kind === 'pending') {
        syncTabBar();
        track('app_open', { path: 'auth-nick' });
        track('wx_nick_auth', {
          path: '/auth/bind-wx-nick',
          meta: { result: 'accept' },
        });
        this.enterApp({
          title: state.kind === 'pending' ? '进入成功' : '认证成功',
        });
        return;
      }
      this.triggerEvent('notmember', {
        kind: 'notMember',
        message: (res && res.message) || state.message || '',
        phone: '',
      });
      syncTabBar();
    },

    enterApp(opts = {}) {
      if (opts.toast !== false) {
        wx.showToast({ title: opts.title || '进入成功', icon: 'success' });
      }
      this.triggerEvent('activated');
      wx.switchTab({
        url: '/pages/feed/index',
        complete() {
          setTimeout(() => syncTabBar(0), 50);
          setTimeout(() => syncTabBar(0), 300);
        },
      });
    },
  },
});

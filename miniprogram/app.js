const { bootstrapSession } = require('./utils/auth');
const { track } = require('./utils/track');

function resolveApiBase() {
  const lan = 'http://192.168.2.94:3000';
  const local = 'http://127.0.0.1:3000';
  try {
    const info = wx.getSystemInfoSync();
    // 开发者工具模拟器走本机回环，真机走局域网
    if (info.platform === 'devtools') return local;
  } catch (e) {
    // ignore
  }
  return lan;
}

App({
  globalData: {
    apiBase: 'http://127.0.0.1:3000',
    lanApiBase: 'http://192.168.2.94:3000',
    token: '',
    member: null,
    openid: '',
    gateMode: 'needPhone', // needPhone | notMember | inactive | member
    checkedPhone: '',
    visitorMessage: '',
    contactTip: '该手机号未匹配到会员信息，请联系运营开通',
    sessionReady: null,
    justVotedPollId: '', // Feed 投票返回后用于卡片离场动画
  },

  onLaunch() {
    this.globalData.apiBase = resolveApiBase();
    console.log('[apiBase]', this.globalData.apiBase);

    const token = wx.getStorageSync('token') || '';
    const member = wx.getStorageSync('member') || null;
    const openid = wx.getStorageSync('openid') || '';
    const gateMode = wx.getStorageSync('gateMode') || (member ? 'member' : 'needPhone');
    const checkedPhone = wx.getStorageSync('checkedPhone') || '';
    const visitorMessage = wx.getStorageSync('visitorMessage') || '';

    this.globalData.token = token;
    this.globalData.member = member;
    this.globalData.openid = openid;
    this.globalData.gateMode = member ? 'member' : gateMode;
    this.globalData.checkedPhone = checkedPhone;
    this.globalData.visitorMessage = visitorMessage;

    // 稍延后，避免真机调试注入阶段过早调用 wx API
    this.globalData.sessionReady = new Promise((resolve) => {
      setTimeout(() => {
        bootstrapSession()
          .then((result) => {
            if (result && result.status === 'member') {
              track('app_open', { path: 'launch' });
            }
            resolve(result);
          })
          .catch((e) => {
            console.error(e);
            this.setNeedPhoneSession(openid || '', '请先授权微信手机号');
            resolve({ status: 'needPhone' });
          });
      }, 80);
    });
  },

  setMemberSession(token, member) {
    this.globalData.token = token;
    this.globalData.member = member;
    this.globalData.openid = member.openid || this.globalData.openid;
    this.globalData.gateMode = 'member';
    this.globalData.checkedPhone = member.phone || '';
    this.globalData.visitorMessage = '';
    wx.setStorageSync('token', token);
    wx.setStorageSync('member', member);
    wx.setStorageSync('openid', this.globalData.openid);
    wx.setStorageSync('gateMode', 'member');
    wx.setStorageSync('checkedPhone', this.globalData.checkedPhone);
    wx.removeStorageSync('visitorMessage');
  },

  setNeedPhoneSession(openid, message) {
    this.globalData.token = '';
    this.globalData.member = null;
    this.globalData.openid = openid || '';
    this.globalData.gateMode = 'needPhone';
    this.globalData.checkedPhone = '';
    this.globalData.visitorMessage = message || '';
    wx.removeStorageSync('token');
    wx.removeStorageSync('member');
    wx.setStorageSync('openid', this.globalData.openid);
    wx.setStorageSync('gateMode', 'needPhone');
    wx.removeStorageSync('checkedPhone');
    if (this.globalData.visitorMessage) {
      wx.setStorageSync('visitorMessage', this.globalData.visitorMessage);
    } else {
      wx.removeStorageSync('visitorMessage');
    }
  },

  setNotMemberSession(openid, phone, message) {
    this.globalData.token = '';
    this.globalData.member = null;
    this.globalData.openid = openid || '';
    this.globalData.gateMode = 'notMember';
    this.globalData.checkedPhone = phone || '';
    this.globalData.visitorMessage = message || this.globalData.contactTip;
    wx.removeStorageSync('token');
    wx.removeStorageSync('member');
    wx.setStorageSync('openid', this.globalData.openid);
    wx.setStorageSync('gateMode', 'notMember');
    wx.setStorageSync('checkedPhone', this.globalData.checkedPhone);
    wx.setStorageSync('visitorMessage', this.globalData.visitorMessage);
  },

  /** 已识别会员但状态不可用（过期 / 待更新） */
  setInactiveSession(member, message) {
    this.globalData.token = '';
    this.globalData.member = member || null;
    this.globalData.openid = (member && member.openid) || this.globalData.openid || '';
    this.globalData.gateMode = 'inactive';
    this.globalData.checkedPhone = (member && member.phone) || '';
    this.globalData.visitorMessage = message || this.globalData.contactTip;
    wx.removeStorageSync('token');
    if (member) wx.setStorageSync('member', member);
    else wx.removeStorageSync('member');
    wx.setStorageSync('openid', this.globalData.openid);
    wx.setStorageSync('gateMode', 'inactive');
    wx.setStorageSync('checkedPhone', this.globalData.checkedPhone);
    wx.setStorageSync('visitorMessage', this.globalData.visitorMessage);
  },

  clearSession() {
    this.globalData.token = '';
    this.globalData.member = null;
    this.globalData.openid = '';
    this.globalData.gateMode = 'needPhone';
    this.globalData.checkedPhone = '';
    this.globalData.visitorMessage = '';
    wx.removeStorageSync('token');
    wx.removeStorageSync('member');
    wx.removeStorageSync('openid');
    wx.removeStorageSync('gateMode');
    wx.removeStorageSync('checkedPhone');
    wx.removeStorageSync('visitorMessage');
  },

  async ensureLogin() {
    if (this.globalData.sessionReady) {
      await this.globalData.sessionReady;
    }
    return this.globalData.member;
  },
});

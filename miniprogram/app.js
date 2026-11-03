const { bootstrapSession } = require('./utils/auth');
const { track } = require('./utils/track');
const { preloadTemplates, preloadQuota } = require('./utils/subscribe');

function resolveApiBase() {
  const prod = 'https://frontier-api.geekpark.net';
  const lan = 'http://192.168.2.94:3000';
  // 开发者工具 / 真机统一走线上，方便联调；需本机联调时改为 return lan
  return prod || lan;
}

App({
  globalData: {
    apiBase: 'http://127.0.0.1:3000',
    lanApiBase: 'http://192.168.2.94:3000',
    token: '',
    member: null,
    openid: '',
    gateMode: 'needInvite', // needInvite | pending | notMember | inactive | member
    checkedPhone: '',
    visitorMessage: '',
    contactTip: '未匹配到会员，请联系前沿社运营',
    sessionReady: null,
    justVotedPollId: '', // Feed 投票返回后用于卡片离场动画
    tabBarAnimateKey: '', // 切 tab 时让「新页」底栏播描边动画
    // 点「我的」拉订阅：本次打开小程序最多一次（custom-tab-bar 每页各有实例，不能挂组件上）
    mineSubscribeAskedThisLaunch: false,
    // 访客微信进入登记（昵称等），供门禁页展示
    wxEntry: null,
  },



  onLaunch() {
    this.globalData.apiBase = resolveApiBase();
    console.log('[apiBase]', this.globalData.apiBase);

    const token = wx.getStorageSync('token') || '';
    const member = wx.getStorageSync('member') || null;
    const openid = wx.getStorageSync('openid') || '';
    let gateMode = wx.getStorageSync('gateMode') || (member ? 'member' : 'needInvite');
    if (gateMode === 'needPhone') gateMode = 'needInvite';
    const checkedPhone = wx.getStorageSync('checkedPhone') || '';
    const visitorMessage = wx.getStorageSync('visitorMessage') || '';
    const wxEntry = wx.getStorageSync('wxEntry') || null;

    this.globalData.token = token;
    this.globalData.member = member;
    this.globalData.openid = openid;
    this.globalData.gateMode = member ? 'member' : gateMode;
    this.globalData.checkedPhone = checkedPhone;
    this.globalData.visitorMessage = visitorMessage;
    this.globalData.wxEntry = wxEntry;

    // 稍延后，避免真机调试注入阶段过早调用 wx API
    this.globalData.sessionReady = new Promise((resolve) => {
      setTimeout(() => {
        bootstrapSession()
          .then((result) => {
            if (result && result.status === 'member') {
              track('app_open', { path: 'launch' });
              preloadTemplates();
              preloadQuota();
            } else if (result && result.status === 'pending') {
              track('app_open', { path: 'launch-pending' });
            }
            resolve(result);
          })
          .catch((e) => {
            console.error(e);
            this.setNeedInviteSession(openid || '', '请选用微信昵称后进入');
            resolve({ status: 'needInvite' });
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
    this.globalData.wxEntry = null;
    wx.setStorageSync('token', token);
    wx.setStorageSync('member', member);
    wx.setStorageSync('openid', this.globalData.openid);
    wx.setStorageSync('gateMode', 'member');
    wx.setStorageSync('checkedPhone', this.globalData.checkedPhone);
    wx.removeStorageSync('visitorMessage');
    wx.removeStorageSync('wxEntry');
  },

  /** 已填微信昵称、待运营绑定：可浏览，不可进「我的」 */
  setPendingSession(token, openid, wxEntry, message) {
    this.globalData.token = token || '';
    this.globalData.member = null;
    this.globalData.openid = openid || this.globalData.openid || '';
    this.globalData.gateMode = 'pending';
    this.globalData.checkedPhone = '';
    this.globalData.visitorMessage = message || '';
    this.globalData.wxEntry = wxEntry || null;
    if (token) wx.setStorageSync('token', token);
    else wx.removeStorageSync('token');
    wx.removeStorageSync('member');
    wx.setStorageSync('openid', this.globalData.openid);
    wx.setStorageSync('gateMode', 'pending');
    wx.removeStorageSync('checkedPhone');
    if (wxEntry) wx.setStorageSync('wxEntry', wxEntry);
    else wx.removeStorageSync('wxEntry');
    if (this.globalData.visitorMessage) {
      wx.setStorageSync('visitorMessage', this.globalData.visitorMessage);
    } else {
      wx.removeStorageSync('visitorMessage');
    }
  },

  setNeedInviteSession(openid, message) {
    this.globalData.token = '';
    this.globalData.member = null;
    this.globalData.openid = openid || '';
    this.globalData.gateMode = 'needInvite';
    this.globalData.checkedPhone = '';
    this.globalData.visitorMessage = message || '';
    wx.removeStorageSync('token');
    wx.removeStorageSync('member');
    wx.setStorageSync('openid', this.globalData.openid);
    wx.setStorageSync('gateMode', 'needInvite');
    wx.removeStorageSync('checkedPhone');
    if (this.globalData.visitorMessage) {
      wx.setStorageSync('visitorMessage', this.globalData.visitorMessage);
    } else {
      wx.removeStorageSync('visitorMessage');
    }
  },

  /** @deprecated 兼容旧调用 */
  setNeedPhoneSession(openid, message) {
    this.setNeedInviteSession(openid, message || '请选用微信昵称后进入');
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

  /**
   * 已识别会员但不可写（过期等）：保留 token 以便只读浏览；
   * 无 token 时仅展示说明（旧兼容）。
   */
  setInactiveSession(member, message, token) {
    const nextToken = token || this.globalData.token || '';
    this.globalData.token = nextToken;
    this.globalData.member = member || null;
    this.globalData.openid = (member && member.openid) || this.globalData.openid || '';
    this.globalData.gateMode = 'inactive';
    this.globalData.checkedPhone = (member && member.phone) || '';
    this.globalData.visitorMessage = message || this.globalData.contactTip;
    if (nextToken) wx.setStorageSync('token', nextToken);
    else wx.removeStorageSync('token');
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
    this.globalData.gateMode = 'needInvite';
    this.globalData.checkedPhone = '';
    this.globalData.visitorMessage = '';
    this.globalData.wxEntry = null;
    wx.removeStorageSync('token');
    wx.removeStorageSync('member');
    wx.removeStorageSync('openid');
    wx.removeStorageSync('gateMode');
    wx.removeStorageSync('checkedPhone');
    wx.removeStorageSync('visitorMessage');
    wx.removeStorageSync('wxEntry');
  },

  async ensureLogin() {
    if (this.globalData.sessionReady) {
      await this.globalData.sessionReady;
    }
    return this.globalData.member;
  },
});

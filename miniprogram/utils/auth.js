const { request } = require('./request');

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res.code) resolve(res.code);
        else reject(new Error('获取微信登录码失败'));
      },
      fail(err) {
        reject(new Error(err.errMsg || '微信登录失败'));
      },
    });
  });
}

function maskPhone(phone) {
  const s = String(phone || '').replace(/\D/g, '');
  if (!s) return '';
  if (s.length < 7) return '***';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

function isActiveMember(member) {
  if (!member) return false;
  return member.status === 'active' || Boolean(member.isAdmin);
}

/** 本地可浏览会话：正式会员 / 过期会员 / 待绑访客 */
function hasActiveCachedAccess() {
  try {
    const token = wx.getStorageSync('token');
    if (!token) return false;
    const member = wx.getStorageSync('member');
    if (member && isActiveMember(member)) return true;
    const gateMode = wx.getStorageSync('gateMode');
    if (gateMode === 'pending') return true;
    // 过期：有 token + member 即可浏览
    if (gateMode === 'inactive' && member) return true;
    return false;
  } catch (e) {
    return false;
  }
}

const ALL_TABS = [
  {
    key: 'feed',
    pagePath: '/pages/feed/index',
    text: '动态',
    iconOff: '/assets/tab-feed.png',
    iconOn: '/assets/tab-feed-active.png',
  },
  {
    key: 'event',
    pagePath: '/pages/events/index',
    text: '活动',
    iconOff: '/assets/tab-event.png',
    iconOn: '/assets/tab-event-active.png',
  },
  {
    key: 'mine',
    pagePath: '/pages/mine/index',
    text: '我的',
    iconOff: '/assets/tab-mine.png',
    iconOn: '/assets/tab-mine-active.png',
  },
];

/**
 * 按全局会话同步自定义底栏。
 * pending（待绑）：隐藏「我的」；过期会员仍显示「我的」
 */
function syncTabBar(selectedIndex) {
  try {
    const state = getAccessState();
    const show = state.kind === 'member' || state.kind === 'pending' || state.kind === 'inactive';
    const showMine = state.kind === 'member' || state.kind === 'inactive';
    const pages = getCurrentPages();
    const page = pages[pages.length - 1];
    if (page && typeof page.getTabBar === 'function') {
      const bar = page.getTabBar();
      if (bar) {
        if (typeof bar.setVisible === 'function') bar.setVisible(show);
        if (typeof bar.setTabs === 'function') {
          bar.setTabs(showMine ? ALL_TABS : ALL_TABS.filter((t) => t.key !== 'mine'));
        }
        if (typeof selectedIndex === 'number' && typeof bar.setSelected === 'function') {
          // pending 只有 2 个 tab，索引需裁剪
          const maxIdx = showMine ? 2 : 1;
          bar.setSelected(Math.min(selectedIndex, maxIdx));
        }
      }
    }
  } catch (e) {
    // ignore
  }
}

function inactiveMessage(member, fallback) {
  if (fallback) return fallback;
  if (member && member.status === 'expired') {
    return '会员已过期，可继续浏览动态与活动；续期后可报名、投票。';
  }
  return '会员状态待更新，请联系前沿社运营确认后再试。';
}

/** 可浏览但不可写：待绑访客 / 过期会员 */
function isBrowseOnlyState(state) {
  if (!state) return false;
  return state.kind === 'pending' || state.kind === 'inactive';
}

function rememberWxEntry(entry) {
  const app = getApp();
  if (!app) return;
  if (!entry) {
    app.globalData.wxEntry = null;
    return;
  }
  app.globalData.wxEntry = {
    id: entry.id || '',
    wxNickname: entry.wxNickname || '',
    phone: entry.phone || '',
    nickAsked: Boolean(entry.nickAsked),
    status: entry.status || 'pending',
  };
}

async function bootstrapSession() {
  const app = getApp();

  // 正式会员 / 过期会员会话
  if (app.globalData.token && app.globalData.member) {
    try {
      const res = await request({ url: '/auth/me' });
      if (!isActiveMember(res.member)) {
        app.setInactiveSession(
          res.member,
          inactiveMessage(res.member),
          app.globalData.token
        );
        syncTabBar();
        return { status: 'inactive', member: res.member };
      }
      app.setMemberSession(app.globalData.token, res.member);
      rememberWxEntry(null);
      syncTabBar();
      return { status: 'member', member: res.member };
    } catch (e) {
      const cached = app.globalData.member;
      const msg = (e && e.message) || '';
      if (cached && (cached.status === 'expired' || /过期/.test(msg))) {
        const member = { ...cached, status: 'expired' };
        app.setInactiveSession(
          member,
          inactiveMessage(member, msg),
          app.globalData.token
        );
        syncTabBar();
        return { status: 'inactive', member };
      }
      app.clearSession();
    }
  }

  try {
    const code = await wxLoginCode();
    const res = await request({
      url: '/auth/wechat-login',
      method: 'POST',
      data: { code },
      auth: false,
    });
    if (res.status === 'member') {
      if (!isActiveMember(res.member)) {
        app.setInactiveSession(
          res.member,
          inactiveMessage(res.member),
          res.token
        );
        syncTabBar();
        return { status: 'inactive', member: res.member };
      }
      app.setMemberSession(res.token, res.member);
      rememberWxEntry(null);
      syncTabBar();
      return { status: 'member', member: res.member };
    }
    if (res.status === 'pending') {
      app.setPendingSession(res.token, res.openid || '', res.wxEntry, res.message || '');
      syncTabBar();
      return { status: 'pending', openid: res.openid, wxEntry: res.wxEntry };
    }
    rememberWxEntry(res.wxEntry || null);
    app.setNeedInviteSession(
      res.openid || '',
      res.message || '请选用微信昵称后进入。'
    );
    syncTabBar();
    return {
      status: 'needInvite',
      openid: res.openid,
      message: res.message,
      wxEntry: res.wxEntry,
    };
  } catch (e) {
    const openid = app.globalData.openid || '';
    app.setNeedInviteSession(openid, '请选用微信昵称后进入');
    syncTabBar();
    return { status: 'needInvite', openid, error: e.message };
  }
}

/**
 * 同步会话：运营后台绑定后，待绑定访客切 tab / 回前台时可升级为正式会员，无需杀掉小程序重进。
 * @returns {{ status: string, promoted?: boolean, member?: object } | null}
 */
async function syncSession(opts = {}) {
  const app = getApp();
  if (!app || !app.globalData.token) return null;
  const quiet = opts.quiet !== false;
  try {
    const res = await request({
      url: '/auth/sync',
      auth: true,
      loading: false,
    });
    if (res.status === 'member' && res.token && res.member) {
      const wasPending = app.globalData.gateMode === 'pending' || !app.globalData.member;
      app.setMemberSession(res.token, res.member);
      rememberWxEntry(null);
      syncTabBar();
      if (wasPending && res.promoted && !quiet) {
        wx.showToast({ title: '会员已开通', icon: 'success' });
      }
      return { status: 'member', promoted: Boolean(res.promoted), member: res.member };
    }
    if (res.status === 'pending') {
      app.setPendingSession(
        app.globalData.token,
        res.openid || app.globalData.openid || '',
        res.wxEntry,
        res.message || ''
      );
      syncTabBar();
      return { status: 'pending', wxEntry: res.wxEntry };
    }
    if ((res.status === 'expired' || res.status === 'inactive') && res.member) {
      app.setInactiveSession(
        res.member,
        inactiveMessage(res.member, res.message),
        res.token || app.globalData.token
      );
      syncTabBar();
      return { status: 'inactive', member: res.member };
    }
  } catch (e) {
    // 401 由 request 清会话；网络错误忽略，沿用本地态
  }
  return null;
}

/** 授权微信昵称后进入（待绑访客）；phoneCode 可选，拒绝授权时不传 */
async function bindWxNick(nickname, phoneCode) {
  const loginCode = await wxLoginCode();
  const data = {
    loginCode,
    nickname: String(nickname || '').trim(),
  };
  if (phoneCode) data.phoneCode = String(phoneCode);
  const res = await request({
    url: '/auth/bind-wx-nick',
    method: 'POST',
    data,
    auth: false,
    loading: true,
  });
  applyBindResult(res);
  return res;
}

function applyBindResult(res) {
  const app = getApp();
  if (res.status === 'member') {
    if (!isActiveMember(res.member)) {
      app.setInactiveSession(
        res.member,
        inactiveMessage(res.member),
        res.token
      );
      syncTabBar();
      return;
    }
    app.setMemberSession(res.token, res.member);
    rememberWxEntry(null);
    syncTabBar();
    return;
  }
  if (res.status === 'pending') {
    app.setPendingSession(res.token, res.openid || '', res.wxEntry, res.message || '');
    syncTabBar();
    return;
  }
  rememberWxEntry(res.wxEntry || null);
  app.setNotMemberSession(
    res.openid || app.globalData.openid,
    res.phone || '',
    res.message || ''
  );
  syncTabBar();
}

function getAccessState() {
  const app = getApp();

  if (app.globalData.gateMode === 'inactive' && app.globalData.member) {
    return {
      kind: 'inactive',
      member: app.globalData.member,
      phone: app.globalData.checkedPhone || app.globalData.member.phone || '',
      message: app.globalData.visitorMessage || inactiveMessage(app.globalData.member),
    };
  }

  if (app.globalData.member && app.globalData.token) {
    const member = app.globalData.member;
    if (!isActiveMember(member)) {
      return {
        kind: 'inactive',
        member,
        phone: member.phone || app.globalData.checkedPhone || '',
        message: inactiveMessage(member),
      };
    }
    return { kind: 'member', member };
  }

  if (app.globalData.gateMode === 'pending' && app.globalData.token) {
    return {
      kind: 'pending',
      openid: app.globalData.openid,
      wxEntry: app.globalData.wxEntry,
      message: app.globalData.visitorMessage || '',
    };
  }

  if (app.globalData.gateMode === 'notMember') {
    return {
      kind: 'notMember',
      openid: app.globalData.openid,
      phone: app.globalData.checkedPhone,
      message: app.globalData.visitorMessage,
    };
  }

  if (app.globalData.gateMode === 'needPhone') {
    app.globalData.gateMode = 'needInvite';
  }

  return {
    kind: 'needInvite',
    openid: app.globalData.openid,
    message: app.globalData.visitorMessage || '请选用微信昵称后进入。',
  };
}

function gateModeFromState(state) {
  // 过期与待绑一样：不挡整页门禁，只在写操作处提示
  if (!state || state.kind === 'member' || state.kind === 'pending' || state.kind === 'inactive') {
    return 'member';
  }
  if (state.kind === 'needInvite' || state.kind === 'needPhone' || state.kind === 'phoneAuth') {
    return 'needInvite';
  }
  return 'notMember';
}

async function requireMemberOrBackHome() {
  const app = getApp();
  if (app.globalData.sessionReady) await app.globalData.sessionReady;
  const state = getAccessState();
  if (state.kind === 'member') return true;

  const title =
    state.kind === 'pending'
      ? '开通会员后可使用'
      : state.kind === 'inactive'
        ? '会员状态不可用'
        : state.kind === 'notMember'
          ? '请联系前沿社运营开通'
          : '请先选用微信昵称';
  wx.showToast({ title, icon: 'none' });
  wx.switchTab({
    url: '/pages/feed/index',
    complete() {
      syncTabBar(0);
    },
  });
  return false;
}

/** 内参等：正式会员或过期会员可进；待绑不可 */
async function requireBoundMemberOrBackHome() {
  const app = getApp();
  if (app.globalData.sessionReady) await app.globalData.sessionReady;
  const state = getAccessState();
  if (state.kind === 'member') return true;
  if (state.kind === 'inactive' && state.member) return true;

  const title =
    state.kind === 'pending'
      ? '开通会员后可阅读内参'
      : state.kind === 'notMember'
        ? '请联系前沿社运营开通'
        : '请先选用微信昵称';
  wx.showToast({ title, icon: 'none' });
  wx.switchTab({
    url: '/pages/feed/index',
    complete() {
      syncTabBar(0);
    },
  });
  return false;
}

/** 浏览活动/投票详情：正式会员、过期会员、待绑定访客均可进入 */
async function requireBrowseAccessOrBackHome() {
  const app = getApp();
  if (app.globalData.sessionReady) await app.globalData.sessionReady;
  const state = getAccessState();
  if (state.kind === 'member' || isBrowseOnlyState(state)) return true;

  const title =
    state.kind === 'notMember' ? '请联系前沿社运营开通' : '请先选用微信昵称';
  wx.showToast({ title, icon: 'none' });
  wx.switchTab({
    url: '/pages/feed/index',
    complete() {
      syncTabBar(0);
    },
  });
  return false;
}

/** 投票 / 报名等写操作：待绑 / 过期可浏览，但不能提交 */
async function ensureMemberForAction(action = '使用此功能') {
  const app = getApp();
  if (app.globalData.sessionReady) await app.globalData.sessionReady;
  const state = getAccessState();
  if (state.kind === 'member') return true;
  const expired = state.kind === 'inactive' && state.member && state.member.status === 'expired';
  const content = expired
    ? `会员已过期，续期后即可${action}。当前可先浏览动态与活动。`
    : state.kind === 'pending'
      ? `运营确认会员身份后即可${action}。当前可先浏览动态与活动。`
      : state.kind === 'inactive'
        ? '会员状态待更新，请联系前沿社运营。'
        : '请先完成进入认证，并由运营绑定会员后再试。';
  await new Promise((resolve) => {
    wx.showModal({
      title: expired ? '会员已过期' : '需要会员身份',
      content,
      showCancel: false,
      confirmText: '知道了',
      complete: () => resolve(),
    });
  });
  return false;
}

module.exports = {
  wxLoginCode,
  bootstrapSession,
  syncSession,
  bindWxNick,
  getAccessState,
  gateModeFromState,
  isBrowseOnlyState,
  requireMemberOrBackHome,
  requireBoundMemberOrBackHome,
  requireBrowseAccessOrBackHome,
  ensureMemberForAction,
  maskPhone,
  syncTabBar,
  hasActiveCachedAccess,
  isActiveMember,
};

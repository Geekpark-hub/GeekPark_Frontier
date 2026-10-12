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

/** 本地是否有可用的活跃会员会话（用于首屏避免闪门禁） */
function hasActiveCachedAccess() {
  try {
    const token = wx.getStorageSync('token');
    const member = wx.getStorageSync('member');
    return Boolean(token && isActiveMember(member));
  } catch (e) {
    return false;
  }
}

/** 按全局会话同步底栏（自定义 tabBar + 原生接口双保险） */
function syncTabBar(selectedIndex) {
  try {
    const state = getAccessState();
    const show = state.kind === 'member';
    const pages = getCurrentPages();
    const page = pages[pages.length - 1];
    if (page && typeof page.getTabBar === 'function') {
      const bar = page.getTabBar();
      if (bar) {
        if (typeof bar.setVisible === 'function') bar.setVisible(show);
        if (typeof selectedIndex === 'number' && typeof bar.setSelected === 'function') {
          bar.setSelected(selectedIndex);
        }
      }
    }
    const api = show ? wx.showTabBar : wx.hideTabBar;
    api({ animation: false, fail() {} });
  } catch (e) {
    // 非 tab 页调用会失败，忽略
  }
}

function inactiveMessage(member, fallback) {
  if (fallback) return fallback;
  if (member && member.status === 'expired') {
    return '会员已过期，请联系运营团队续期后再使用完整功能。';
  }
  return '会员状态待更新，请联系运营团队确认后再试。';
}

/**
 * 启动会话：
 * 1) 若已绑定过微信的会员 → 直接进
 * 2) 否则进入 needPhone，先拉起手机号授权再判断
 */
async function bootstrapSession() {
  const app = getApp();

  if (app.globalData.token && app.globalData.member) {
    try {
      const res = await request({ url: '/auth/me' });
      if (!isActiveMember(res.member)) {
        app.setInactiveSession(res.member, inactiveMessage(res.member));
        syncTabBar();
        return { status: 'inactive', member: res.member };
      }
      app.setMemberSession(app.globalData.token, res.member);
      syncTabBar();
      return { status: 'member', member: res.member };
    } catch (e) {
      const cached = app.globalData.member;
      const msg = (e && e.message) || '';
      if (cached && (cached.status === 'expired' || /过期/.test(msg))) {
        const member = { ...cached, status: 'expired' };
        app.setInactiveSession(member, inactiveMessage(member, msg));
        syncTabBar();
        return { status: 'inactive', member };
      }
      if (cached && cached.status === 'pending') {
        app.setInactiveSession(cached, inactiveMessage(cached, msg));
        syncTabBar();
        return { status: 'inactive', member: cached };
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
        app.setInactiveSession(res.member, inactiveMessage(res.member));
        syncTabBar();
        return { status: 'inactive', member: res.member };
      }
      app.setMemberSession(res.token, res.member);
      syncTabBar();
      return { status: 'member', member: res.member };
    }
    // 未绑定会员：先授权手机号；保留欢迎文案供后续展示
    app.setNeedPhoneSession(res.openid || '', res.message || '');
    syncTabBar();
    return { status: 'needPhone', openid: res.openid, message: res.message };
  } catch (e) {
    // 微信接口失败：进入手机号授权，不写死伪造 openid 文案干扰排查
    const openid = app.globalData.openid || '';
    app.setNeedPhoneSession(openid, '请先授权微信手机号');
    syncTabBar();
    return { status: 'needPhone', openid, error: e.message };
  }
}

async function bindPhoneByWx(phoneCode) {
  const loginCode = await wxLoginCode();
  const res = await request({
    url: '/auth/bind-phone',
    method: 'POST',
    data: { loginCode, phoneCode },
    auth: false,
  });
  applyBindResult(res);
  return res;
}

function applyBindResult(res) {
  const app = getApp();
  if (res.status === 'member') {
    if (!isActiveMember(res.member)) {
      app.setInactiveSession(res.member, inactiveMessage(res.member));
      syncTabBar();
      return;
    }
    app.setMemberSession(res.token, res.member);
    syncTabBar();
    return;
  }
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

  if (app.globalData.gateMode === 'notMember') {
    return {
      kind: 'notMember',
      openid: app.globalData.openid,
      phone: app.globalData.checkedPhone,
      message: app.globalData.visitorMessage,
    };
  }

  return {
    kind: 'needPhone',
    openid: app.globalData.openid,
    message: app.globalData.visitorMessage || '请先授权微信手机号',
  };
}

/** Tab 页门禁 mode：needPhone | notMember | inactive */
function gateModeFromState(state) {
  if (!state || state.kind === 'member') return 'member';
  if (state.kind === 'needPhone') return 'needPhone';
  if (state.kind === 'inactive') return 'inactive';
  return 'notMember';
}

async function requireMemberOrBackHome() {
  const app = getApp();
  if (app.globalData.sessionReady) await app.globalData.sessionReady;
  const state = getAccessState();
  if (state.kind === 'member') return true;

  const title =
    state.kind === 'inactive'
      ? '会员状态不可用'
      : state.kind === 'notMember'
        ? '该手机号未匹配到会员信息'
        : '请先完成手机号验证';
  wx.showToast({ title, icon: 'none' });
  wx.switchTab({
    url: '/pages/feed/index',
    complete() {
      syncTabBar(0);
    },
  });
  return false;
}

module.exports = {
  wxLoginCode,
  bootstrapSession,
  bindPhoneByWx,
  getAccessState,
  gateModeFromState,
  requireMemberOrBackHome,
  maskPhone,
  syncTabBar,
  hasActiveCachedAccess,
  isActiveMember,
};

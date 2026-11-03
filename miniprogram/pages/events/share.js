const { request, formatDateTime } = require('../../utils/request');
const {
  getAccessState,
  gateModeFromState,
  hasActiveCachedAccess,
  ensureMemberForAction,
} = require('../../utils/auth');
const { resolveCoverUrl, splitLines } = require('../../utils/media');
const { track } = require('../../utils/track');
const { resolveShareId } = require('../../utils/shareScene');
const { requestSubscribe, preloadTemplates } = require('../../utils/subscribe');
const { openEventLocation } = require('../../utils/openMap');

const cachedOk = hasActiveCachedAccess();

Page({
  data: {
    id: '',
    ready: cachedOk,
    showGate: !cachedOk,
    gateMode: 'needInvite',
    visitorMessage: '',
    isPending: false,
    isExpired: false,
    pendingNeedMember: false,
    checkedPhone: '',
    event: null,
    coverUrl: '',
    agendaLines: [],
    guestLines: [],
    myRegistration: null,
    canRegister: false,
    canCancel: false,
    cancelling: false,
    ended: false,
    deadlinePassed: false,
    timeLabel: '',
    deadlineLabel: '',
    loading: true,
    error: '',
    form: {
      name: '',
      companions: '',
      specialNeeds: '',
    },
    regStatusText: '',
  },

  onLoad(query) {
    const id = resolveShareId(query || {});
    this.setData({
      id,
      error: id ? '' : '缺少活动参数，请重新扫码',
      loading: !!id,
    });
  },

  async onShow() {
    const app = getApp();
    if (!this.data.id) {
      const again = resolveShareId({});
      if (again) this.setData({ id: again, error: '', loading: true });
    }
    this.applyAccess();
    if (app.globalData.sessionReady) {
      await Promise.race([
        app.globalData.sessionReady,
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    }
    this.applyAccess();
    if (this.data.showGate) return;
    if (!this.data.id) {
      this.setData({ loading: false, error: this.data.error || '缺少活动参数，请重新扫码' });
      return;
    }
    const member = app.globalData.member;
    this.setData({ 'form.name': (member && member.name) || this.data.form.name || '' });
    preloadTemplates();
    this.load();
  },

  applyAccess() {
    const state = getAccessState();
    if (state.kind === 'member' || state.kind === 'pending' || state.kind === 'inactive') {
      const isExpired =
        state.kind === 'inactive' && state.member && state.member.status === 'expired';
      this.setData({
        showGate: false,
        ready: true,
        isPending: state.kind === 'pending' || state.kind === 'inactive',
        isExpired,
      });
      return;
    }
    this.setData({
      showGate: true,
      gateMode: gateModeFromState(state),
      visitorMessage: state.message || '',
      checkedPhone: state.phone || '',
      ready: true,
      loading: false,
      isPending: false,
    });
  },

  onActivated() {
    this.applyAccess();
    const member = getApp().globalData.member;
    this.setData({ 'form.name': (member && member.name) || '' });
    if (this.data.id) this.load();
  },

  onNotMember(e) {
    const detail = (e && e.detail) || {};
    const kind = detail.kind || 'notMember';
    const gateMode =
      kind === 'inactive' ? 'inactive' : kind === 'needPhone' || kind === 'phoneAuth' ? 'needPhone' : 'notMember';
    this.setData({
      showGate: true,
      gateMode,
      visitorMessage: detail.message || '',
      checkedPhone: detail.phone || '',
    });
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await request({ url: '/events/' + this.data.id });
      const event = res.event;
      const myRegistration = res.myRegistration;
      const now = new Date();
      const ended = event.status === 'closed' || new Date(event.endAt) < now;
      const deadlinePassed = !!(event.registerDeadline && new Date(event.registerDeadline) <= now);
      const access = getAccessState();
      const isPending = access.kind === 'pending' || access.kind === 'inactive';
      const isExpired =
        access.kind === 'inactive' && access.member && access.member.status === 'expired';
      const canRegister =
        !isPending &&
        !ended &&
        !deadlinePassed &&
        event.status === 'published' &&
        (!myRegistration || myRegistration.status === 'cancelled');
      const canCancel =
        !isPending &&
        !!myRegistration &&
        myRegistration.status !== 'cancelled' &&
        !ended;
      const pendingNeedMember =
        isPending &&
        !ended &&
        !deadlinePassed &&
        event.status === 'published';
      const started = !!(event.startAt && new Date(event.startAt) <= now);
      let regStatusText = '';
      if (myRegistration) {
        if (myRegistration.status === 'cancelled') regStatusText = '已取消';
        else if (myRegistration.status === 'waitlist') regStatusText = '候补';
        else if (ended) regStatusText = '已结束';
        else if (started) regStatusText = '进行中';
        else regStatusText = '已报名';
      }

      this.setData({
        event,
        coverUrl: resolveCoverUrl(event.coverUrl) || '',
        agendaLines: splitLines(event.agenda),
        guestLines: splitLines(event.guests),
        myRegistration,
        regStatusText,
        canRegister,
        canCancel,
        pendingNeedMember,
        isPending,
        isExpired,
        ended,
        deadlinePassed,
        timeLabel: formatDateTime(event.startAt) + ' - ' + formatDateTime(event.endAt),
        deadlineLabel: event.registerDeadline ? formatDateTime(event.registerDeadline) : '',
        loading: false,
        error: '',
      });
      track('event_share_view', { path: '/pages/events/share', targetId: this.data.id });
    } catch (err) {
      this.setData({
        event: null,
        loading: false,
        error: err.message || '加载失败',
      });
    }
  },

  retry() {
    this.load();
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },

  async submit() {
    if (!(await ensureMemberForAction('报名活动'))) return;
    if (!this.data.form.name || !String(this.data.form.name).trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    try {
      // 勿 await：须在点击手势同期步拉起（到期 + 报名成功 + 活动开始）
      requestSubscribe('all');
      await request({
        url: '/events/' + this.data.id + '/register',
        method: 'POST',
        loading: true,
        data: {
          name: this.data.form.name,
          willAttend: true,
          companions: this.data.form.companions,
          specialNeeds: this.data.form.specialNeeds,
        },
      });
      track('event_register', { path: '/pages/events/share', targetId: this.data.id });
      wx.showToast({ title: '报名已提交', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: err.message || '报名失败', icon: 'none' });
    }
  },

  cancelRegister() {
    if (this.data.cancelling || !this.data.canCancel) return;
    wx.showModal({
      title: '取消报名',
      content: '确定取消本次活动报名？取消后仍可重新报名。',
      confirmText: '取消报名',
      confirmColor: '#8a8378',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) this.doCancelRegister();
      },
    });
  },

  async doCancelRegister() {
    if (this.data.cancelling) return;
    if (!(await ensureMemberForAction('取消报名'))) return;
    this.setData({ cancelling: true });
    try {
      await request({
        url: '/events/' + this.data.id + '/cancel-register',
        method: 'POST',
        loading: true,
      });
      track('event_cancel_register', { path: '/pages/events/share', targetId: this.data.id });
      wx.showToast({ title: '已取消报名', icon: 'success' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: err.message || '取消失败', icon: 'none' });
    } finally {
      this.setData({ cancelling: false });
    }
  },

  openLocation() {
    openEventLocation(this.data.event);
  },

  onShareAppMessage() {
    const event = this.data.event;
    return {
      title: (event && event.title) || '前沿社活动报名',
      path: `/pages/events/share?id=${this.data.id}`,
      imageUrl: this.data.coverUrl || '',
    };
  },
});

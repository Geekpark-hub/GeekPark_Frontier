const { request, formatDateTime } = require('../../utils/request');
const {
  requireBrowseAccessOrBackHome,
  ensureMemberForAction,
  getAccessState,
} = require('../../utils/auth');
const { resolveCoverUrl, splitLines } = require('../../utils/media');
const { track } = require('../../utils/track');
const { requestSubscribe, preloadTemplates } = require('../../utils/subscribe');
const { openEventLocation } = require('../../utils/openMap');

Page({
  data: {
    id: '',
    event: null,
    coverUrl: '',
    agendaLines: [],
    guestLines: [],
    myRegistration: null,
    canRegister: false,
    canCancel: false,
    pendingNeedMember: false,
    isPending: false,
    isExpired: false,
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
    this.setData({ id: query.id || '' });
  },

  async onShow() {
    if (!(await requireBrowseAccessOrBackHome())) return;
    const state = getAccessState();
    const member = getApp().globalData.member;
    const browseOnly = state.kind === 'pending' || state.kind === 'inactive';
    const isExpired = state.kind === 'inactive' && member && member.status === 'expired';
    this.setData({
      isPending: browseOnly,
      isExpired,
      'form.name': (member && member.name) || '',
    });
    preloadTemplates();
    if (this.data.id) this.load();
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
      track('event_view', { path: '/pages/events/detail', targetId: this.data.id });
    } catch (err) {
      this.setData({
        event: null,
        loading: false,
        error: err.message || '加载失败',
      });
    }
  },

  openLocation() {
    openEventLocation(this.data.event);
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
      track('event_register', { path: '/pages/events/detail', targetId: this.data.id });
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
      track('event_cancel_register', { path: '/pages/events/detail', targetId: this.data.id });
      wx.showToast({ title: '已取消报名', icon: 'success' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: err.message || '取消失败', icon: 'none' });
    } finally {
      this.setData({ cancelling: false });
    }
  },
});

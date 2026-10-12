import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(__dirname, '../../miniprogram/pages/events/detail.js');

const content = `const { request, formatDateTime } = require('../../utils/request');
const { requireMemberOrBackHome } = require('../../utils/auth');
const { resolveMediaUrl, splitLines } = require('../../utils/media');

Page({
  data: {
    id: '',
    event: null,
    coverUrl: '',
    agendaLines: [],
    guestLines: [],
    myRegistration: null,
    canRegister: false,
    ended: false,
    deadlinePassed: false,
    timeLabel: '',
    deadlineLabel: '',
    attendOptions: ['参加', '不参加'],
    attendIndex: 0,
    form: {
      name: '',
      companions: '',
      specialNeeds: '',
    },
    statusText: {
      pending: '待审核',
      approved: '已通过',
      waitlist: '候补',
      cancelled: '已取消',
    },
  },

  onLoad(query) {
    this.setData({ id: query.id || '' });
  },

  async onShow() {
    if (!(await requireMemberOrBackHome())) return;
    const member = getApp().globalData.member;
    this.setData({ 'form.name': (member && member.name) || '' });
    if (this.data.id) this.load();
  },

  async load() {
    try {
      const res = await request({ url: '/events/' + this.data.id });
      const event = res.event;
      const myRegistration = res.myRegistration;
      const now = new Date();
      const ended = event.status === 'closed' || new Date(event.endAt) < now;
      const deadlinePassed = !!(event.registerDeadline && new Date(event.registerDeadline) <= now);
      const canRegister =
        !ended &&
        !deadlinePassed &&
        event.status === 'published' &&
        (!myRegistration || myRegistration.status === 'cancelled');

      this.setData({
        event,
        coverUrl: resolveMediaUrl(event.coverUrl),
        agendaLines: splitLines(event.agenda),
        guestLines: splitLines(event.guests),
        myRegistration,
        canRegister,
        ended,
        deadlinePassed,
        timeLabel: formatDateTime(event.startAt) + ' - ' + formatDateTime(event.endAt),
        deadlineLabel: event.registerDeadline ? formatDateTime(event.registerDeadline) : '',
      });
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },

  onAttendChange(e) {
    this.setData({ attendIndex: Number(e.detail.value) });
  },

  async submit() {
    if (!this.data.form.name || !String(this.data.form.name).trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    try {
      await request({
        url: '/events/' + this.data.id + '/register',
        method: 'POST',
        data: {
          name: this.data.form.name,
          willAttend: this.data.attendIndex === 0,
          companions: this.data.form.companions,
          specialNeeds: this.data.form.specialNeeds,
        },
      });
      wx.showToast({ title: '报名已提交', icon: 'success' });
      this.load();
    } catch (err) {
      wx.showToast({ title: err.message || '报名失败', icon: 'none' });
    }
  },
});
`;

fs.writeFileSync(target, content, 'utf8');
console.log('wrote', target);

const { request, formatDateTime } = require('../../utils/request');
const { requireMemberOrBackHome } = require('../../utils/auth');

/** 列表 chip：报名取消优先，否则按活动阶段 */
function resolveChip(item, now) {
  if (item.status === 'cancelled') {
    return { chipText: '已取消', chipTone: 'muted', phase: 'cancelled' };
  }
  if (item.status === 'waitlist') {
    return { chipText: '候补', chipTone: 'default', phase: 'waitlist' };
  }
  const event = item.event || {};
  const ended =
    event.status === 'closed' || (event.endAt && new Date(event.endAt) < now);
  if (ended) {
    return { chipText: '已结束', chipTone: 'muted', phase: 'ended' };
  }
  const started = event.startAt && new Date(event.startAt) <= now;
  if (started) {
    return { chipText: '进行中', chipTone: 'default', phase: 'ongoing' };
  }
  return { chipText: '已报名', chipTone: 'default', phase: 'upcoming' };
}

Page({
  data: {
    items: [],
    loading: true,
    error: '',
  },

  async onShow() {
    if (!(await requireMemberOrBackHome())) return;
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await request({ url: '/events/mine' });
      const now = new Date();
      const items = (res.items || []).map((item) => {
        const chip = resolveChip(item, now);
        return {
          ...item,
          timeLabel:
            item.event && item.event.startAt
              ? formatDateTime(item.event.startAt).slice(0, 16)
              : '',
          chipText: chip.chipText,
          chipTone: chip.chipTone,
          phase: chip.phase,
        };
      });
      this.setData({ items, loading: false, error: '' });
    } catch (err) {
      this.setData({
        items: [],
        loading: false,
        error: err.message || '加载失败',
      });
    }
  },

  retry() {
    this.load();
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/events/detail?id=' + e.currentTarget.dataset.id });
  },
});

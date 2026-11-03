const { request, formatDateTime } = require('../../utils/request');
const {
  getAccessState,
  gateModeFromState,
  requireBoundMemberOrBackHome,
} = require('../../utils/auth');
const { track } = require('../../utils/track');
const { resolveShareId } = require('../../utils/shareScene');
const { parseBriefBlocks } = require('../../utils/briefHtml');

const ISLAND_SHOW_Y = 96;

function watermarkLabel(member) {
  if (!member) return '前沿社会员';
  const name = String(member.name || '').trim() || '会员';
  const company = String(member.company || '').trim();
  return company ? `${name} · ${company}` : name;
}

function buildToc(blocks) {
  const toc = [];
  const next = (blocks || []).map((b) => {
    if (b.type !== 'part') return b;
    const anchorId = `part-${toc.length}`;
    const n = toc.length + 1;
    toc.push({
      anchorId,
      label: b.label || `PART ${n}`,
      num: n < 10 ? `0${n}` : String(n),
      title: b.title || b.text || '',
    });
    return { ...b, anchorId };
  });
  return { blocks: next, toc };
}

function activeLabel(toc, activeToc) {
  if (activeToc < 0 || !toc || !toc.length) return '';
  const item = toc[activeToc];
  return item ? String(item.title || '').trim() : '';
}

function dockChapterText(toc, activeToc) {
  const label = activeLabel(toc, activeToc);
  if (label) return label.length > 16 ? `${label.slice(0, 16)}…` : label;
  if (toc && toc.length) return '下滑继续阅读';
  return '阅读进度';
}

function progressLabel(progress) {
  const n = Math.round(Number(progress) || 0);
  return `${Math.max(0, Math.min(100, n))}%`;
}

Page({
  data: {
    id: '',
    showGate: false,
    gateMode: 'needInvite',
    visitorMessage: '',
    checkedPhone: '',
    brief: null,
    blocks: [],
    toc: [],
    activeToc: -1,
    activeLabel: '',
    dockChapter: '下滑继续阅读',
    tocOpen: false,
    tocReady: false,
    tocScrollInto: '',
    picking: null,
    progress: 0,
    progressLabel: '0%',
    ambientOn: false,
    islandOn: false,
    scrollInto: '',
    publishedLabel: '',
    watermark: '',
    wmList: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
    ready: false,
    loading: true,
    error: '',
  },

  _tocTops: [],
  _scrollLockUntil: 0,
  _viewportH: 0,
  _progressTick: 0,
  _liveScrollTop: 0,
  _tocTimers: [],

  _clearTocTimers() {
    (this._tocTimers || []).forEach((t) => clearTimeout(t));
    this._tocTimers = [];
  },

  _later(fn, ms) {
    const t = setTimeout(fn, ms);
    this._tocTimers.push(t);
    return t;
  },

  onLoad(query) {
    const id = resolveShareId(query || {});
    this.setData({
      id,
      error: id ? '' : '缺少内参参数',
      loading: !!id,
    });
  },

  async onShow() {
    try {
      wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    } catch (e) {
      // ignore
    }

    if (!this.data.id) {
      const again = resolveShareId({});
      if (again) this.setData({ id: again, error: '', loading: true });
    }

    // 先等会话就绪，避免冷启动 pending 误挡门禁
    const app = getApp();
    if (app.globalData.sessionReady) {
      await Promise.race([
        app.globalData.sessionReady,
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    }

    const state = getAccessState();
    if (
      state.kind === 'needInvite' ||
      state.kind === 'needPhone' ||
      state.kind === 'phoneAuth' ||
      state.kind === 'notMember'
    ) {
      this.setData({
        showGate: true,
        gateMode: gateModeFromState(state),
        visitorMessage: state.message || '请选用微信昵称后进入，并由运营绑定会员。',
        checkedPhone: state.phone || '',
        loading: false,
        brief: null,
        blocks: [],
        toc: [],
        ready: false,
        tocOpen: false,
        islandOn: false,
        ambientOn: false,
        progress: 0,
        progressLabel: '0%',
      });
      return;
    }

    if (!(await requireBoundMemberOrBackHome())) return;

    if (!this.data.id) {
      this.setData({
        loading: false,
        error: '缺少内参参数，请从后台短链或小程序码进入',
        ready: false,
      });
      return;
    }

    const member = getApp().globalData.member;
    this.setData({
      showGate: false,
      watermark: watermarkLabel(member),
    });
    this.load();
  },

  onActivated() {
    this.onShow();
  },

  onNotMember(e) {
    const detail = (e && e.detail) || {};
    this.setData({
      showGate: true,
      gateMode: 'notMember',
      visitorMessage: detail.message || '请联系前沿社运营开通会员后阅读内参。',
      checkedPhone: detail.phone || '',
      brief: null,
      blocks: [],
      toc: [],
      ready: false,
      tocOpen: false,
      islandOn: false,
      ambientOn: false,
      progress: 0,
      progressLabel: '0%',
    });
  },

  async load() {
    this.setData({
      loading: true,
      error: '',
      ready: false,
      tocOpen: false,
      tocReady: false,
      picking: null,
      scrollInto: '',
      tocScrollInto: '',
      progress: 0,
      progressLabel: '0%',
      ambientOn: false,
      islandOn: false,
      activeLabel: '',
      dockChapter: '下滑继续阅读',
    });
    try {
      const res = await request({ url: `/briefs/${this.data.id}` });
      const brief = res.brief || {};
      const parsed = buildToc(parseBriefBlocks(brief.contentHtml || ''));
      this.setData({
        brief,
        blocks: parsed.blocks,
        toc: parsed.toc,
        activeToc: -1,
        activeLabel: '',
        dockChapter: dockChapterText(parsed.toc, -1),
        publishedLabel: brief.publishedAt ? formatDateTime(brief.publishedAt) : '',
        loading: false,
        error: '',
      });
      setTimeout(() => {
        this.setData({ ready: true });
        this.measureToc();
      }, 40);
      track('brief_view', { path: '/pages/briefs/share', targetId: this.data.id });
    } catch (err) {
      this.setData({
        brief: null,
        blocks: [],
        toc: [],
        loading: false,
        ready: false,
        error: err.message || '加载失败',
      });
    }
  },

  measureToc() {
    const toc = this.data.toc || [];
    const q = wx.createSelectorQuery();
    q.select('.reader').boundingClientRect();
    toc.forEach((item) => {
      q.select(`#${item.anchorId}`).boundingClientRect();
    });
    q.exec((rects) => {
      if (!rects || !rects.length) return;
      const scroller = rects[0];
      if (!scroller) return;
      this._viewportH = scroller.height || 0;
      const base = scroller.top || 0;
      this._tocTops = rects.slice(1).map((r) => {
        if (!r) return 0;
        return Math.max(0, (r.top || 0) - base - 48);
      });
    });
  },

  onScroll(e) {
    const detail = (e && e.detail) || {};
    const y = detail.scrollTop || 0;
    this._liveScrollTop = y;
    if (Date.now() < this._scrollLockUntil) return;

    const scrollH = detail.scrollHeight || 0;
    const viewH = this._viewportH || 0;
    const max = Math.max(1, scrollH - viewH);
    const progress = Math.max(0, Math.min(100, Math.round((y / max) * 1000) / 10));

    const tops = this._tocTops || [];
    let idx = -1;
    for (let i = 0; i < tops.length; i += 1) {
      if (y + 28 >= tops[i]) idx = i;
    }

    const past = y > ISLAND_SHOW_Y;
    const islandOn = past && !this.data.tocOpen;
    const ambientOn = past;

    const patch = {};
    const now = Date.now();
    // 进度更新节流，避免滑动中频繁 setData 卡顿
    if (Math.abs(progress - this.data.progress) >= 1 && now - this._progressTick > 80) {
      this._progressTick = now;
      patch.progress = progress;
      patch.progressLabel = progressLabel(progress);
    }
    if (idx !== this.data.activeToc) {
      patch.activeToc = idx;
      patch.activeLabel = activeLabel(this.data.toc, idx);
      patch.dockChapter = dockChapterText(this.data.toc, idx);
    }
    if (islandOn !== this.data.islandOn) patch.islandOn = islandOn;
    if (ambientOn !== this.data.ambientOn) patch.ambientOn = ambientOn;
    if (Object.keys(patch).length) this.setData(patch);
  },

  openToc() {
    if (!(this.data.toc || []).length) return;
    this._clearTocTimers();
    const idx = this.data.activeToc;
    const tocScrollInto = idx < 0 ? 'toc-top' : `toc-${idx}`;
    this.setData({
      tocOpen: true,
      tocReady: false,
      islandOn: false,
      tocScrollInto: '',
      picking: null,
    });
    this._later(() => {
      this.setData({ tocReady: true });
    }, 70);
    this._later(() => {
      this.setData({ tocScrollInto });
    }, 320);
  },

  closeToc() {
    this._clearTocTimers();
    const islandOn = this.data.ambientOn;
    this.setData({
      tocOpen: false,
      tocReady: false,
      tocScrollInto: '',
      picking: null,
      islandOn,
    });
  },

  noop() {},

  jumpTo(e) {
    const id = e.currentTarget.dataset.id;
    const index = Number(e.currentTarget.dataset.index);
    if (!id) return;
    this._clearTocTimers();
    const active = Number.isFinite(index) ? index : -1;
    const toTop = id === 'top' || active < 0;
    this._scrollLockUntil = Date.now() + 800;

    this.setData({
      picking: active,
      activeToc: active,
      activeLabel: activeLabel(this.data.toc, active),
      dockChapter: dockChapterText(this.data.toc, active),
      tocOpen: false,
      tocReady: false,
      tocScrollInto: '',
      scrollInto: '',
      islandOn: !toTop,
      ambientOn: !toTop,
      ...(toTop
        ? { progress: 0, progressLabel: '0%' }
        : {}),
    });

    // 必须先清空再设，重复点同一章也能触发；等目录收起后再滚
    this._later(() => {
      this.setData({ picking: null, scrollInto: id });
    }, 80);
  },

  retry() {
    this.load();
  },
});

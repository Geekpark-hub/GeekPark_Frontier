const { request, formatDateLabel, formatDateTime } = require('../../utils/request');
const {
  getAccessState,
  gateModeFromState,
  syncTabBar,
  hasActiveCachedAccess,
  syncSession,
} = require('../../utils/auth');
const { openExternalUrl } = require('../../utils/openUrl');
const { track, trackPage } = require('../../utils/track');
const { resolveCoverUrl } = require('../../utils/media');

const PAGE_SIZE = 10;
// feed-hero.png 仅 345×200，手机端会被放大发糊；改用更高清品牌图
const DEFAULT_HERO = '/assets/brand/atmosphere.jpg';
const cachedOk = hasActiveCachedAccess();
/** 回顶：显示/隐藏用滞回，避免临界抖动 */
const BACK_TOP_SHOW_Y = 520;
const BACK_TOP_HIDE_Y = 160;

Page({
  data: {
    ready: cachedOk,
    // 有本地活跃会话则首屏不展示门禁，避免重进闪登录页
    showGate: !cachedOk,
    gateMode: 'needInvite',
    visitorMessage: '',
    checkedPhone: '',
    heroEnabled: false,
    heroUrl: '',
    heroReady: false,
    pageLoading: false,
    feedItems: [],
    page: 1,
    hasMore: true,
    loadingMore: false,
    footerText: '',
    showBackTop: false,
    backTopBusy: false,
  },

  _posts: [],
  _polls: [],
  _events: [],
  _pendingTimelineEvents: [],
  _lastDate: '',
  _loading: false,
  _scrollTop: 0,
  _backTopTimer: null,

  async onShow() {
    const app = getApp();
    this.applyAccess();
    if (app.globalData.sessionReady) await app.globalData.sessionReady;
    this.applyAccess();
    // syncTabBar 只在这里调一次，避免连打打断底栏描边动画
    syncTabBar(0);
    if (this.data.showGate) return;
    trackPage('/pages/feed/index');

    const votedId = app.globalData.justVotedPollId;
    if (votedId) {
      app.globalData.justVotedPollId = '';
      this.playVotedLeaveThenReload(votedId);
      return;
    }
    // 首屏骨架；已有列表则静默刷新（不盖 loading）
    this.loadFeed(true);
  },

  applyAccess() {
    const state = getAccessState();
    if (state.kind === 'member' || state.kind === 'pending' || state.kind === 'inactive') {
      // 已在可浏览态时避免反复 setData，减少切 tab 闪屏
      if (this.data.showGate || !this.data.ready || this.data.gateMode !== 'member') {
        this.setData({
          showGate: false,
          gateMode: 'member',
          ready: true,
          visitorMessage: '',
          checkedPhone: '',
        });
      }
      return;
    }
    this._posts = [];
    this._polls = [];
    this._events = [];
    this.setData({
      showGate: true,
      gateMode: gateModeFromState(state),
      visitorMessage: state.message || '',
      checkedPhone: state.phone || '',
      ready: true,
      feedItems: [],
      page: 1,
      hasMore: true,
      footerText: '',
    });
  },

  onActivated() {
    this.applyAccess();
    this.loadFeed(true);
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

  onPullDownRefresh() {
    if (this.data.showGate) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadFeed(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.showGate || !this.data.hasMore || this.data.loadingMore) return;
    this.loadFeed(false);
  },

  onPageScroll(e) {
    const y = (e && e.scrollTop) || 0;
    this._scrollTop = y;
    if (this.data.showGate || this.data.pageLoading) {
      if (this.data.showBackTop) this.setData({ showBackTop: false });
      return;
    }
    const visible = this.data.showBackTop;
    let next = visible;
    if (!visible && y >= BACK_TOP_SHOW_Y) next = true;
    else if (visible && y <= BACK_TOP_HIDE_Y) next = false;
    if (next !== visible) this.setData({ showBackTop: next });
  },

  scrollToTop() {
    if (this.data.backTopBusy) return;
    this.setData({ backTopBusy: true, showBackTop: false });
    track('feed_back_top', { path: '/pages/feed/index', meta: { from: Math.round(this._scrollTop || 0) } });
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 320,
    });
    if (this._backTopTimer) clearTimeout(this._backTopTimer);
    this._backTopTimer = setTimeout(() => {
      this.setData({ backTopBusy: false });
      this._scrollTop = 0;
    }, 360);
  },

  mapEventItem(event, delay) {
    const desc = String(event.description || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    return {
      type: 'event',
      key: `event-${event.id}`,
      delay,
      event: {
        ...event,
        coverUrl: resolveCoverUrl(event.coverUrl) || '',
        showCoverInFeed: event.showCoverInFeed !== false,
        description: desc,
        timeLabel: formatDateTime(event.startAt).slice(5, 16),
      },
    };
  },

  buildItemsFromPosts(posts, { polls = [], events = [], reset = false, anim = false, flushRemaining = false } = {}) {
    const items = reset ? [] : (this.data.feedItems || []).slice();
    let lastDate = reset ? '' : this._lastDate;
    let animIndex = 0;
    const nextDelay = () => {
      if (!anim) return 0;
      const d = Math.min(animIndex * 36, 280);
      animIndex += 1;
      return d;
    };

    if (reset) {
      const pinned = (events || []).filter((e) => e.feedPin);
      const timeline = (events || [])
        .filter((e) => !e.feedPin)
        .slice()
        .sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
      this._pendingTimelineEvents = timeline;

      if (polls.length) {
        items.push({ type: 'date', key: 'd-poll', label: '投票', delay: nextDelay() });
        polls.forEach((poll) => {
          items.push({
            type: 'poll',
            key: `poll-${poll.id}`,
            leaving: false,
            delay: nextDelay(),
            poll: {
              ...poll,
              hasVoted: Boolean(poll.hasVoted),
              endLabel: formatDateTime(poll.endAt).slice(5, 16),
            },
          });
        });
      }

      if (pinned.length) {
        items.push({ type: 'date', key: 'd-event-pin', label: '活动', delay: nextDelay() });
        pinned.forEach((event) => {
          items.push(this.mapEventItem(event, nextDelay()));
        });
      }
    }

    const pending = this._pendingTimelineEvents || [];
    const flushEventsBefore = (beforeTs) => {
      while (pending.length) {
        const next = pending[0];
        const ts = new Date(next.startAt).getTime();
        if (beforeTs != null && Number.isFinite(beforeTs) && ts < beforeTs) break;
        pending.shift();
        const label = formatDateLabel(next.startAt);
        if (label !== lastDate) {
          items.push({ type: 'date', key: `d-event-${next.id}`, label, delay: nextDelay() });
          lastDate = label;
        }
        items.push(this.mapEventItem(next, nextDelay()));
      }
    };

    if (reset && !posts.length) {
      flushEventsBefore(null);
      this._lastDate = lastDate;
      return items;
    }

    posts.forEach((post) => {
      const postTs = new Date(post.publishedAt).getTime();
      flushEventsBefore(postTs);
      const label = formatDateLabel(post.publishedAt);
      if (label !== lastDate) {
        items.push({ type: 'date', key: `d-${post.id}`, label, delay: nextDelay() });
        lastDate = label;
      }
      const content = post.content || '';
      const lines = content.split('\n').filter((l) => l.trim()).length;
      items.push({
        type: 'post',
        key: `p-${post.id}`,
        expanded: false,
        delay: nextDelay(),
        post: {
          ...post,
          content,
          needExpand: content.length > 110 || lines > 4,
        },
      });
    });

    if (flushRemaining) flushEventsBefore(null);

    this._lastDate = lastDate;
    return items;
  },

  async loadHero() {
    try {
      const res = await request({ url: '/feed/hero' });
      const enabled = res && res.enabled !== false;
      const custom = resolveCoverUrl((res && res.url) || '');
      this.setData({
        heroReady: true,
        heroEnabled: enabled,
        heroUrl: enabled ? custom || DEFAULT_HERO : '',
      });
    } catch (e) {
      this.setData({
        heroReady: true,
        heroEnabled: true,
        heroUrl: DEFAULT_HERO,
      });
    }
  },

  async loadFeed(reset = false) {
    if (this.data.showGate) return;
    if (this._loading) return;
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;

    this._loading = true;
    const page = reset ? 1 : this.data.page + 1;
    const showPageLoading = reset && !this.data.feedItems.length;

    if (!reset) {
      this.setData({ loadingMore: true, footerText: '加载中…' });
    } else if (showPageLoading) {
      this.setData({ pageLoading: true, ready: true });
    }

    try {
      const tasks = [
        request({
          url: '/feed',
          data: { page, pageSize: PAGE_SIZE },
          loading: false,
        }),
        reset ? request({ url: '/polls/active' }) : Promise.resolve(null),
        reset ? request({ url: '/events/feed-active' }) : Promise.resolve(null),
        reset ? this.loadHero() : Promise.resolve(null),
      ];

      const [feedRes, pollRes, eventRes] = await Promise.all(tasks);
      if (this.data.showGate) return;
      const posts = feedRes.posts || [];
      const hasMore = Boolean(feedRes.hasMore);

      if (reset) {
        // 进行中投票始终置顶，直到后台结束（已投票也保留展示）
        this._polls = (pollRes && pollRes.polls) || [];
        this._events = (eventRes && eventRes.events) || [];
        this._posts = posts;
        const feedItems = this.buildItemsFromPosts(posts, {
          polls: this._polls,
          events: this._events,
          reset: true,
          anim: true,
          flushRemaining: !hasMore,
        });
        this.setData({
          feedItems,
          page: 1,
          hasMore,
          loadingMore: false,
          pageLoading: false,
          ready: true,
          footerText: hasMore ? '上拉加载更多' : (feedItems.length ? '已经到底了' : ''),
        });
      } else {
        const seen = new Set(this._posts.map((p) => p.id));
        const fresh = posts.filter((p) => !seen.has(p.id));
        this._posts = this._posts.concat(fresh);
        // buildItemsFromPosts(!reset) 已基于现有 feedItems 追加，禁止再 concat，否则整表（含投票）会重复
        const feedItems = this.buildItemsFromPosts(fresh, {
          polls: [],
          reset: false,
          anim: true,
          flushRemaining: !hasMore,
        });
        this.setData({
          feedItems,
          page,
          hasMore,
          loadingMore: false,
          footerText: hasMore ? '上拉加载更多' : '已经到底了',
        });
      }
    } catch (err) {
      this.setData({
        ready: true,
        loadingMore: false,
        pageLoading: false,
        footerText: this.data.hasMore ? '加载失败，上拉重试' : this.data.footerText,
      });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    } finally {
      this._loading = false;
    }
  },

  playVotedLeaveThenReload() {
    // 投票后仍置顶展示，仅刷新数据（不再离场消失）
    this.loadFeed(true);
  },

  goPoll(e) {
    wx.navigateTo({ url: `/pages/poll/detail?id=${e.currentTarget.dataset.id}` });
  },

  goEvent(e) {
    wx.navigateTo({ url: `/pages/events/share?id=${e.currentTarget.dataset.id}` });
  },

  toggleExpand(e) {
    const key = e.currentTarget.dataset.key;
    // 只切换展开态，不主动改 scrollTop，避免滚动条跳动
    const feedItems = this.data.feedItems.map((item) => (
      item.key === key ? { ...item, expanded: !item.expanded } : item
    ));
    this.setData({ feedItems });
  },

  openSource(e) {
    const url = e.currentTarget.dataset.url;
    track('open_source', { path: '/pages/feed/index', meta: { url: String(url || '').slice(0, 200) } });
    openExternalUrl(url, { title: '原文' });
  },
});

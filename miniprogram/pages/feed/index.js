const { request, formatDateLabel, formatDateTime } = require('../../utils/request');
const { getAccessState, gateModeFromState, syncTabBar, hasActiveCachedAccess } = require('../../utils/auth');
const { openExternalUrl } = require('../../utils/openUrl');
const { track, trackPage } = require('../../utils/track');

const PAGE_SIZE = 10;
const cachedOk = hasActiveCachedAccess();

Page({
  data: {
    ready: cachedOk,
    // 有本地活跃会话则首屏不展示门禁，避免重进闪登录页
    showGate: !cachedOk,
    gateMode: 'needPhone',
    visitorMessage: '',
    checkedPhone: '',
    feedItems: [],
    page: 1,
    hasMore: true,
    loadingMore: false,
    footerText: '',
  },

  _posts: [],
  _polls: [],
  _lastDate: '',
  _loading: false,

  async onShow() {
    const app = getApp();
    this.applyAccess();
    if (app.globalData.sessionReady) await app.globalData.sessionReady;
    this.applyAccess();
    syncTabBar(0);
    if (this.data.showGate) return;
    trackPage('/pages/feed/index');

    const votedId = app.globalData.justVotedPollId;
    if (votedId) {
      app.globalData.justVotedPollId = '';
      this.playVotedLeaveThenReload(votedId);
      return;
    }
    // 已有数据时不强制整页重刷，避免回页跳动；下拉可刷新
    if (!this.data.feedItems.length) this.loadFeed(true);
  },

  applyAccess() {
    const state = getAccessState();
    if (state.kind === 'member') {
      this.setData({
        showGate: false,
        gateMode: 'member',
        ready: true,
        visitorMessage: '',
        checkedPhone: '',
      });
      syncTabBar(0);
      return;
    }
    this._posts = [];
    this._polls = [];
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
    syncTabBar(0);
  },

  onActivated() {
    this.applyAccess();
    this.loadFeed(true);
  },

  onNotMember(e) {
    const detail = (e && e.detail) || {};
    this.setData({
      showGate: true,
      gateMode: detail.kind === 'inactive' ? 'inactive' : 'notMember',
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

  buildItemsFromPosts(posts, { polls = [], reset = false, anim = false } = {}) {
    const items = reset ? [] : (this.data.feedItems || []).slice();
    let lastDate = reset ? '' : this._lastDate;
    let pollsInserted = !reset || !polls.length
      ? true
      : items.some((it) => it.type === 'poll');
    let animIndex = 0;
    const nextDelay = () => {
      if (!anim) return 0;
      const d = Math.min(animIndex * 36, 280);
      animIndex += 1;
      return d;
    };

    if (reset && polls.length && !posts.length) {
      items.push({ type: 'date', key: 'd-poll', label: '进行中', delay: nextDelay() });
      polls.forEach((poll) => {
        items.push({
          type: 'poll',
          key: `poll-${poll.id}`,
          leaving: false,
          delay: nextDelay(),
          poll: {
            ...poll,
            endLabel: formatDateTime(poll.endAt).slice(5, 16),
          },
        });
      });
      this._lastDate = lastDate;
      return items;
    }

    posts.forEach((post, index) => {
      const label = formatDateLabel(post.publishedAt);
      if (label !== lastDate) {
        items.push({ type: 'date', key: `d-${post.id}`, label, delay: nextDelay() });
        lastDate = label;
      }
      if (reset && !pollsInserted && index === 0 && polls.length) {
        polls.forEach((poll) => {
          items.push({
            type: 'poll',
            key: `poll-${poll.id}`,
            leaving: false,
            delay: nextDelay(),
            poll: {
              ...poll,
              endLabel: formatDateTime(poll.endAt).slice(5, 16),
            },
          });
        });
        pollsInserted = true;
      }
      const content = post.content || '';
      items.push({
        type: 'post',
        key: `p-${post.id}`,
        expanded: false,
        delay: nextDelay(),
        post: {
          ...post,
          content,
          needExpand: content.length > 140 || content.split('\n').length > 5,
        },
      });
    });

    this._lastDate = lastDate;
    return items;
  },

  async loadFeed(reset = false) {
    if (this.data.showGate) return;
    if (this._loading) return;
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;

    this._loading = true;
    const page = reset ? 1 : this.data.page + 1;

    if (!reset) {
      this.setData({ loadingMore: true, footerText: '加载中…' });
    }

    try {
      const tasks = [
        request({
          url: '/feed',
          data: { page, pageSize: PAGE_SIZE },
        }),
      ];
      if (reset) tasks.push(request({ url: '/polls/active' }));

      const [feedRes, pollRes] = await Promise.all(tasks);
      if (this.data.showGate) return;
      const posts = feedRes.posts || [];
      const hasMore = Boolean(feedRes.hasMore);

      if (reset) {
        this._polls = (pollRes.polls || []).filter((p) => !p.hasVoted);
        this._posts = posts;
        const feedItems = this.buildItemsFromPosts(posts, {
          polls: this._polls,
          reset: true,
          anim: true,
        });
        this.setData({
          feedItems,
          page: 1,
          hasMore,
          loadingMore: false,
          ready: true,
          footerText: hasMore ? '上拉加载更多' : (feedItems.length ? '已经到底了' : ''),
        });
      } else {
        // 去重，避免并发重复页
        const seen = new Set(this._posts.map((p) => p.id));
        const fresh = posts.filter((p) => !seen.has(p.id));
        this._posts = this._posts.concat(fresh);
        const feedItems = this.buildItemsFromPosts(fresh, {
          polls: [],
          reset: false,
          anim: true,
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
        footerText: this.data.hasMore ? '加载失败，上拉重试' : this.data.footerText,
      });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    } finally {
      this._loading = false;
    }
  },

  playVotedLeaveThenReload(pollId) {
    const key = `poll-${pollId}`;
    const hasCard = (this.data.feedItems || []).some((item) => item.key === key);
    if (!hasCard) {
      this.loadFeed(true);
      return;
    }
    if (this._leaveTimer) clearTimeout(this._leaveTimer);
    // 先停顿一下让用户看到卡片，再缓慢离场
    this._leaveTimer = setTimeout(() => {
      const feedItems = this.data.feedItems.map((item) => (
        item.key === key ? { ...item, leaving: true } : item
      ));
      this.setData({ feedItems });
      this._leaveTimer = setTimeout(() => {
        this.loadFeed(true);
      }, 620);
    }, 220);
  },

  goPoll(e) {
    wx.navigateTo({ url: `/pages/poll/detail?id=${e.currentTarget.dataset.id}` });
  },

  toggleExpand(e) {
    const key = e.currentTarget.dataset.key;
    const feedItems = this.data.feedItems.map((item) => {
      if (item.key !== key) return item;
      return { ...item, expanded: !item.expanded };
    });
    this.setData({ feedItems });
  },

  openSource(e) {
    const url = e.currentTarget.dataset.url;
    track('open_source', { path: '/pages/feed/index', meta: { url: String(url || '').slice(0, 200) } });
    openExternalUrl(url, { title: '原文' });
  },
});

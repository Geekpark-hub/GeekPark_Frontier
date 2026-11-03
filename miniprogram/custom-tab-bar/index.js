const { COLOR_ON, easeOutCubic, drawIcon } = require('./icons');
const { hasActiveCachedAccess } = require('../utils/auth');
const { requestSubscribe, shouldPromptSubscribeForMine } = require('../utils/subscribe');

const CSS_SIZE = 28;
const ANIM_MS = 560;

function appData() {
  try {
    return getApp().globalData;
  } catch (e) {
    return null;
  }
}

function peekAnimateKey() {
  const g = appData();
  return (g && g.tabBarAnimateKey) || '';
}

function clearAnimateKey() {
  const g = appData();
  if (g) g.tabBarAnimateKey = '';
}

function markAnimateKey(key) {
  const g = appData();
  if (g) g.tabBarAnimateKey = key;
}

Component({
  data: {
    selected: 0,
    visible: true,
    cssSize: CSS_SIZE,
    iconSrc: {},
    drawingKey: '',
    list: [
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
    ],
  },

  lifetimes: {
    attached() {
      this._pending = 0;
      this._gotSelect = false;
      this._raf = null;
      this._live = null;
      this._animating = false;
      this._ready = false;
      this._pixel = Math.round(CSS_SIZE * Math.min(wx.getSystemInfoSync().pixelRatio || 2, 3));
    },

    ready() {
      this._ready = true;
      // 本地 PNG 立即可用，不再等 canvas 烘焙 —— 修好前 2～3 次冷启动点击
      if (this._gotSelect) this.setSelected(this._pending);
      else this.applyStatic(this.data.selected);
    },

    detached() {
      this.stopLive();
    },
  },

  methods: {
    iconFor(item, on) {
      return on ? item.iconOn : item.iconOff;
    },

    applyStatic(selected) {
      const iconSrc = {};
      this.data.list.forEach((item, i) => {
        iconSrc[item.key] = this.iconFor(item, i === selected);
      });
      this._animating = false;
      this.setData({ iconSrc, selected, drawingKey: '' });
    },

    stopLive() {
      if (this._raf != null && this._live && this._live.canvas) {
        try {
          this._live.canvas.cancelAnimationFrame(this._raf);
        } catch (e) {
          /* ignore */
        }
      }
      this._raf = null;
      this._live = null;
      this._animating = false;
    },

    bindLive(key) {
      return new Promise((resolve) => {
        let tries = 0;
        const probe = () => {
          this.createSelectorQuery()
            .select(`#tab-live-${key}`)
            .fields({ node: true, size: true })
            .exec((res) => {
              const canvas = res && res[0] && res[0].node;
              if (!canvas) {
                if (tries++ < 20) {
                  setTimeout(probe, 16);
                  return;
                }
                resolve(null);
                return;
              }
              canvas.width = this._pixel;
              canvas.height = this._pixel;
              this._live = { canvas, ctx: canvas.getContext('2d'), key };
              resolve(this._live);
            });
        };
        // 等 wx:if 挂载
        wx.nextTick(() => setTimeout(probe, 16));
      });
    },

    async runStroke(key, index) {
      this.stopLive();
      this._animating = true;

      // 其它项保持灰/黑静态；当前项由 canvas 独占绘制（不垫 PNG，避免错位重影）
      const iconSrc = {};
      this.data.list.forEach((item, i) => {
        iconSrc[item.key] = item.key === key ? '' : item.iconOff;
      });
      this.setData({ selected: index, iconSrc, drawingKey: key });

      const live = await this.bindLive(key);
      if (!live || !this._animating) {
        this.applyStatic(index);
        return;
      }

      const start = Date.now();
      const { canvas, ctx } = live;
      const size = this._pixel;
      drawIcon(ctx, key, 0.08, COLOR_ON, size);

      const tick = () => {
        if (!this._animating || !this._live || this._live.key !== key) return;
        const t = Math.min(1, (Date.now() - start) / ANIM_MS);
        drawIcon(ctx, key, easeOutCubic(t), COLOR_ON, size);
        if (t < 1) {
          this._raf = canvas.requestAnimationFrame(tick);
        } else {
          this._raf = null;
          this._live = null;
          this._animating = false;
          this.applyStatic(index);
        }
      };
      this._raf = canvas.requestAnimationFrame(tick);
    },

    setSelected(index) {
      this._gotSelect = true;
      this._pending = index;
      if (!this._ready) return;

      const key = this.data.list[index] && this.data.list[index].key;
      const animateKey = peekAnimateKey();

      if (key && animateKey === key) {
        clearAnimateKey();
        this.runStroke(key, index);
        return;
      }

      if (this._animating && this.data.drawingKey === key) return;

      const iconsReady = this.data.list.every((item) => !!this.data.iconSrc[item.key]);
      if (
        this.data.selected === index &&
        !this._animating &&
        !this.data.drawingKey &&
        iconsReady
      ) {
        return;
      }

      if (this._animating) this.stopLive();
      this.applyStatic(index);
    },

    setVisible(visible) {
      const v = Boolean(visible);
      if (this.data.visible !== v) this.setData({ visible: v });
    },

    /** 待绑访客隐藏「我的」 */
    setTabs(tabs) {
      const next = Array.isArray(tabs) && tabs.length ? tabs : this.data.list;
      const same =
        next.length === this.data.list.length &&
        next.every((t, i) => t.key === this.data.list[i].key);
      if (same) return;
      this.setData({ list: next });
      this.applyStatic(Math.min(this.data.selected, next.length - 1));
    },

    onSwitch(e) {
      const { path, index } = e.currentTarget.dataset;
      if (index === this.data.selected && !this._animating) return;
      const key = this.data.list[index].key;
      // 未绑定正式会员时不允许进「我的」
      if (key === 'mine') {
        try {
          const { getAccessState } = require('../utils/auth');
          if (getAccessState().kind !== 'member') {
            wx.showToast({ title: '开通会员后可使用', icon: 'none' });
            return;
          }
        } catch (err) {
          // ignore
        }
      }
      const go = () => {
        markAnimateKey(key);
        wx.switchTab({ url: path });
      };
      // 点「我的」：一次拉三个模板；须等授权面板结束再 switchTab，否则面板易被打断只剩一个
      if (key === 'mine' && hasActiveCachedAccess()) {
        const g = appData();
        if (g && !g.mineSubscribeAskedThisLaunch && shouldPromptSubscribeForMine()) {
          g.mineSubscribeAskedThisLaunch = true;
          Promise.resolve(requestSubscribe('all')).finally(go);
          return;
        }
      }
      go();
    },
  },
});

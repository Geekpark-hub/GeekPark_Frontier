Component({
  data: {
    selected: 0,
    visible: true,
    list: [
      {
        pagePath: '/pages/feed/index',
        text: '动态',
        iconPath: '/assets/tab-feed.png',
        selectedIconPath: '/assets/tab-feed-active.png',
      },
      {
        pagePath: '/pages/events/index',
        text: '活动',
        iconPath: '/assets/tab-event.png',
        selectedIconPath: '/assets/tab-event-active.png',
      },
      {
        pagePath: '/pages/mine/index',
        text: '我的',
        iconPath: '/assets/tab-mine.png',
        selectedIconPath: '/assets/tab-mine-active.png',
      },
    ],
  },

  methods: {
    setSelected(index) {
      if (this.data.selected !== index) {
        this.setData({ selected: index });
      }
    },

    setVisible(visible) {
      const v = Boolean(visible);
      if (this.data.visible !== v) {
        this.setData({ visible: v });
      }
    },

    onSwitch(e) {
      const { path, index } = e.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: path });
    },
  },
});

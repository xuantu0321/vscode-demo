Page({
  data: { userName: '棋友', avatarInitial: '棋', avatarUrl: '', isLoggedIn: false, versionText: '先从一盘棋开始' },
  onShow() {
    const app = getApp();
    const user = app.globalData.userInfo || {};
    this.setData({ userName: user.nickName || '棋友', avatarInitial: (user.nickName || '棋友').charAt(0), avatarUrl: user.avatarUrl || '', isLoggedIn: !!app.globalData.isLoggedIn });
  },
  goSingle() { wx.navigateTo({ url: '/pages/single/index' }); },
  goRoom() { wx.navigateTo({ url: '/pages/room/index' }); },
  goMatch() { wx.navigateTo({ url: '/pages/matching/index' }); },
  goProfile() { wx.navigateTo({ url: '/pages/profile/index' }); },
  goHome() { wx.pageScrollTo({ scrollTop: 0, duration: 200 }); }
});

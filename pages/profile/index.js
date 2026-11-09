Page({
  data: { userInfo: {}, isLoggedIn: false, nickName: '', avatarInitial: '棋', signature: '' },
  onShow() { this.loadProfile(); },
  loadProfile() {
    const app = getApp();
    const user = app.globalData.userInfo || {};
    this.setData({ userInfo: user, isLoggedIn: !!app.globalData.isLoggedIn, nickName: user.nickName || '', avatarInitial: (user.nickName || '棋友').charAt(0), signature: user.signature || '' });
  },
  goLogin() { wx.navigateTo({ url: '/pages/login/index' }); },
  onChooseAvatar(e) { this.setData({ 'userInfo.avatarUrl': e.detail.avatarUrl }); },
  onNickNameInput(e) { this.setData({ nickName: e.detail.value, avatarInitial: (e.detail.value || '棋友').charAt(0) }); },
  onSignatureInput(e) { this.setData({ signature: e.detail.value }); },
  saveProfile() {
    const app = getApp();
    const old = app.globalData.userInfo || {};
    const nickName = (this.data.nickName || '').trim();
    if (!nickName) { wx.showToast({ title: '请先填写昵称', icon: 'none' }); return; }
    const user = Object.assign({}, old, { nickName, avatarUrl: this.data.userInfo.avatarUrl || '', signature: (this.data.signature || '').trim(), playerId: old.playerId || 'G' + String(Date.now()).slice(-8) });
    app.setUserInfo(user, app.globalData.isLoggedIn);
    this.setData({ userInfo: user });
    wx.showToast({ title: '资料已保存', icon: 'success' });
  },
  logout() {
    wx.showModal({ title: '退出登录', content: '退出后将清除本机保存的用户资料，确定继续吗？', success: (res) => {
      if (!res.confirm) return;
      getApp().clearUserInfo();
      this.loadProfile();
      wx.showToast({ title: '已退出', icon: 'success' });
    }});
  }
});

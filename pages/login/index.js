Page({
  data: { loading: false },
  onWechatLogin() {
    const app = getApp();
    if (!wx.login) { wx.showToast({ title: '当前基础库不支持微信登录', icon: 'none' }); return; }
    this.setData({ loading: true });
    wx.login({
      success: (res) => {
        this.setData({ loading: false });
        if (!res.code) { wx.showToast({ title: '获取登录凭证失败', icon: 'none' }); return; }
        if (!app.globalData.apiBaseUrl) {
          wx.showModal({ title: '还差一步', content: '已成功获取微信临时登录凭证。正式账号认证需要配置后端服务器，由服务器安全地向微信换取用户身份。现在可以先以游客身份体验。', confirmText: '知道了', showCancel: false });
          return;
        }
        wx.request({
          url: app.globalData.apiBaseUrl + '/auth/wechat', method: 'POST', data: { code: res.code },
          success: (response) => {
            const body = response.data || {};
            if (response.statusCode === 200 && body.token && body.user) {
              app.setUserInfo(body.user, true, body.token);
              wx.showToast({ title: '登录成功', icon: 'success' });
              setTimeout(() => wx.navigateBack(), 500);
            } else wx.showToast({ title: body.message || '登录失败，请稍后重试', icon: 'none' });
          },
          fail: () => wx.showToast({ title: '服务器连接失败', icon: 'none' })
        });
      },
      fail: () => { this.setData({ loading: false }); wx.showToast({ title: '微信登录暂不可用', icon: 'none' }); }
    });
  },
  onGuest() {
    const app = getApp();
    const old = app.globalData.userInfo || {};
    const user = Object.assign({ nickName: '棋友', avatarUrl: '', signature: '享受每一步思考', playerId: 'G' + String(Date.now()).slice(-8) }, old);
    app.setUserInfo(user, false);
    wx.showToast({ title: '已进入游客模式', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 400);
  }
});

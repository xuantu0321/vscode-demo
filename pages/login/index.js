const { API_BASE_URL, CLOUD_ENV, CLOUD_SERVICE } = require('../../config');

function parseBody(data) {
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch (e) { return {}; }
  }
  return data || {};
}

Page({
  data: { loading: false },

  onWechatLogin() {
    if (!wx.login) { wx.showToast({ title: '当前基础库不支持微信登录', icon: 'none' }); return; }
    this.setData({ loading: true });
    wx.login({
      success: (res) => {
        if (!res.code) {
          this.setData({ loading: false });
          wx.showToast({ title: '获取登录凭证失败', icon: 'none' });
          return;
        }
        this.loginWithCode(res.code);
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '微信登录暂不可用', icon: 'none' });
      }
    });
  },

  loginWithCode(code) {
    if (CLOUD_ENV && CLOUD_SERVICE && wx.cloud && wx.cloud.callContainer) {
      this.loginByContainer(code);
      return;
    }
    const apiBaseUrl = getApp().globalData.apiBaseUrl || API_BASE_URL;
    if (apiBaseUrl) {
      this.loginByRequest(apiBaseUrl, code);
      return;
    }
    this.setData({ loading: false });
    wx.showModal({
      title: '还差一步',
      content: '已成功获取微信临时登录凭证。请先在 config.js 配置云托管环境，或配置 API_BASE_URL 后由服务端换取用户身份。现在可以先以游客身份体验。',
      confirmText: '知道了',
      showCancel: false
    });
  },

  loginByContainer(code) {
    wx.cloud.callContainer({
      config: { env: CLOUD_ENV },
      path: '/auth/wechat',
      method: 'POST',
      header: {
        'X-WX-SERVICE': CLOUD_SERVICE,
        'content-type': 'application/json'
      },
      data: { code },
      success: (res) => {
        const statusCode = res && (res.statusCode || res.status);
        this.finishLogin(statusCode, parseBody(res && res.data));
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '云托管调用失败，请检查服务状态', icon: 'none' });
      }
    });
  },

  loginByRequest(apiBaseUrl, code) {
    wx.request({
      url: apiBaseUrl + '/auth/wechat',
      method: 'POST',
      data: { code },
      success: (response) => {
        this.finishLogin(response.statusCode, parseBody(response.data));
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '服务器连接失败', icon: 'none' });
      }
    });
  },

  finishLogin(statusCode, body) {
    this.setData({ loading: false });
    if (Number(statusCode) === 200 && body.token && body.user) {
      getApp().setUserInfo(body.user, true, body.token);
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }
    wx.showToast({ title: (body && body.message) || '登录失败，请稍后重试', icon: 'none' });
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

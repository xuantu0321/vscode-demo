const { API_BASE_URL, CLOUD_ENV, getWsBaseUrl } = require('./config');

App({
  globalData: {
    userInfo: null,
    isLoggedIn: false,
    sessionToken: '',
    apiBaseUrl: API_BASE_URL, // 正式接入微信登录后，在 config.js 中填写 HTTPS API 地址
    wsBaseUrl: getWsBaseUrl() // 开发/体验版用 config.js 的 DEV_WS_BASE_URL，正式版用 PROD_WS_BASE_URL
  },

  onLaunch() {
    if (CLOUD_ENV && wx.cloud && wx.cloud.init) {
      try {
        wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
      } catch (e) {
        console.warn('[cloud] 初始化失败：', e && e.message ? e.message : e);
      }
    }
    const savedUser = wx.getStorageSync('gomoku_user_info');
    const savedLogin = wx.getStorageSync('gomoku_is_logged_in');
    this.globalData.sessionToken = wx.getStorageSync('gomoku_session_token') || '';
    if (savedUser) this.globalData.userInfo = savedUser;
    this.globalData.isLoggedIn = !!savedLogin;
  },

  // 小程序重新启动或从后台恢复时，检查是否有尚未结束的联机对局。
  onShow() {
    const activeGame = wx.getStorageSync('gomoku_active_game');
    if (!activeGame || !activeGame.roomId || !activeGame.playerId) return;
    const pages = getCurrentPages();
    const current = pages.length ? pages[pages.length - 1].route : '';
    if (current === 'pages/game/index') return;
    const query = 'roomId=' + encodeURIComponent(activeGame.roomId) +
      '&playerId=' + encodeURIComponent(activeGame.playerId) +
      '&color=' + encodeURIComponent(activeGame.color) +
      '&mode=' + encodeURIComponent(activeGame.mode || 'room') + '&resume=1';
    wx.reLaunch({ url: '/pages/game/index?' + query });
  },

  setUserInfo(userInfo, isLoggedIn = false, token = '') {
    this.globalData.userInfo = userInfo;
    this.globalData.isLoggedIn = isLoggedIn;
    this.globalData.sessionToken = token || '';
    wx.setStorageSync('gomoku_user_info', userInfo);
    wx.setStorageSync('gomoku_is_logged_in', !!isLoggedIn);
    if (token) wx.setStorageSync('gomoku_session_token', token);
    else wx.removeStorageSync('gomoku_session_token');
  },

  clearUserInfo() {
    this.globalData.userInfo = null;
    this.globalData.isLoggedIn = false;
    this.globalData.sessionToken = '';
    wx.removeStorageSync('gomoku_user_info');
    wx.removeStorageSync('gomoku_is_logged_in');
    wx.removeStorageSync('gomoku_session_token');
  }
});

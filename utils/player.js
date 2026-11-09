
function getPlayer() {
  let player = wx.getStorageSync('gomoku_guest_player');

  if (!player || !player.playerId) {
    player = {
      playerId: 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      nickName: '棋友'
    };

    wx.setStorageSync('gomoku_guest_player', player);
  }

  const app = getApp();
  const user = app.globalData.userInfo || {};
  const loggedIn = !!app.globalData.isLoggedIn;

  // 登录用户使用服务端下发的 playerId（由微信 openid 派生），游客使用本机 ID。
  const playerId = (loggedIn && user.playerId) ? user.playerId : player.playerId;

  return {
    playerId,
    nickName: user.nickName || player.nickName || '棋友',
    avatarUrl: user.avatarUrl || ''
  };
}

module.exports = { getPlayer };


function getPlayer() {
  let player = wx.getStorageSync('gomoku_guest_player');

  if (!player || !player.playerId) {
    player = {
      playerId: 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      nickName: '棋友'
    };

    wx.setStorageSync('gomoku_guest_player', player);
  }

  const user = getApp().globalData.userInfo || {};

  // 输出实际保存的玩家 ID，方便检查重启前后是否一致
  console.log('[玩家身份] 当前 playerId:', player.playerId);

  return {
    playerId: player.playerId,
    nickName: user.nickName || player.nickName || '棋友',
    avatarUrl: user.avatarUrl || ''
  };
}

module.exports = { getPlayer };

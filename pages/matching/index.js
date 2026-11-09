const { connectSocket, send } = require('../../utils/socket');
const { getPlayer } = require('../../utils/player');
Page({ data: { status: '正在连接服务器…', searching: false },
  onLoad() { this.player = getPlayer(); this.socket = connectSocket({ onOpen: () => { this.setData({ status: '准备就绪，点击开始匹配' }); }, onMessage: m => this.handleMessage(m), onError: () => this.setData({ status: '连接失败，请检查服务器配置' }), onClose: () => this.setData({ status: '连接已断开' }) }); },
  onUnload() { if (this.socket) { if (this.data.searching) send(this.socket, 'cancel_match', { playerId: this.player.playerId }); this.socket.close(); } },
  startMatch() { if (!this.socket) return; this.setData({ searching: true, status: '正在寻找棋友，请稍候…' }); send(this.socket, 'find_match', { player: this.player }); },
  cancelMatch() { send(this.socket, 'cancel_match', { playerId: this.player.playerId }); this.setData({ searching: false, status: '已取消匹配' }); },
  handleMessage(m) { if (m.type === 'match_found') wx.redirectTo({ url: `/pages/game/index?roomId=${m.roomId}&playerId=${this.player.playerId}&color=${m.color}&mode=match` }); else if (m.type === 'match_waiting') this.setData({ status: '匹配中…找到对手后将自动进入棋局' }); else if (m.type === 'match_cancelled') this.setData({ searching: false, status: '已取消匹配' }); else if (m.type === 'error') { this.setData({ searching: false, status: m.message }); wx.showToast({ title: m.message, icon: 'none' }); } }
});

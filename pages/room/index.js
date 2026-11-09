const { connectSocket, send } = require('../../utils/socket');
const { getPlayer } = require('../../utils/player');
Page({
  data: { roomCode: '', status: '连接服务器中…', connected: false, creating: false },
  onLoad() {
    this.player = getPlayer();
    this.socket = connectSocket({
      onOpen: () => { this.setData({ connected: true, status: '已连接，可以创建或加入房间' }); },
      onMessage: msg => this.handleMessage(msg),
      onError: () => this.setData({ status: '连接失败，请检查服务器地址和网络' }),
      onClose: () => this.setData({ connected: false })
    });
  },
  onUnload() { if (this.socket) this.socket.close(); },
  inputCode(e) { this.setData({ roomCode: (e.detail.value || '').replace(/\D/g, '').slice(0, 6) }); },
  createRoom() { if (!this.data.connected) return wx.showToast({ title: '服务器尚未连接', icon: 'none' }); this.setData({ status: '正在创建房间…', creating: true }); send(this.socket, 'create_room', { player: this.player }); },
  copyRoomCode() { if (!this.data.roomCode) return; wx.setClipboardData({ data: this.data.roomCode, success: () => wx.showToast({ title: '房间号已复制', icon: 'success' }) }); },
  joinRoom() { const code = this.data.roomCode; if (!/^\d{6}$/.test(code)) return wx.showToast({ title: '请输入 6 位房间号', icon: 'none' }); send(this.socket, 'join_room', { roomCode: code, player: this.player }); this.setData({ status: '正在加入房间…' }); },
  handleMessage(msg) {
    if (msg.type === 'room_created' || msg.type === 'game_start') {
      wx.redirectTo({ url: `/pages/game/index?roomId=${msg.roomId}&playerId=${this.player.playerId}&color=${msg.color}&mode=room` });
    } else if (msg.type === 'error') { this.setData({ status: msg.message, creating: false }); wx.showToast({ title: msg.message, icon: 'none' }); }
    else if (msg.type === 'room_waiting') this.setData({ status: `房间 ${msg.roomId} 已创建，等待好友加入`, creating: false, roomCode: msg.roomId });
  }
});

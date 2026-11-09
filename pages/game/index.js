const { connectSocket, send } = require('../../utils/socket');
const { getPlayer } = require('../../utils/player');

const BOARD_SIZE = 15;
const STAR_POINTS = [
  [3, 3], [11, 3],
  [7, 7],
  [3, 11], [11, 11]
];

function buildBoardPoints(board, lastMove) {
  const points = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      points.push({
        x,
        y,
        stone: board[y][x],
        left: `${(20 + x * 40) / 600 * 100}%`,
        top: `${(20 + y * 40) / 600 * 100}%`,
        isStar: STAR_POINTS.some(([sx, sy]) => sx === x && sy === y),
        isLast: !!lastMove && lastMove.x === x && lastMove.y === y
      });
    }
  }
  return points;
}

Page({
  data: {
    board: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0)),
    points: [],
    columns: 'ABCDEFGHIJKLMNO'.split(''),
    rows: Array.from({ length: BOARD_SIZE }, (_, i) => BOARD_SIZE - i),
    myColor: 1,
    currentPlayer: 1,
    status: '连接棋局中…',
    roomId: '',
    gameOver: false,
    winner: '',
    lastMoveLabel: ''
  },

  onLoad(q) {
    const savedGame = wx.getStorageSync('gomoku_active_game') || {};
    const roomId = q.roomId || savedGame.roomId;
    const color = q.color || savedGame.color;
    const mode = q.mode || savedGame.mode || 'room';
    this.roomId = roomId;
    this.player = getPlayer();
    this.lastMove = null;
    const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    this.setData({
      roomId,
      myColor: Number(color) || 1,
      myName: this.player.nickName,
      points: buildBoardPoints(board, null)
    });

    // 保存本局身份，微信开发者工具重新编译后可自动恢复。
    wx.setStorageSync('gomoku_active_game', {
      roomId: this.roomId,
      playerId: this.player.playerId,
      color: Number(color) || 1,
      mode
    });

    this.socket = connectSocket({
      onOpen: () => {
        this.setData({ status: '已连接，正在恢复对局…' });
        send(this.socket, 'reconnect', {
          roomId: this.roomId,
          player: this.player
        });
      },
      onMessage: m => this.handleMessage(m),
      onError: () => this.setData({ status: '连接失败' }),
      onClose: () => this.setData({ status: '连接断开，尝试重新进入可恢复棋局' })
    });
  },

  onUnload() {
    if (this.socket) this.socket.close();
  },

  tapBoard(e) {
    if (this.data.gameOver || this.data.currentPlayer !== this.data.myColor) return;
    const q = e.currentTarget.dataset || {};
    const x = Number(q.x);
    const y = Number(q.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
    if (this.data.board[y][x] !== 0) return;

    // x/y 是棋盘交叉点索引，与服务器二维数组 board[y][x] 完全一致。
    send(this.socket, 'move', {
      roomId: this.roomId,
      playerId: this.player.playerId,
      x,
      y
    });
  },

  handleMessage(m) {
    if (m.type === 'game_state' || m.type === 'game_start') {
      this.applyGameState(m);
    } else if (m.type === 'move_applied') {
      const previous = this.data.board;
      let lastMove = null;
      // 服务端广播完整棋盘。找出本次新增的棋子，用于标记最后一手。
      for (let y = 0; y < BOARD_SIZE && !lastMove; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          if (m.board[y][x] !== 0 && previous[y][x] === 0) {
            lastMove = { x, y };
            break;
          }
        }
      }
      this.lastMove = lastMove || this.lastMove;
      this.applyGameState(m, this.lastMove);
    } else if (m.type === 'opponent_left') {
      this.setData({ status: '对手已断开连接，等待重连…' });
    } else if (m.type === 'error') {
      wx.showToast({ title: m.message, icon: 'none' });
      this.setData({ status: m.message });
      if (m.code === 'room_not_found') this.exitMissingGame();
    }
  },

  // 棋局已被服务端回收（超时、重启或对手弃房）时，清除本地断线恢复记录，避免启动后反复进入空棋局。
  exitMissingGame() {
    if (this.exiting) return;
    this.exiting = true;
    wx.removeStorageSync('gomoku_active_game');
    wx.showModal({
      title: '对局已结束',
      content: '该棋局已不存在或已超时关闭，请返回大厅重新开始。',
      showCancel: false,
      success: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  },

  applyGameState(m, lastMove = null) {
    const board = m.board || Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    const gameOver = !!m.gameOver;
    if (gameOver) wx.removeStorageSync('gomoku_active_game');
    const status = gameOver
      ? (m.winner === this.player.playerId ? '你赢了！' : (m.winner ? '本局结束，你输了' : '平局，本局结束'))
      : (this.data.myColor === m.currentPlayer ? '轮到你落子' : '等待对手落子');

    this.setData({
      board,
      points: buildBoardPoints(board, lastMove),
      currentPlayer: m.currentPlayer,
      status,
      gameOver,
      winner: m.winner || '',
      lastMoveLabel: lastMove ? this.pointToLabel(lastMove.x, lastMove.y) : ''
    });
  },

  pointToLabel(x, y) {
    return String.fromCharCode(65 + x) + (15 - y);
  }
});

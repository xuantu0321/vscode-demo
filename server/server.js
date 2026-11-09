const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const WS_OPEN = 1;
const HEARTBEAT_INTERVAL = 30 * 1000; // 清理与心跳检查间隔
const CLIENT_TIMEOUT = 75 * 1000; // 超过该时间没有收到任何消息则判定为断线
const ROOM_TTL = 3 * 60 * 60 * 1000; // 房间最长保留时间
const OFFLINE_ROOM_TTL = 10 * 60 * 1000; // 双方都离线后保留棋局用于重连的时间
const QUEUE_TTL = 5 * 60 * 1000; // 匹配队列最长等待时间
const LEAVE_NOTICE_DELAY = 1500; // 断线通知延迟，给页面跳转/重连留出时间

const rooms = new Map();
const waiting = [];
const clients = new Map();

const isOnline = ws => !!ws && ws.readyState === WS_OPEN;
const send = (ws, data) => { if (isOnline(ws)) ws.send(JSON.stringify(data)); };
const broadcast = (room, data) => room.players.forEach(p => send(p.ws, data));
const newBoard = () => Array.from({ length: 15 }, () => Array(15).fill(0));

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, waiting: waiting.length, clients: clients.size }));
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Gomoku WebSocket server is running');
});

const wss = new WebSocketServer({ server });

function win(board, x, y, color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  return dirs.some(([dx, dy]) => {
    let n = 1;
    for (let k = 1; k < 5; k++) { const a = x + dx * k, b = y + dy * k; if (a < 0 || a > 14 || b < 0 || b > 14 || board[b][a] !== color) break; n++; }
    for (let k = 1; k < 5; k++) { const a = x - dx * k, b = y - dy * k; if (a < 0 || a > 14 || b < 0 || b > 14 || board[b][a] !== color) break; n++; }
    return n >= 5;
  });
}

function roomCode() { let code; do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code)); return code; }

function addPlayer(room, player, ws, color) {
  const p = { playerId: String(player.playerId), nickName: String(player.nickName || '棋友').slice(0, 20), ws, color, leaveTimer: null };
  room.players.push(p);
  room.byId.set(p.playerId, p);
  clients.set(ws, p);
  return p;
}

function startRoom(room) {
  room.started = true;
  room.lastActivity = Date.now();
  room.players.forEach(p => send(p.ws, {
    type: room.mode === 'match' ? 'match_found' : 'game_start',
    roomId: room.id,
    color: p.color,
    board: room.board,
    currentPlayer: room.currentPlayer
  }));
}

function createRoom(ws, player, mode = 'room') {
  const id = roomCode();
  const room = {
    id, mode, players: [], byId: new Map(), board: newBoard(), currentPlayer: 1,
    started: false, gameOver: false, winner: null,
    createdAt: Date.now(), lastActivity: Date.now()
  };
  rooms.set(id, room);
  addPlayer(room, player, ws, 1);
  return room;
}

function removeFromQueue(playerId) {
  for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].player.playerId === playerId) waiting.splice(i, 1);
}

function findRoomOf(playerId) {
  for (const room of rooms.values()) if (room.byId.has(String(playerId))) return room;
  return null;
}

function handle(ws, msg) {
  const type = msg.type;

  if (type === 'ping') {
    return send(ws, { type: 'pong' });
  }

  if (type === 'create_room') {
    if (!msg.player || !msg.player.playerId) return send(ws, { type: 'error', message: '用户信息无效' });
    const room = createRoom(ws, msg.player);
    send(ws, { type: 'room_waiting', roomId: room.id });

  } else if (type === 'join_room') {
    const room = rooms.get(String(msg.roomCode || ''));
    if (!room) return send(ws, { type: 'error', message: '房间不存在或已关闭' });
    if (!msg.player || !msg.player.playerId) return send(ws, { type: 'error', message: '用户信息无效' });
    // 创建者在开局前离开时，房间已经失效；连同空房一起清理，避免加入后无人落子。
    if (!room.players.some(p => isOnline(p.ws))) {
      rooms.delete(room.id);
      return send(ws, { type: 'error', message: '房间已关闭，请让好友重新创建' });
    }
    if (room.byId.has(String(msg.player.playerId))) return send(ws, { type: 'error', message: '不能加入自己创建的房间' });
    if (room.started || room.players.length >= 2) return send(ws, { type: 'error', message: '房间已经满员' });
    addPlayer(room, msg.player, ws, 2);
    startRoom(room);

  } else if (type === 'find_match') {
    if (!msg.player || !msg.player.playerId) return send(ws, { type: 'error', message: '用户信息无效' });
    removeFromQueue(msg.player.playerId);
    const opponentIndex = waiting.findIndex(item => item.player.playerId !== msg.player.playerId && isOnline(item.ws));
    if (opponentIndex < 0) {
      waiting.push({ ws, player: msg.player, at: Date.now() });
      return send(ws, { type: 'match_waiting' });
    }
    const opponent = waiting.splice(opponentIndex, 1)[0];
    const room = createRoom(opponent.ws, opponent.player, 'match');
    addPlayer(room, msg.player, ws, 2);
    startRoom(room);

  } else if (type === 'cancel_match') {
    removeFromQueue(String(msg.playerId || ''));
    send(ws, { type: 'match_cancelled' });

  } else if (type === 'reconnect') {
    const room = rooms.get(String(msg.roomId || ''));
    const player = room && msg.player && room.byId.get(String(msg.player.playerId));
    if (!room || !player) return send(ws, { type: 'error', code: 'room_not_found', message: '棋局不存在或身份无法恢复' });

    if (player.leaveTimer) { clearTimeout(player.leaveTimer); player.leaveTimer = null; }
    if (player.ws && player.ws !== ws) clients.delete(player.ws);
    player.ws = ws;
    player.nickName = String(msg.player.nickName || player.nickName).slice(0, 20);
    clients.set(ws, player);
    room.lastActivity = Date.now();

    const state = {
      type: 'game_state', roomId: room.id, board: room.board,
      currentPlayer: room.currentPlayer, gameOver: room.gameOver, winner: room.winner
    };
    send(ws, state);
    if (room.players.length === 2) room.players.forEach(p => { if (p !== player) send(p.ws, state); });

  } else if (type === 'move') {
    const room = rooms.get(String(msg.roomId || ''));
    if (!room) return send(ws, { type: 'error', code: 'room_not_found', message: '棋局不存在' });
    const player = room.byId.get(String(msg.playerId || ''));
    if (!player || player.ws !== ws) return send(ws, { type: 'error', message: '玩家身份验证失败' });
    const x = Number(msg.x), y = Number(msg.y);
    if (!room.started || room.gameOver) return send(ws, { type: 'error', message: '当前棋局不能落子' });
    if (player.color !== room.currentPlayer) return send(ws, { type: 'error', message: '还没轮到你落子' });
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 14 || y < 0 || y > 14 || room.board[y][x] !== 0) return send(ws, { type: 'error', message: '这个位置不能落子' });

    room.board[y][x] = player.color;
    const won = win(room.board, x, y, player.color);
    room.gameOver = won || room.board.every(row => row.every(v => v !== 0));
    if (won) room.winner = player.playerId;
    room.currentPlayer = player.color === 1 ? 2 : 1;
    room.lastActivity = Date.now();
    broadcast(room, { type: 'move_applied', board: room.board, currentPlayer: room.currentPlayer, gameOver: room.gameOver, winner: room.winner });

  } else {
    send(ws, { type: 'error', message: '未知操作' });
  }
}

wss.on('connection', ws => {
  ws.lastSeen = Date.now();

  ws.on('message', raw => {
    ws.lastSeen = Date.now();
    try {
      handle(ws, JSON.parse(raw.toString()));
    } catch (e) {
      send(ws, { type: 'error', message: '服务器处理失败' });
      console.error(e);
    }
  });

  ws.on('error', () => { try { ws.terminate(); } catch (e) {} });

  ws.on('close', () => {
    const p = clients.get(ws);
    clients.delete(ws);
    if (!p) return;
    removeFromQueue(p.playerId);
    if (p.ws !== ws) return;
    p.ws = null;

    const room = findRoomOf(p.playerId);
    if (!room) return;
    // 未开局的房间没有重连价值，创建者离开后直接回收。
    if (!room.started) { rooms.delete(room.id); return; }

    if (p.leaveTimer) clearTimeout(p.leaveTimer);
    p.leaveTimer = setTimeout(() => {
      p.leaveTimer = null;
      if (isOnline(p.ws) || !rooms.has(room.id)) return;
      room.players.forEach(other => { if (other !== p) send(other.ws, { type: 'opponent_left' }); });
    }, LEAVE_NOTICE_DELAY);
    if (p.leaveTimer.unref) p.leaveTimer.unref();
  });
});

setInterval(() => {
  const now = Date.now();

  for (const [id, room] of rooms) {
    const anyOnline = room.players.some(p => isOnline(p.ws));
    if (now - room.createdAt > ROOM_TTL) { rooms.delete(id); continue; }
    if (!anyOnline && (!room.started || now - room.lastActivity > OFFLINE_ROOM_TTL)) rooms.delete(id);
  }

  for (let i = waiting.length - 1; i >= 0; i--) {
    if (!isOnline(waiting[i].ws) || now - waiting[i].at > QUEUE_TTL) waiting.splice(i, 1);
  }

  // 应用层心跳：长时间没有任何消息的连接视为僵尸连接。
  wss.clients.forEach(ws => {
    if (now - (ws.lastSeen || 0) > CLIENT_TIMEOUT) { try { ws.terminate(); } catch (e) {} }
  });
}, HEARTBEAT_INTERVAL).unref();

server.listen(PORT, () => console.log(`Gomoku server listening on ${PORT}`));

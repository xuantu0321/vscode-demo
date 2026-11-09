const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const WX_APPID = process.env.WX_APPID || '';
const WX_SECRET = process.env.WX_SECRET || '';
// 未配置 AppSecret 时，只有非生产环境或显式开启才信任云托管身份头，避免公网伪造。
const ALLOW_HEADER_AUTH = process.env.ALLOW_HEADER_AUTH === '1' || process.env.NODE_ENV !== 'production';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000;
if (!process.env.TOKEN_SECRET) {
  console.warn('[auth] 未设置 TOKEN_SECRET，服务重启后已签发的登录 token 会失效');
}
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

function jsonResponse(res, statusCode, payload) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { tooLarge = true; return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('请求体过大');
        error.statusCode = 413;
        return reject(error);
      }
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch (e) {
        const error = new Error('请求体不是合法 JSON');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function signToken(playerId) {
  const payload = Buffer.from(JSON.stringify({
    sub: playerId,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function code2Session(code) {
  if (typeof fetch !== 'function') throw new Error('当前 Node 版本不支持 fetch，请使用 Node 18+');
  const query = new URLSearchParams({
    appid: WX_APPID,
    secret: WX_SECRET,
    js_code: code,
    grant_type: 'authorization_code'
  });
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(8000)
    : undefined;
  const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`, { signal });
  const data = await response.json();
  if (!response.ok || data.errcode || !data.openid) {
    const error = new Error(`微信登录失败：${data.errmsg || `HTTP ${response.status}`}`);
    error.statusCode = 401;
    throw error;
  }
  return data.openid;
}

async function handleWechatLogin(req, res) {
  const body = await readJsonBody(req);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const headerOpenId = String(req.headers['x-wx-openid'] || '').trim();
  let openId = '';

  if (WX_APPID && WX_SECRET) {
    // 配置了 AppSecret 时只认 code 换取的 openid，避免客户端伪造身份头。
    if (!code) return jsonResponse(res, 400, { message: '缺少微信登录凭证 code' });
    openId = await code2Session(code);
  } else if (headerOpenId && ALLOW_HEADER_AUTH) {
    // 未配置 AppSecret 时使用云托管 callContainer 注入的身份头，仅适合联调。
    openId = headerOpenId;
  } else {
    return jsonResponse(res, 500, { message: '服务端未配置 WX_APPID / WX_SECRET' });
  }

  if (!openId) return jsonResponse(res, 401, { message: '微信身份校验失败' });

  const playerId = 'wx_' + crypto.createHash('sha256').update(openId).digest('hex').slice(0, 20);
  const token = signToken(playerId);
  return jsonResponse(res, 200, {
    token,
    user: {
      playerId,
      nickName: String(body.nickName || '微信用户').slice(0, 20),
      avatarUrl: ''
    }
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = (req.url || '').split('?')[0];

  if (pathname === '/health') {
    return jsonResponse(res, 200, {
      ok: true,
      rooms: rooms.size,
      waiting: waiting.length,
      clients: clients.size,
      authConfigured: !!(WX_APPID && WX_SECRET)
    });
  }

  if (pathname === '/auth/wechat') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { message: '仅支持 POST' });
    try {
      await handleWechatLogin(req, res);
    } catch (error) {
      console.error('[auth]', error.message);
      jsonResponse(res, error.statusCode || 500, { message: error.message || '登录失败' });
    }
    return;
  }

  if (pathname === '/' || pathname === '') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Gomoku WebSocket server is running');
  }

  return jsonResponse(res, 404, { message: 'Not Found' });
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

server.listen(PORT, '0.0.0.0', () => console.log(`Gomoku server listening on ${PORT}`));

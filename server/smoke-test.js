// 服务端冒烟测试：覆盖建房/加入/落子校验/心跳/重连/弃房回收/匹配。
// 用法：先启动 server（默认 3000 端口），再在 server 目录执行 `npm test`。
// 也可用 SMOKE_URL 指向其他地址，例如：SMOKE_URL=ws://127.0.0.1:3100 npm test
const assert = require('assert');
const WebSocket = require('ws');

const URL = process.env.SMOKE_URL || 'ws://127.0.0.1:3000';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class Client {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => resolve(this));
      this.ws.on('error', reject);
      this.ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
        // 已有等待者时直接交付，不再入队，否则同一条消息会被重复消费。
        const waiterIndex = this.waiters.findIndex(waiter => waiter.type === msg.type);
        if (waiterIndex >= 0) {
          const [waiter] = this.waiters.splice(waiterIndex, 1);
          waiter.resolve(msg);
          return;
        }
        this.messages.push(msg);
      });
    });
  }

  send(payload) {
    this.ws.send(JSON.stringify(payload));
  }

  waitFor(type, timeout = 3000) {
    const index = this.messages.findIndex(m => m.type === type);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w.timer !== timer);
        reject(new Error(`${this.name} 等待 ${type} 超时，已收到：${JSON.stringify(this.messages)}`));
      }, timeout);
      this.waiters.push({
        type,
        timer,
        resolve: msg => { clearTimeout(timer); resolve(msg); }
      });
    });
  }

  async expectNone(type, duration = 2000) {
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) {
      assert.ok(!this.messages.some(m => m.type === type), `${this.name} 不应收到 ${type}`);
      await delay(50);
    }
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  // 1. 建房与加入
  const alice = await new Client('alice').connect();
  alice.send({ type: 'create_room', player: { playerId: 'alice', nickName: '甲' } });
  const waiting = await alice.waitFor('room_waiting');
  assert.ok(/^\d{6}$/.test(waiting.roomId), '房间号应为 6 位数字');
  const roomId = waiting.roomId;

  const bob = await new Client('bob').connect();
  bob.send({ type: 'join_room', roomCode: roomId, player: { playerId: 'bob', nickName: '乙' } });
  const [startA, startB] = await Promise.all([alice.waitFor('game_start'), bob.waitFor('game_start')]);
  assert.strictEqual(startA.color, 1, '创建者执黑');
  assert.strictEqual(startB.color, 2, '加入者执白');
  assert.strictEqual(startA.currentPlayer, 1, '黑棋先手');
  console.log('✓ 建房、加入与开局广播');

  // 2. 落子与回合/占用校验
  alice.send({ type: 'move', roomId, playerId: 'alice', x: 7, y: 7 });
  const appliedByBob = await bob.waitFor('move_applied');
  const appliedByAlice = await alice.waitFor('move_applied');
  assert.strictEqual(appliedByBob.board[7][7], 1);
  assert.strictEqual(appliedByBob.currentPlayer, 2);
  assert.strictEqual(appliedByAlice.currentPlayer, 2);

  alice.send({ type: 'move', roomId, playerId: 'alice', x: 7, y: 8 });
  assert.match((await alice.waitFor('error')).message, /还没轮到/);

  bob.send({ type: 'move', roomId, playerId: 'bob', x: 7, y: 7 });
  assert.match((await bob.waitFor('error')).message, /不能落子/);

  bob.send({ type: 'move', roomId, playerId: 'bob', x: 7, y: 8 });
  assert.strictEqual((await alice.waitFor('move_applied')).currentPlayer, 1);
  console.log('✓ 落子同步与非法落子拦截');

  // 3. 应用层心跳
  alice.send({ type: 'ping' });
  await alice.waitFor('pong');
  console.log('✓ 心跳 ping/pong');

  // 4. 快速重连：对手不应收到断线通知
  alice.close();
  await delay(150);
  const alice2 = await new Client('alice2').connect();
  alice2.send({ type: 'reconnect', roomId, player: { playerId: 'alice', nickName: '甲' } });
  const state = await alice2.waitFor('game_state');
  assert.strictEqual(state.board[7][7], 1, '重连后恢复棋盘');
  await bob.expectNone('opponent_left', 2000);
  console.log('✓ 快速重连不误报对手离线');

  // 5. 真正离线后通知对手（延迟 1.5 秒）
  alice2.close();
  await bob.waitFor('opponent_left', 4000);
  console.log('✓ 离线通知对手');

  // 6. 开局前弃房回收：加入应失败
  const carol = await new Client('carol').connect();
  carol.send({ type: 'create_room', player: { playerId: 'carol', nickName: '丙' } });
  const ghost = await carol.waitFor('room_waiting');
  carol.close();
  await delay(300);

  const dave = await new Client('dave').connect();
  dave.send({ type: 'join_room', roomCode: ghost.roomId, player: { playerId: 'dave', nickName: '丁' } });
  assert.match((await dave.waitFor('error')).message, /不存在|已关闭/);
  console.log('✓ 弃房回收');

  // 7. 随机匹配
  const eve = await new Client('eve').connect();
  const frank = await new Client('frank').connect();
  eve.send({ type: 'find_match', player: { playerId: 'eve', nickName: '戊' } });
  await eve.waitFor('match_waiting');
  frank.send({ type: 'find_match', player: { playerId: 'frank', nickName: '己' } });
  const [foundE, foundF] = await Promise.all([eve.waitFor('match_found'), frank.waitFor('match_found')]);
  assert.strictEqual(foundE.roomId, foundF.roomId);
  assert.deepStrictEqual([foundE.color, foundF.color], [1, 2]);
  console.log('✓ 随机匹配');

  // 8. 五连判胜
  const gina = await new Client('gina').connect();
  const hank = await new Client('hank').connect();
  gina.send({ type: 'create_room', player: { playerId: 'gina', nickName: '庚' } });
  const ginaRoom = (await gina.waitFor('room_waiting')).roomId;
  hank.send({ type: 'join_room', roomCode: ginaRoom, player: { playerId: 'hank', nickName: '辛' } });
  await Promise.all([gina.waitFor('game_start'), hank.waitFor('game_start')]);

  const play = async (mover, opponent, x, y) => {
    mover.send({ type: 'move', roomId: ginaRoom, playerId: mover.name, x, y });
    const own = await mover.waitFor('move_applied');
    await opponent.waitFor('move_applied');
    return own;
  };

  const opening = [
    [gina, hank, 7, 7], [hank, gina, 0, 0],
    [gina, hank, 8, 7], [hank, gina, 0, 1],
    [gina, hank, 9, 7], [hank, gina, 0, 2],
    [gina, hank, 10, 7], [hank, gina, 0, 3]
  ];
  for (const [mover, opponent, x, y] of opening) await play(mover, opponent, x, y);
  const winning = await play(gina, hank, 11, 7);
  assert.strictEqual(winning.gameOver, true);
  assert.strictEqual(winning.winner, 'gina');
  console.log('✓ 五连判胜');

  [bob, dave, eve, frank, gina, hank].forEach(client => client.close());
  console.log('\n全部冒烟测试通过');
}

run().then(() => process.exit(0)).catch(err => {
  console.error('\n冒烟测试失败：', err.message);
  process.exit(1);
});

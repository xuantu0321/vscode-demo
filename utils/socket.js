// 应用层心跳间隔。微信小程序的 SocketTask 不能发送协议层 ping 帧，
// 因此用业务消息保活；服务端超过 75 秒收不到任何消息会主动断开该连接。
const HEARTBEAT_INTERVAL = 25000;

const BASE_URL = () => (getApp().globalData.wsBaseUrl || '').trim();

function connectSocket(handlers = {}) {
  const url = BASE_URL();
  if (!url) {
    wx.showModal({ title: '尚未配置联机服务器', content: '请先部署 server，并在 config.js 中配置 wsBaseUrl。', showCancel: false });
    return null;
  }
  const task = wx.connectSocket({ url, timeout: 10000 });
  let heartbeat = null;

  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  task.onOpen(() => {
    stopHeartbeat();
    heartbeat = setInterval(() => {
      if (typeof task.readyState === 'number' && task.readyState !== 1) return;
      task.send({ data: JSON.stringify({ type: 'ping' }), fail: () => {} });
    }, HEARTBEAT_INTERVAL);
    handlers.onOpen && handlers.onOpen(task);
  });
  task.onMessage(res => {
    let msg;
    try { msg = JSON.parse(res.data); } catch (e) { return; }
    handlers.onMessage && handlers.onMessage(msg);
  });
  task.onError(err => {
    stopHeartbeat();
    handlers.onError && handlers.onError(err);
  });
  task.onClose(res => {
    stopHeartbeat();
    handlers.onClose && handlers.onClose(res);
  });
  return task;
}

function send(task, type, payload = {}) {
  if (!task) return;
  task.send({ data: JSON.stringify({ type, ...payload }), fail: () => {} });
}

module.exports = { connectSocket, send };

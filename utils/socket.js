const { CLOUD_ENV, CLOUD_SERVICE, getEnvVersion } = require('../config');

// 应用层心跳间隔。微信小程序的 SocketTask 不能发送协议层 ping 帧，
// 因此用业务消息保活；服务端超过 75 秒收不到任何消息会主动断开该连接。
const HEARTBEAT_INTERVAL = 25000;

const BASE_URL = () => (getApp().globalData.wsBaseUrl || '').trim();

// 体验版/正式版优先用云托管 connectContainer：不需要配置 socket 合法域名，
// 且能走云托管内网路由。开发版仍连本地 ws:// 服务，方便调试。
function useCloudContainer() {
  const env = getEnvVersion();
  return (env === 'trial' || env === 'release') &&
    !!CLOUD_ENV && !!CLOUD_SERVICE &&
    !!(wx.cloud && typeof wx.cloud.connectContainer === 'function');
}

class SocketConnection {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.task = null;
    this.opened = false;
    this.closed = false;
    this.heartbeat = null;
    this.pending = [];
    this.connect();
  }

  connect() {
    if (useCloudContainer()) {
      try {
        wx.cloud.connectContainer({
          config: { env: CLOUD_ENV },
          service: CLOUD_SERVICE,
          path: '/'
        }).then(result => {
          this.bind(result && result.socketTask);
        }).catch(error => {
          this.handleError(error);
        });
      } catch (error) {
        this.handleError(error);
      }
      return;
    }

    const url = BASE_URL();
    if (!url) {
      this.handleError(new Error('尚未配置联机服务器'));
      return;
    }
    try {
      this.bind(wx.connectSocket({ url, timeout: 10000 }));
    } catch (error) {
      this.handleError(error);
    }
  }

  bind(task) {
    if (!task) {
      this.handleError(new Error('未获取到 WebSocket 连接'));
      return;
    }
    if (this.closed) {
      try { task.close({}); } catch (e) {}
      return;
    }
    this.task = task;

    task.onOpen(() => {
      if (this.closed) return;
      this.opened = true;
      this.startHeartbeat();
      this.flush();
      this.handlers.onOpen && this.handlers.onOpen(this);
    });

    task.onMessage(res => {
      let msg;
      try { msg = JSON.parse(res.data); } catch (e) { return; }
      this.handlers.onMessage && this.handlers.onMessage(msg);
    });

    task.onError(error => {
      this.handleError(error);
    });

    task.onClose(res => {
      this.opened = false;
      this.stopHeartbeat();
      if (!this.closed) {
        this.closed = true;
        this.handlers.onClose && this.handlers.onClose(res);
      }
    });
  }

  flush() {
    if (!this.task) return;
    const pending = this.pending;
    this.pending = [];
    pending.forEach(data => {
      try { this.task.send({ data, fail: () => {} }); } catch (e) {}
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (!this.opened || !this.task || this.closed) return;
      try {
        this.task.send({ data: JSON.stringify({ type: 'ping' }), fail: () => {} });
      } catch (e) {}
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  handleError(error) {
    this.stopHeartbeat();
    if (!this.closed && this.handlers.onError) this.handlers.onError(error);
  }

  send(payload) {
    if (this.closed) return;
    const data = typeof payload === 'string' ? payload : payload && payload.data;
    if (!data) return;
    if (this.opened && this.task) {
      try { this.task.send({ data, fail: () => {} }); } catch (e) {}
    } else {
      this.pending.push(data);
    }
  }

  close() {
    this.closed = true;
    this.stopHeartbeat();
    this.pending = [];
    if (this.task) {
      try { this.task.close({}); } catch (e) {}
    }
  }
}

function connectSocket(handlers = {}) {
  if (!useCloudContainer() && !BASE_URL()) {
    wx.showModal({ title: '尚未配置联机服务器', content: '请先部署 server，并在 config.js 中配置 wsBaseUrl。', showCancel: false });
    return null;
  }
  return new SocketConnection(handlers);
}

function send(connection, type, payload = {}) {
  if (!connection || typeof connection.send !== 'function') return;
  connection.send({ data: JSON.stringify({ type, ...payload }) });
}

module.exports = { connectSocket, send };

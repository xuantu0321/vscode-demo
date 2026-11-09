// 联机服务地址配置。
// 开发版/体验版使用局域网或测试服务器地址；正式版必须使用 wss:// 正式域名，
// 并在微信公众平台「开发管理-开发设置-服务器域名」中把该域名加入 socket 合法域名。
// 开发版/体验版默认连本机服务，微信开发者工具可直接使用；
// 真机联调时改成电脑的局域网 IP，例如 ws://192.168.1.10:3000。
const DEV_WS_BASE_URL = 'ws://192.168.42.227:3000';
const PROD_WS_BASE_URL = ''; // 例：'wss://gomoku.example.com'
const API_BASE_URL = ''; // 例：'https://gomoku.example.com'，用于微信登录换取 Token

function getEnvVersion() {
  try {
    return (wx.getAccountInfoSync().miniProgram.envVersion) || 'develop';
  } catch (e) {
    return 'develop';
  }
}

function getWsBaseUrl() {
  const env = getEnvVersion();
  if (env === 'release') return PROD_WS_BASE_URL;
  return DEV_WS_BASE_URL;
}

module.exports = {
  DEV_WS_BASE_URL,
  PROD_WS_BASE_URL,
  API_BASE_URL,
  getEnvVersion,
  getWsBaseUrl
};

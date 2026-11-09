// 联机服务地址配置。
// 云托管服务：express-bf9s；环境 ID：prod-d8ghg6ygc0ef05aca。
// 开发版默认连本机服务；体验版/正式版连云托管公网域名。
const DEV_WS_BASE_URL = 'ws://192.168.42.227:3000';
const PROD_WS_BASE_URL = 'wss://express-bf9s-344454-6-1526871378.sh.run.tcloudbase.com';
const API_BASE_URL = ''; // 直接使用 wx.request 时填写 HTTPS 域名；使用 callContainer 时留空

// 微信云托管配置：登录时通过 wx.cloud.callContainer 调 /auth/wechat。
const CLOUD_ENV = 'prod-d8ghg6ygc0ef05aca';
const CLOUD_SERVICE = 'express-bf9s';

function getEnvVersion() {
  try {
    return (wx.getAccountInfoSync().miniProgram.envVersion) || 'develop';
  } catch (e) {
    return 'develop';
  }
}

function getWsBaseUrl() {
  const env = getEnvVersion();
  if (env === 'release' || env === 'trial') return PROD_WS_BASE_URL;
  return DEV_WS_BASE_URL;
}

module.exports = {
  DEV_WS_BASE_URL,
  PROD_WS_BASE_URL,
  API_BASE_URL,
  CLOUD_ENV,
  CLOUD_SERVICE,
  getEnvVersion,
  getWsBaseUrl
};

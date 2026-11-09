# 五子棋小程序 - 第三阶段（联机对战）

在第二阶段基础上新增好友房间、随机匹配、实时棋局页面及 Node.js WebSocket 服务端。原有首页、个人中心和单机摆谱保留。

## 目录
- `config.js`：联机服务器与 HTTPS API 地址配置（区分开发版/体验版与正式版）
- `pages/room`：创建 6 位房间号、加入好友房间
- `pages/matching`：随机匹配及取消匹配
- `pages/game`：15×15 在线棋盘、轮流落子、胜负状态
- `utils/socket.js`：WebSocket 连接封装，体验版/正式版优先走 `wx.cloud.connectContainer`，开发版走 `wx.connectSocket`，含 25 秒应用层心跳
- `utils/player.js`：游客/本地用户身份
- `server/server.js`：服务端权威棋局、房间和匹配队列，含心跳清理、空闲房间回收和微信登录接口
- `server/Dockerfile`：微信云托管镜像构建文件
- `server/smoke-test.js`：服务端协议冒烟测试

## 本地启动服务端
需要 Node.js 18 或更高版本：

```bash
cd server
npm install
npm start
```

服务默认监听 `3000` 端口；访问 `http://localhost:3000/health` 可检查服务状态。服务端附带冒烟测试，需先启动服务，再执行：

```bash
npm test
```

## 小程序连接配置
地址集中在 `config.js`：

- `DEV_WS_BASE_URL`：开发版使用，当前为 `ws://192.168.42.227:3000`；换电脑或换网络后改成新的局域网 IP。
- `PROD_WS_BASE_URL`：体验版/正式版的回退地址，当前为云托管公网域名 `wss://express-bf9s-344454-6-1526871378.sh.run.tcloudbase.com`。基础库支持 `connectContainer` 时优先走云托管内部连接，不依赖这个域名。
- `CLOUD_ENV` / `CLOUD_SERVICE`：微信云托管环境 ID 和服务名；登录用 `wx.cloud.callContainer`，联机用 `wx.cloud.connectContainer`。
- `API_BASE_URL`：不使用 `callContainer`、改用 `wx.request` 直连时填写 HTTPS 域名；当前留空。

`app.js` 启动时执行 `wx.cloud.init({ env: CLOUD_ENV })`。开发版连 `DEV_WS_BASE_URL`；体验版/正式版在基础库 ≥ 2.21.1 时用 `wx.cloud.connectContainer`，否则回退到 `PROD_WS_BASE_URL` + `wx.connectSocket`。

## 微信云托管部署（当前配置）

云托管环境：`prod-d8ghg6ygc0ef05aca`，服务名：`express-bf9s`，公网域名：`https://express-bf9s-344454-6-1526871378.sh.run.tcloudbase.com`。

部署步骤：

1. 在云托管控制台把 `server` 目录作为代码上传/构建，Dockerfile 为 `server/Dockerfile`。
2. 服务端口设置为 `80`（容器内代码读取云托管注入的 `PORT`，不写死）。
3. 配置环境变量：
   - `WX_APPID`：小程序 AppID（当前工程为 `wx0066a216ea8ea00b`）。
   - `WX_SECRET`：小程序 AppSecret，只放云托管环境变量，不要写进代码或提交到 Git。
   - `TOKEN_SECRET`：自定义随机字符串，用于签发登录 token；多实例时必须一致。
   - `ALLOW_HEADER_AUTH`：本地没有 AppSecret 时设为 `1`，允许用云托管注入的 `X-WX-OPENID` 联调；生产环境不要开启。
4. 实例数设置为 **最小 1、最大 1**。当前房间和匹配队列都在内存中，多实例会导致两个玩家落到不同实例、房间找不到。
5. 公网访问可选：`callContainer` / `connectContainer` 走云托管内部路由，不依赖公网；公网访问主要用于 `/health` 检查和 `wx.connectSocket` 回退。
6. 在微信公众平台「开发管理-开发设置-服务器域名」中把云托管域名加入 socket 合法域名**只有回退到 `wx.connectSocket` 时才需要**；正常 `connectContainer` 路径不需要配置该域名。若配置，格式为 `wss://express-bf9s-344454-6-1526871378.sh.run.tcloudbase.com`。
7. 重新编译/上传小程序，真机选择体验版或正式版验证联机与登录。

登录链路：`wx.login` 获取 code → `wx.cloud.callContainer` POST `/auth/wechat` → 服务端用 `WX_APPID`/`WX_SECRET` 调 `jscode2session` → 返回签名 token 和由 openid 派生的 `playerId`。没有配置 AppSecret 时，只有非生产环境或 `ALLOW_HEADER_AUTH=1` 才会退回读取 `X-WX-OPENID` 头；生产环境必须配置 AppSecret。

注意：iOS 高性能+ 模式下 `connectContainer` 暂不能携带微信身份头，但联机只依赖 `playerId`，不受影响；登录仍通过 `callContainer` 完成。

云托管模板默认是 Express.js，但本服务端使用 Node 原生 `http` + `ws`，云托管只要求容器监听 `PORT`，不强制 Express。如果后续要在模板的 `index.js` 上继续开发，把 `server.js` 里的 WebSocket 挂到模板的 `http.createServer(app)` 实例即可，注意不要另起端口。

模板附带的 MySQL 当前没有被使用；不需要的话可以保留空库，不影响五子棋联机。

## 联调步骤
1. 先启动服务端，并确保小程序设备能访问该服务。
2. 修改 `config.js` 的 `DEV_WS_BASE_URL`。
3. 使用两个不同微信开发者工具实例/两台设备测试好友房间：设备 A 创建房间并复制房间号，设备 B 输入房间号加入。
4. 两端进入棋局后交替落子，验证双方棋盘同步及五子连线结束。
5. 再分别从两端测试随机匹配、取消匹配和断线重连。

## 当前阶段边界与上线前必做
- 当前服务端使用内存保存房间和匹配队列；进程重启会清空对局，不适合多实例部署。正式环境应增加 Redis/数据库及房间状态持久化。
- 登录接口已经接入微信 `code2session`，但 WebSocket 的 `create_room` / `join_room` / `move` 等消息仍未校验 token；playerId 仍由客户端提交，只能作为当前阶段的身份标识，不能作为防作弊依据。下一步应在 WebSocket 握手或消息中校验 token。
- 当前支持房间内实时落子、服务端回合校验、落子位置校验、胜负判断、基础断线重连、应用层心跳，以及弃房/空闲房间与匹配队列回收；暂未实现认输、和棋协商、观战、聊天、超时判负及完整对局记录。
- 正式部署需要进程守护、日志、限流、反作弊和安全审计。

## 说明
本阶段提供可运行的基础联机闭环，需先部署服务端（云托管或自建 WSS 服务）才能进行跨设备联机测试。JavaScript 与 JSON 配置可做静态语法检查，但最终仍需在微信开发者工具和真实网络环境中验证。

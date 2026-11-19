# LTMultiUserChangeMsg / 多人一起听 IM

## 协议

官方 Android 客户端把「多人一起听人员变化」定义为：

`com.netease.cloudmusic.module.listentogether.im.LTMultiUserChangeMsg`

- 继承 `AbsListenTogetherMsg`，构造参数 `super(30005, roomId)`。
- 实现 `pz0.o`，由 `module.listentogether.im.r0` 分发。
- `parseFromJson(raw, content)` 把 `content` 反序列化为
  `module.listentogether.meta.LTMultiRoomUserList`（`serverSeq`/`version`、
  `onlineNums`、`onlineUserInfos`）。
- 消息位于 `serverExt.type = 30005`、`serverExt.content`；聊天室消息的
  `custom` 就是这层 JSON。

官方 IM 是网易云信 NIM：

| 动作       | SID | CID | 关键字段                                                                |
| ---------- | --- | --- | ----------------------------------------------------------------------- |
| 握手       | 1   | 1   | `int keyVersion` + RSA 加密的首包                                       |
| IM 登录    | 2   | 2/3 | `18=appKey`、`19=account`、`1000=token`、`3=clientType`、`6=sdkVersion` |
| 进入聊天室 | 13  | 2   | `byte 2` + login 属性 + imLogin 属性（`5=chatroomId`、`8=appLogin`）    |
| 聊天室消息 | 13  | 7   | 属性表；字段 `4=remoteExtension`、`21=from`、`20=time`                  |
| 退出聊天室 | 13  | 4   | —                                                                       |

## 实现

1. `src/shared/lt-members.ts`
   - `parseLtMemberUpdate()` 同时接受 IM 通知与 chatroom 消息的
     `serverExt` / `remoteExtension` 两种信封。
   - 校验 `type === 30005`、`onlineUserInfos`、UID 精度、重复成员、500 人上限；
     排序优先用 `version`，没有时用 `serverSeq`。
2. `src/main/lt-chatroom.ts`
   - 用官方 `@yxim/nim-web-sdk` 的 `NIM_Web_Chatroom_nodejs.js` 连接主 NIM 聊天室。
   - appKey 为官方主 NIM 的 `3a6a3e48f6854dfa4e4464f3bdaec3b4`。
   - 账号/token 来自 `/api/middle/im/token-and-chatroom-addr/get`：
     `bizName=music_listenTogether`、`roomId=<chatRoomId>`、`appType=6`。
   - `autoconnect: false`，即 `appLogin=1`，与官方非独立聊天室模式一致。
   - 聊天室地址从 `https://lbs.netease.im/lbs/webconf.jsp?appkey=…` 的
     `chatwl*` 地址获取。
   - 每条聊天室消息的 `custom` 都会尝试解析 30005；命中后把完整成员列表
     回调给 worker。
3. worker → 主进程 → preload → `useParty.ts`
   - `room-members` 事件直接替换成员列表/在线人数，状态栏显示
     `成员更新于 …（IM）`。
   - 原来的 `multiStatus` 10 秒轮询保留为兜底。
   - 离开房间时关闭聊天室连接。

## 实测结果

在真实账号、真实多人房间验证通过：

```text
[lt-chatroom] connected {"chatroomId":"16802255519"}
[lt-chatroom] custom {"serverExt":{"type":30005,"content":{"onlineNums":5,...}}}
[lt-chatroom] members {"count":5,"version":160}
```

`30005.content` 里同时有 `serverSeq`、`version`、`currentSongBizId`、
`nextSongBizId` 和 `onlineUserInfos`，成员列表会立即刷新。

实测 `30005` 是**周期性快照**：大约每 30 秒和 `30000` 一起推送一次，成员
加入/退出时也会额外触发。因此渲染层只在成员集合真的变化时替换列表，避免
每 30 秒按服务端返回顺序重排头像。

主 NIM 凭据是通过 Frida hook `com.netease.nimlib.c.d()` 和
`com.netease.nimlib.sdk.auth.LoginInfo` 确认的：account 为数字 UID，
`loginExt=null`，token 与 `token-and-chatroom-addr/get` 返回的一致。
manifest 里的 `28f4…` 不是主聊天室所用的 appKey，会导致 302。

## 调试：查看 IM 原始 JSON

worker stdout 被主进程 `stdio: 'ignore'` 丢弃，worker 内也关闭了 console，
所以原始消息统一从 worker 转发给主进程打印：

```bash
MUSIC_PARTY_IM_DEBUG=1 pnpm dev
```

开发模式默认开启，打包后默认关闭。终端会出现：

```text
[IM ...] [lt-chatroom] custom {"serverExt":{"type":30005,...}}
[IM ...] [lt-chatroom] members {"count":5,"version":160}
```

- 聊天室消息可能包含用户聊天内容，分享日志前请脱敏。
- 只看人员变化：`grep 30005`。
- 关闭：`MUSIC_PARTY_IM_DEBUG=0 pnpm dev`。

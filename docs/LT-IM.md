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
   - 从聊天室消息的 `custom` 解析 30005，将本次返回的成员资料、在线人数和版本交给 worker。
3. worker → 主进程 → preload → `useParty.ts`
   - `room-members` 事件按房间和版本过滤。人数取有效的 `onlineNums`，缺失时取本次有效成员数。名单使用 `onlineUserInfos` 中有有效 UID 的成员；已有成员保持顺序，新成员追加到末尾。
   - 可出现人数已增加、资料尚未到齐的快照。成员页按人数差额显示「等待成员资料」，收到资料后更新头像和昵称。房间内仍每 10 秒查询 `multiStatus`。[同步实现](../src/renderer/src/useParty.ts) · [成员页](../src/renderer/src/player/MembersDrawer.tsx)
   - 离开房间时关闭聊天室连接。

## 实测结果

在真实账号、真实多人房间验证通过：

```text
[lt-chatroom] connected {"chatroomId":"<chatroomId>"}
[lt-chatroom] custom {"serverExt":{"type":30005,"content":{"onlineNums":5,...}}}
[lt-chatroom] members {"count":5,"version":160}
```

`30005.content` 里同时有 `serverSeq`、`version`、`currentSongBizId`、
`nextSongBizId` 和 `onlineUserInfos`。该样本的在线人数和有效成员数都是 5。调试输出里的 `members.count` 指成功解析的成员数，可和同条消息中的 `onlineNums` 对照。

在该房间的观测中，`30005` 大约每 30 秒随 `30000` 出现一次，成员进出时也观察到额外推送。该间隔是样本观测值。

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

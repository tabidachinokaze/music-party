# 业务接口

渲染层有一个业务调用入口，`window.together.call({ method, args? }) → Promise<Reply>`。它接受下表 48 个方法。`useParty.api` 已经拆开 IPC 回包。表中 `body` 始终指 `reply.data`，例如 `song` 的歌曲在 `body.songs`，房间则在 `body.data.multiLtRoomSnapshot`。直接调用桥接时才需要手动检查 `reply.ok`。[声明](../../src/shared/types.ts) · [入参白名单与回包处理](../../src/main/service.ts) · [桌面桥接](desktop.md)

```ts
import { toSong } from '../../shared/protocol' // 从 src/renderer/src 引用

const reply = await window.together.call({ method: 'song', args: { ids: '4101' } })
if (reply.ok) {
  const tracks = (reply.data.songs ?? []).map(toSong)
  // tracks[0].id 是字符串，tracks[0].duration 是毫秒。
} else {
  // reply.error 是用户可见错误。发送相关操作另看 reply.deliveryUnknown。
}
```

下表以 `?` 表示可省略，以 `—` 表示无参数。业务 ID 通过字符串传递，`offset` 和 `before` 是非负整数。`cursor` 是后端返回的不透明字符串，第一页省略。写操作成功时有些回包只有确认字段。客户端必须保留错误和结果未确认状态。

## 账号与登录

| method     | args  | body 中读取的数据与作用                                                                                            | worker 使用的模块或上游路径                                                   |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `account`  | —     | `data.profile` 或空，取 `userId/nickname/avatarUrl`。账号变更触发重新加载，未登录时可得到空 profile 或登录失效错误 | `login_status` → `/api/w/nuser/account/get`                                   |
| `qrCreate` | —     | `{key, qrimg, qrurl}` 在 body 顶层，显示二维码，保留 key 供本次检查                                                | `login_qr_key` → `/api/login/qrcode/unikey`，`login_qr_create` 在本机生成图像 |
| `qrCheck`  | `key` | `code` 为 800 过期、801 待扫码、802 待确认、803 登录成功。803 后调用 `account`                                     | `login_qr_check` → `/api/login/qrcode/client/login`                           |
| `logout`   | —     | `{code:200}`，清理本机登录态、账号相关缓存和通知订阅                                                               | 本地会话操作                                                                  |

## 搜索、音乐库与播放资源

| method        | args                       | body 中读取的数据与作用                                                                                                                                                                                 | worker 使用的模块或上游路径                                                                                               |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `search`      | `keywords, kind?, offset?` | `result.songs/songCount`、`result.playlists/playlistCount` 或 `result.artists/artistCount`。kind 为 `songs`（默认）、`playlists`、`artists`，每页 30 项。切换匹配用歌仅查询 songs，保存独立账号搜索历史 | `cloudsearch` → `/api/cloudsearch/pc`                                                                                     |
| `song`        | `ids`                      | `songs[]` → `Song[]`。ids 是逗号分隔的十进制字符串，最多 500 个，集合通常每次 100 首。按请求的 ID 顺序还原，缺项记录为 unavailable                                                                      | `song_detail` → `/api/v3/song/detail`                                                                                     |
| `stream`      | `id`                       | `data[0].url/freeTrialInfo`。无 URL 显示播放受限，只能试听的音源仅在允许试听的流程使用。兼容回退时有 `compatibility`                                                                                    | `song_url_v1` → `/api/song/enhance/player/url/v1`（standard），请求异常可回退 `song_url` → `/api/song/enhance/player/url` |
| `lyrics`      | `id`                       | `lrc.lyric` 为原词，`tlyric.lyric` 为可选译词，各自解析 LRC，按同一毫秒时间匹配。无原词时用 nolyric 区分纯音乐与暂无歌词                                                                                | `lyric` → `/api/song/lyric`                                                                                               |
| `playlists`   | `uid, offset?`             | `playlist[]/more`，每页 50，连续加载本人创建及收藏的目录                                                                                                                                                | `user_playlist` → `/api/user/playlist`                                                                                    |
| `playlist`    | `id`                       | `playlist.trackIds[].id` 提供完整曲序，再分批调 `song`。写入检查还用 `playlist.id/creator.userId/specialType`                                                                                           | `playlist_detail` → `/api/v6/playlist/detail`                                                                             |
| `playlistAdd` | `playlistId, songId, uid`  | 写前核对账号、歌单归属、特殊类型及曲目是否已存在。重复时 `alreadyExists:true`。新增成功后刷新或更新该歌单计数                                                                                           | `login_status` + `playlist_detail` + `/api/playlist/manipulate/tracks`                                                    |
| `albums`      | `offset?`                  | `data[]` 为收藏的专辑，读 `id/name/picUrl/size/artists`。每页 50，顺序使用 `hasMore`、`more`、`count` 或页长判断是否继续                                                                                | `album_sublist` → `/api/album/sublist`                                                                                    |
| `album`       | `id`                       | `songs[]` 为专辑曲序。目录入口或消息卡提供标题。专辑详情一次读取                                                                                                                                        | `album` → `/api/v1/album/{id}`                                                                                            |
| `artistSongs` | `id, offset?`              | `songs[]/more/total`，热门顺序，每页 100。歌手详情通过 `artistId` 打开                                                                                                                                  | `artist_songs` → `/api/v1/artist/songs`                                                                                   |
| `likes`       | `uid`                      | `ids[]` 转为当前账号的 `Set<string>`，供各页判断红心                                                                                                                                                    | `likelist` → `/api/song/like/get`                                                                                         |
| `like`        | `id, value`                | `value` 是布尔值。成功后更新个人红心集合。对房间当前曲新增红心时另行判断是否发 `multiRedHeart`                                                                                                          | `like` → `/api/radio/like`                                                                                                |

## 房间、匹配与播放

`roomId` 是业务房间 ID，`bizId` 取某一次推荐的 `songBizId`。创建和匹配用歌由 `matchSong` 提供，接受邀请时传房间和邀请人。除邀请预览外，这些业务调用在本地要求登录。[具体路径与操作码](../../src/main/multi-api.ts) · [快照解析](../../src/shared/multiplayer.ts)

| method              | args                          | body 中读取的数据与作用                                                                                                                                   | 上游路径                                                |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `multiPreview`      | `roomId, inviterUid`          | `data.roomStatus/inviter.nickname/songData.name` 用于邀请，AVAILABLE 可用、EXPIRED 已过期。房间信息可另读 `data.roomCreator.{userId,nickname}` 核对创建者 | `/api/listen/together/multi/landing/info/get`           |
| `multiCreate`       | `songId, allowStrangerMatch?` | `data.success === true`，读取 `data.multiLtRoomSnapshot`。false 或省略建私密好友房，true 建公开好友房                                                     | `/api/listen/together/multi/room/create`                |
| `multiJoin`         | `roomId, inviterUid`          | 确认并核对 `data.multiLtRoomSnapshot.roomId`，成功挂接房间。匹配通知 ACK 使用 `inviterUid:"0"`                                                            | `/api/listen/together/multi/match/ack`                  |
| `multiStatus`       | —                             | `data.status` 与可空的 `data.multiLtRoomSnapshot` 用于发现、恢复、成员更新及写前目标核对。快照还可提供创建者 ID、房间类型和音乐标签                       | `/api/listen/together/multi/match/status/get`           |
| `multiHeartbeat`    | `roomId`                      | `data.heartBeatDuration`（秒）和 `data.roomPlaySongInfo`。负责跟随当前曲、进度和待播摘要                                                                  | `/api/listen/together/multi/match/heartbeat`            |
| `multiMatch`        | `songId`                      | `data.success/startMatchTimeMills/maxWaitTimeMills`。进入等待，最终房间来自匹配通知或明确的恢复快照                                                       | `/api/listen/together/multi/match`                      |
| `multiMatchCancel`  | —                             | 取消匹配。清理本次 attempt，晚到的结果不能打开房间                                                                                                        | `/api/listen/together/multi/match/cancel`               |
| `multiRematchLeave` | `roomId`                      | `data.success` 确认离开旧房后才能启动新匹配，退出类型 `CHANGE_ROOM`                                                                                       | `/api/listen/together/multi/match/exit`                 |
| `multiLeave`        | `roomId`                      | 退出类型 NORMAL_END。主动离开跟听房间时先读取完整已播和待播，成功确认退出后切换到衔接好的个人队列                                                         | `/api/listen/together/multi/match/exit`                 |
| `multiQueue`        | `roomId, cursor?`             | `data.songLists[]`、`data.page.{more,cursor}`，每页 20。按 songInfo.bizId 合并，分离当前推荐和待播。data.roomTagList 可补房间标签                         | `/api/listen/together/multi/match/wait/song/list`       |
| `multiPlayed`       | `roomId, cursor?`             | 同一分页结构，每页 20，sort=1，最新在前。「听过的」过滤当前业务 ID；成员推荐统计与离房续播还会读取完整历史                                                | `/api/listen/together/multi/match/played/song/list`     |
| `multiSongInfo`     | `roomId, bizId`               | `data.liked`、`data.songInfo.zanCnt`，补充当前这次推荐的点赞状态                                                                                          | `/api/listen/together/multi/played/song/info`           |
| `multiAdd`          | `roomId, songId`              | 推荐到房间。要求 `data.failedCode === 0`。可用 `data.roomSongInfo` 更新播放，再读取心跳                                                                   | `/api/listen/together/multi/match/song/operate`，操作 1 |
| `multiUp`           | `roomId, songId, bizId`       | 顶待播项，成功刷新队列顺序和计数。`uped` 控制此条目的按钮                                                                                                 | `/api/listen/together/multi/match/song/operate`，操作 2 |
| `multiLike`         | `roomId, songId, bizId`       | 给当前推荐点赞。成功可继续点，已点外观与操作可用性独立。切歌后丢弃旧计数回包                                                                              | `/api/listen/together/multi/match/song/operate`，操作 3 |
| `multiNext`         | `roomId, songId, bizId`       | 用户主动请求切当前曲，要求 `data.failedCode === 0`。可读 `data.roomSongInfo`，再与心跳对齐。拒绝时显示原因                                                | `/api/listen/together/multi/match/song/operate`，操作 4 |
| `multiRedHeart`     | `roomId, songId, bizId`       | 在个人收藏成功且账号、房间、当前推荐仍相同时提交红心活动。要求 `failedCode === 0` 且 `result !== false`                                                   | `/api/listen/together/multi/match/song/operate`，操作 5 |
| `multiRemove`       | `roomId, songId, bizId`       | 删除本人推荐且尚在待播的那一条。后台再次核对真实队列和推荐者。与顶歌、点赞一样，按 `data.result/failedCode` 判断确认                                      | `/api/listen/together/multi/match/song/operate`，操作 7 |

## 房间聊天、私信与表情

| method                 | args                              | body 中读取的数据与作用                                                                                                              | worker 使用的模块或上游路径                                            |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `multiChatHistory`     | `roomId, cursor?`                 | `data.records[]`、`data.page.{more,cursor}`，每页 50。按当前房间和可见 UID 解析为 `ChatPage`                                         | `/api/listen/together/multi/match/msg/history`                         |
| `multiChatSend`        | `roomId, text, emoji?, requestId` | 文本最多 100 个 JS 字符单位，表情附 `ChatEmoji` 和占位文本。worker 查快照取得真实 chatRoomId。提交后再读历史找回显                   | `multiStatus` + `/api/middle/im/chatroom/send`                         |
| `privateConversations` | `offset?`                         | `msgs[].{fromUser,toUser,lastMsg,lastMsgTime,newMsgCount}`、`more`。取与本人通信的另一方为会话，按原始条数推进 offset，每页 30       | `msg_private` → `/api/msg/private/users`                               |
| `privateHistory`       | `uid, before?`                    | `msgs[].{id,fromUser,toUser,time,msg}`，兼容 `body/msgType/msgBody/nativeUrl`，每页 30。下一页用本页最小有效时间戳。解析后按时间正序 | `msg_private_history` → `/api/msg/private/history`                     |
| `privateRead`          | `uid`                             | 只清该对端未读。要求 `code === 200` 且 `data !== false`，由 UI 另行记录已读边界                                                      | `/api/communication/msg/unread/count/clean`                            |
| `privateSend`          | `uid, text, requestId`            | 给一个对端发文本，最多 500 个 JS 字符单位。提交后读历史确认真实消息                                                                  | `login_status` + `send_text` → `/api/msg/private/send`                 |
| `privateInvite`        | `uid, roomId, requestId`          | 后台确认当前账号和房间，用本人 UID 生成邀请，单发给选定对端。收件方可解析为房间邀请卡                                                | `login_status` + `multiStatus` + `send_text` → `/api/msg/private/send` |
| `privateSticker`       | `uid, emoji, requestId`           | 私信中发送 `ChatEmoji`。必须取得 `data.msgBody.msgId` 且消息状态有效，随后合并历史                                                   | `/api/communication/send/msg`                                          |
| `privatePresence`      | `uid`                             | `data.{uid,nickname,avatar,online}`。仅接受明确布尔值，未知为 null。回包中的用户资料须匹配所查 UID                                   | `/api/communication/msg/setting/get`，scene 1                          |
| `follows`              | `uid, offset?`                    | `follow[].{userId,nickname,avatarUrl}`、`more`，每页 30。私信联系人选择器使用本人关注列表                                            | `user_follows` → `/api/user/getfollows/{uid}`                          |
| `stickerGroups`        | `scope`                           | `data.emojiGroups[]`，只展示 `edit === true` 的分组。scope 为 `room` 或 `private`，独立缓存                                          | `/api/social/emoji/groups`，resourceType 分别为 3、2                   |
| `stickerPage`          | `groupId, cursor?`                | `data.emojis[]` 已转换为 `SavedSticker[]`，另有 `data.unavailable`、`data.page.{more,cursor}`，每页 10                               | `/api/social/emoji/groups/detail/page`                                 |
| `stickerCollect`       | `emojiId, emojiGroupId`           | 收藏已知身份的表情。要求 `data.result === true`，更新表情库。普通聊天图片另走 `saveStickerImage`                                     | `/api/social/emoji/collect`                                            |
| `stickerRemove`        | `emojiIds`                        | 传 1–100 个十进制字符串，成功须 `data.result === true`。本地删除标记防止旧分页把已删除项加回                                         | `/api/social/emoji/cancel`                                             |

`requestId` 由发起方为一次逻辑发送生成 UUID。worker 在当前会话对文本、邀请及表情等发送按 ID 与内容去重。接口报错可有 `code`，如登录失效 302、上下文变更 409。房间发言界面区别 405 过频和 407 内容未通过。已尝试提交、随后超时或服务异常可返回 `deliveryUnknown:true`。先查历史归并回显，再让用户决定是否重发。[发送与会话](../../src/main/service.ts) · [房间历史](../../src/shared/chat.ts) · [私信解析](../../src/shared/private-messages.ts)

## 后台还用到的接口

| 用途                     | 依赖或接口                                                                                                                                                                | UI 收到什么                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Mini 的私信与匹配通知    | `/api/middle/im/token/get`，承载两项业务的 Mini 连接                                                                                                                      | 私信通过 `onPrivateNotifications`。匹配从本次 `matchPoll` 取已送达的事件 |
| 房间成员推送             | `/api/middle/im/token-and-chatroom-addr/get`，NIM 的 `lbs.netease.im/lbs/webconf.jsp` 及返回的聊天室地址                                                                  | `onRoomMembers(LtMemberUpdate)`。该事件只承载成员及人数                  |
| 上传文件及封面           | 图片／普通文件走 `/api/nos/token/alloc`，语音／视频走 `/api/nos/token/whalealloc`。worker 向 NOS 上传分片，并在发送前重新核对账号和目标                                   | `onMediaProgress` 的上传／发送阶段，完成后 `MediaReply.receipt`          |
| 投递和保存图片           | 房间图片走 `/api/middle/im/chatroom/send`，私信图片／音视频走 `/api/communication/send/msg`，普通文件走 `send_text` 发送文件链接，自定义表情走 `/api/social/emoji/upload` | 房间或私信时间线得到对应回执。上传至表情库返回 emoji 并刷新库            |
| 远端图片存为表情         | `saveStickerImage` 从允许的网易云图片 CDN 获取字节，再走上传与表情登记                                                                                                    | 返回 `MediaReply`，可供自己或他人的实际聊天图片使用                      |
| 请求校验、音源与程序更新 | 指定写操作在后台经 `register_checktoken_v3` 准备校验。音频从 stream 返回的 URL 读取。桌面更新由 electron-updater 对接项目 GitHub Releases                                 | 播放器观察本机 audio 事件，设置页观察 `UpdateState`                      |

常规曲库路径对应项目锁定的 `@neteasecloudmusicapienhanced/api@4.40.1`。`pnpm dev:docker` 连接本地 `http://127.0.0.1:3000`，其他开发服务由 `MUSIC_PARTY_API_URL` 指定。HTTP 适配器接受 `/song/detail` 等模块路由，UI 调用同一套 method。[worker](../../src/main/worker.ts) · [HTTP 适配器](../../src/main/transport.ts) · [附件发送](../../src/main/media-send.ts) · [通知连接](../../src/main/shared-notifications.ts) · [聊天室接入](../../src/main/lt-chatroom.ts)

# 网易云官方多人协议

## 已确认的范围

用户要求官方多人房间互通；好友使用官方 App；API 内置在桌面安装包。此前 `listentogether_*` 实测创建双人房间，不适用目标。

2026-09-28 根据用户给出的真实分享链接定位官方多人入口：

`https://st.music.163.com/listen-together/multishare/index.html?roomId=…&inviterUid=…&isFLT=false`

分享页脚本：`https://s7.music.126.net/5ecbb275e35ed4f34abe2fb0/multishare/index.b878cbec.js`。

- 普通多人调用 `/api/listen/together/multi/landing/info/get`，参数 `roomId`、`inviterUid`。
- `isFLT=true` 为另一套“跟听”，调用 `/api/follow/listen/room/info/h5`；当前明确拒绝混用。
- 多人深链为 `orpheus://nm/multiListenTogether/joinRoom`，其中 inviter 参数名转为 `inviterId`。
- 预览响应包含 `roomStatus`、`inviter`、`others`、`songData` 等，**不等同于加入成功**。

官方页面通过 `/api/middle/clientcfg/config/pushed/list`，以 `moduleName=listen_together`、`app=music`、`platform=web`、`keys=[multilisten_app_beta_url]` 返回 Android 安装包地址：

`https://nos.netease.com/music-static/91805039-f569-4445-bc67-ee1306f9c998.apk`

该包仅在本地静态检查，没有运行或安装。SHA-256：`f86580bd4e830d8bafe0ca586d5c12d484f0f3adbb1cd0988a4c099e3f3e565d`。它是官方页面配置的体验包，不能假定与用户当前手机版本完全一致；最终仍需实际账号验收。

## 已定位的接口

端点均在 `/api/listen/together/` 下。参数来自 `classes9.dex` 的 `com.netease.cloudmusic.module.listentogether.api.a1.l` 及其调用方。只记录协议事实，不把反编译源码纳入产品。

| 用途      | 后缀                       | 参数与返回重点                                                              |
| --------- | -------------------------- | --------------------------------------------------------------------------- |
| 多人创建  | `multi/room/create`        | `type`、`songId`、`groupIds`、`inviteUids`、`checkToken`                    |
| 多人加入  | `multi/match/ack`          | `roomId`、`agree=true`、`inviterUid`、`checkToken`                          |
| 当前房间  | `multi/match/status/get`   | 无参数；返回 `status`、`multiLtRoomSnapshot`                                |
| 心跳      | `multi/match/heartbeat`    | `roomId`；返回 `roomPlaySongInfo`、`heartBeatDuration` 等；488 表示房间失效 |
| 推歌/切歌 | `multi/match/song/operate` | `roomId`、`songId`、`bizId`、`operate`、`checkToken`                        |
| 离开      | `multi/match/exit`         | `roomId`、`exitType=NORMAL_END`                                             |
| 多人邀请  | `multi/invite`             | `roomId`、`groupIds`、`inviteUids`；尚未接入发送                            |

创建类型：调用方 `invite.dialog.j` 以 `allowStrangerMatch ? 2 : 1` 选择。Music Party 使用 `type=1`，且要求有效的非零初始歌曲 ID（用户实测 `songId=0` 会返回 `MULTI_SONG_NOT_SATISFIED`）。自动邀请列表始终为空；只复制链接，不自动发送私信或邀请。

歌曲操作枚举：JOIN=0、ADD=1、UP=2、LIKE=3、SWITCH=4、REDHEART=5。本轮仅接入 ADD（`bizId=0`）与 SWITCH（使用当前歌曲的真实 `songBizId`）。推歌不等于立即强制切歌。

歌曲操作业务成功码为 `data.failedCode=0`；HTTP/code=200 但 `failedCode=10000` 等仍属于失败。创建、加入、离开要求 `data.success=true`。加入响应中的房间 ID 必须与邀请一致。

请求校验令牌通过现有上游 `register_checktoken_v3` 获取并留在服务侧。用户已实测加入、推歌和切歌可用；创建请求仍待真实验证；缺失、业务拒绝或风控时应显示错误，不冒充成功。

## 快照与同步

`multiLtRoomSnapshot`：

- `roomId`
- `roomPlaySongInfo`：`playSong`、`nextSongs`、`version`、`playedTime`、`songDuration`、`forceSync`、`waitSongCount`
- 歌曲条目：`songId`、`songBizId`、`songRcmdUid`
- **实际 JSON 字段 `multiLtRoomUserAgg`**：`onlineNums`、`onlineUserInfos`（uid/nickname/avatar）；Android 属性名为 `roomUserList`，两者通过注解映射，不能混用。
- **实际 JSON 字段 `multiRoomInfoDTO`**：包含 `chatRoomId`、`roomType` 等；Android 属性名为 `roomInfo`。

`classes10.dex` 中 `module.n0.y` 的官方播放器逻辑明确将 `heartBeatDuration * 1000` 用于定时，因此**心跳间隔单位为秒**。`playedTime` 直接传给毫秒播放进度接口，因此进度与歌曲时长单位为毫秒。

官方还有云信 IM 消息推送；本轮先实现其心跳快照通路。桌面按版本与采样时间拒绝过期响应，估算请求中点时刻，歌曲加载完成后再对齐进度。加载过程中切歌或离开，旧异步结果不能重新启动播放。音量和暂停仅在本机生效；恢复时跟随房间。多人不发送双人 PLAY/PAUSE/seek 指令。

## 当前证据强度

- 真实官方多人分享预览已读到有效响应，内置请求和 Docker `/api` 均可使用该协议路径。
- 成员列表、加入、推歌、远端换歌、退出已通过模拟协议的 Electron 流程测试。
- 用户已实测恢复房间、邀请链接加入、音乐同步、推歌和请求下一首可用。创建房间、明确三账号人数、完整权限与 IM 推送仍待验收。

## 房间文字聊天（0.4.0）

官方客户端 `listentogether.chat.send.a` 与 `listentogether.api.e` 明确使用 HTTP 发送接口：

- `/api/middle/im/chatroom/send`
- `chatroomId`：来自当前账号多人快照 `multiRoomInfoDTO.chatRoomId`，与外部一起听 roomId 不同。
- `msgType=0`
- `clientExt`：JSON 文本，包含 `bizType=listenTogether`、`ltType=MULTI_MATCH_SONG`、`roomId`。
- `msgBody`：JSON 文本，包含 `msg`（文字）、`msgType=0`。

历史来自 `/api/listen/together/multi/match/msg/history`。参数为 `roomId`、`direction=0`、`page`（JSON 文本，size 与可选 cursor）。官方初始与向前翻页都使用 direction=0。响应 `data.records` 与 `data.page`（more/cursor/size）。消息字段包含 sendUid/sendTime/nickname/avatarUrl/msgType/imChatRoomMsgBody；文字位于 imChatRoomMsgBody.text。官方按 sendUid + sendTime 去重；实现同样使用该组合，同时过滤不属于本房间或 onlyCanSeeUserIds 不包含当前账号的记录。

原始 App 输入限制：双人 20、多人 100；此次只实现多人文字。407 表示服务端内容拒绝，405 表示发送频率限制。发送按用户操作触发，失败保留草稿，超时不会自动重发；服务侧只在进程内对相同 requestId 去重，不声称上游提供全局幂等保证。

当前收信依赖历史接口定时刷新，真实跨端聊天收发仍待用户验收。自动测试只向本地模拟服务发送文本，未给任何真实房间发送测试消息。

## 原生私信邀请卡片（0.5.1）

用户反馈手机分享后仅看到“我们一起听歌吧！分享你喜欢的歌给大家，一起玩转多人一起听～”。现有解析器只支持直接暴露的 URL，未覆盖官方卡片的包装跳转。

静态证据：`CommonMessage.fromJson` 从 JSON 的 `nativeUrl` 读取跳转；`module.s0.a` 从该 URI 的查询参数读取 `url1`（原生目标）和 `url2`（网页后备），原生目标可用则优先执行。新版 `music.biz.chat.meta.ResCardMsg` 同样读取 `nativeUrl`，`MsgBody` 还可以把卡片装在 JSON 字符串 `body` 中。

独立实现递归解析这些编码目标和 WebView 的 `url`，仅保留严格验证过的官方多人分享路由或已核实的 multiListenTogether/joinRoom 深链，绝不执行 URI 或访问外层地址。兼容官方 HTTP 分享地址后规范为 HTTPS；拒绝非官方网站、双人、跟听、无有效房间参数和非法编码。对消息结构遍历、URL 解码层数与扫描量设上限。私信历史只额外检查消息 body/msgBody/nativeUrl，不扫描发送者昵称或头像等资料字段。

依据官方模型构造的私信卡片回归已通过；用户当前手机版本发出的具体原始数据尚未直接取得，因此真实那条私信仍待用户确认，不把仅有说明文字的消息自动推断成有效房间。

## 私信已读（0.9.0）

官方体验包 `classes8.dex` 的 messagecenter.api.c.a(Long) 及 MessageCenterDetailFragment 调用确认：`/api/communication/msg/unread/count/clean` 接收 `userId`，用于清除指定会话未读。客户端只在当前会话可见、窗口获焦且最新历史加载成功时提交单个 UID；不发送空 userId 来清除全部会话。此接口经内置 API 的固定受限通用调用执行，前端不能指定 URI 或目标列表。响应失败不清除角标，支持重试。

## 完整待播列表（0.10.0）

原生客户端 b0.t0(roomId) 打开的组件为 `rn-tt-playlist`。通过官方 `rncache/resinfo/get`（moduleName=rn-tt-playlist，sdkVersion=0.60）取得公开 bundle 元数据：version=1677825891305，fullMd5=bd3635b6b23e79815ea33822af2ccff1。只做静态字段核实，不把下载物纳入产品。

该组件使用 `/api/listen/together/multi/match/wait/song/list`，参数 `roomId`、`page=JSON.stringify({size:20,cursor:""})`；下一页沿用 data.page.cursor 和 more。条目在 data.songLists，内含 songInfo.resourceId / bizId / title / artistName / coverUrl，以及 rcmdUid / nickname。首段可能包含当前播放条目，使用业务 ID 匹配后排除；不能用歌曲 ID 去掉所有重复歌曲。心跳 nextSongs 只是近期预览。

## 消息类型与表情（0.10.0）

LTMultiMatchRoomMsgInfo 定义 msgType=0 普通消息、1 互动、2 推歌、3 通用通知；普通消息附带 emoji 时为图片/表情。LTMultiEmojiInfo 提供 emojiId、emojiGroupId、emojiName、emojiImgUrl、width、height、format；LTMultiMsgBody 提供 text、mainStateText、msgRichText.contentTextList（text / highLighted / orpheus）。resourceInfo 包含资源 ID、标题、封面及歌手。

官方聊天发送器对图片/表情仍使用 msgType=0，把 EmojiItem 放入 clientExt.emoji，msgBody.msg 使用名称占位。新增发送只选择已收到的表情，继续校验账号当前房间并解析真实 chatroomId，不接受前端指定聊天室。文字及媒体信息继续从诊断中脱敏。互动、推歌通知由对应官方行为产生，不伪造通知。

私信兼容原有 msg JSON 与新版 msgType/body：图片 1、资源卡片 2、语音 4、视频 5、音乐资源 30–48、文件 49；旧 msg.type 与新版 msgType 的值不混用。只有实际提供的 HTTPS 媒体地址可播放，应用不猜测缺失的媒体地址、不执行 HTML 或任意 orpheus 深链。

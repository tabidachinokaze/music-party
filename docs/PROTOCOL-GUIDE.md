# 私信、匹配与图片表情适配

本轮依据 [网易云私信与多人一起听 skill](https://github.com/tabidachinokaze/folium-mod-music-party/blob/b01525f/skills/netease-messaging-and-multiplayer/SKILL.md) 补齐独立客户端功能。该参考整理于 2026-10-07，官方 Android 静态证据主要来自 8.8.40；服务端兼容性仍需本项目的真实账号验收。

## 实时私信与已读

`/api/middle/im/token/get` 使用 `{bizTag:"platform"}` 获取凭据，仅留在 API utility process。Mini 使用音乐专用 TCP 通道；匹配与后台私信共享连接。Cookie、IM token、原始压缩消息不进入 renderer 或诊断。

`music_communication_realtime_msg_notice` 的 GZIP 正文经过限额解析、scene/账号过滤与业务 ID 去重，转为有界通知队列。worker 直接把安全批次经 IPC 推给 renderer；游标读取只用于初次加载与唤醒补偿。包装 delivery ID 为 0 或负数时不去重，也不以此阻断连续消息。

播放页后台接收不轮询官方私信列表。打开私信页或通知对话时读取 HTTP 历史；可见且获焦时每 10 秒补偿，推送、重连或网络恢复会触发提前刷新。请求途中收到推送会在旧请求完成后补刷，避免丢失刷新意图。相同数据不重建消息列表。

通知不会提交已读。只有打开的可见、有焦点会话成功取得历史后，才请求 `/api/communication/msg/unread/count/clean`。边界同时记录时间和同一毫秒的真实消息 ID；旧已读请求不会清掉后来到达的未加载消息。发送超时仍保持未知状态，不自动重发。

## 在线查询

固定 EAPI `/api/communication/msg/setting/get`，参数 `{userId,scene:1}`。仅 `data.online` 的明确布尔值作为已知状态，失败或缺失是未知，不能沿用旧的在线点，也不用 `liveOnline` 替代。

缓存按账号隔离：45 秒有效期、两个并发、失败后 30 秒退避，覆盖已加载会话、关注联系人和当前对端。私信列表在线优先，同组按最新消息排序。该功能查询联系人在线状态，**没有验证或实现本客户端自身在线上报**；Mini 登录成功不等于证明桌面用户在官方 App 上显示在线。

## 官方多人

创建、匹配与重新匹配使用独立选定的匹配用歌；正在播放的歌曲只提供首次默认值，不会覆盖已选歌曲。创建使用 `type=1`（私密好友房）或 `type=2`（公开好友房）。房间类型按快照 `roomBizType` 展示，未知值保留未知。

匹配先准备共享 Mini 订阅，再调用 `/api/listen/together/multi/match`。处理提前到达的通知，按服务端开始时间过滤旧通知；匹配成功通知经过 `/multi/match/ack` 确认后才进入房间。取消使迟到结果失效；匹配等待与 ACK 采用独立超时。状态查询仅恢复明确的 `RECONNECT_SUCCESS`，不代替通知确认。

重新匹配先以 `CHANGE_ROOM` 退出当前房间，再沿用匹配用歌。恢复卡片来自登录后的实际状态查询。房间播放、成员与聊天仍使用原有心跳/历史补偿，没有声称已接入全部房间 IM 推送。

新增个人喜欢成功后，若仍是同一账号、房间和当前 `songBizId`，提交操作 5（REDHEART）。房间动态来自官方聊天记录；失败不撤销个人收藏，也不伪造活动。操作 3（LIKE）可重复点击，不与个人红心混同。

## 图片与表情

自己和他人的实际图片均可保存到表情库；有有效官方表情身份则用 `/api/social/emoji/collect`，普通图片重新下载、上传并注册。歌曲/专辑封面不被当成可收藏聊天图片。

CDN `Content-Type: image/jpg` 不代表真实格式：按 PNG/JPEG/GIF/WebP 字节签名确定类型，再用于 NOS 上传。下载只允许已验证的官方 HTTPS 图片地址，每次重定向重新检查，不携带账号 Cookie；限额、尺寸、超时和账号变化均校验。

Ctrl+V 与文件选择共享发送前预览。收藏/上传与发消息是独立动作。表情库按需分页，确认删除后只移除目标项；本地 revision 阻止旧分页把已删除项加回，刷新合并新增前缀，保留已有分页、游标与滚动锚点。删除的大整数 ID 使用精确 JSON 数字 token，不经 `Number`。

## 继续验证

自动验证使用模拟响应与真实 Electron，不发送真实消息或改变真实房间。实测时分别核验：连续两条私信、后台收信/回复/已读、隐私允许下的联系人在线变化、不同匹配歌曲与当前歌曲、取消后迟到通知、房间红心活动、图片四格式及表情增删。不能把旧插件的实测直接写成本项目的实测。

研究文件和 APK 继续保留在被忽略的 `.local/research/`。诊断不记录 Cookie、token、媒体 URL、压缩正文或聊天内容。相关源码入口是 `src/main/shared-notifications.ts`、`private-presence.ts`、`service.ts`、`src/renderer/src/usePrivateMessages.ts`、`room-match.ts` 和 `useCloudStickers.ts`。

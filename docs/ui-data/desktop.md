# 桌面桥接与事件

`window.together` 由 preload 提供。下面列出全部 34 个成员，包含通用业务入口和 9 个事件订阅。普通调用返回 Promise，订阅立即返回取消函数，供组件或会话清理时调用。通常由对应 hook 集中订阅，页面读取 hook 的结果。[Bridge 声明](../../src/shared/types.ts) · [preload 对照](../../src/preload/index.ts) · [主进程处理](../../src/main/index.ts)

## 账号、业务与诊断

| 成员              | IPC 通道            | 入参 → 结果                                                                    | 使用场景                                                           |
| ----------------- | ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `call`            | `api`               | `Request{method,args?} → Reply{ok,data?,error?,code?,deliveryUnknown?,trace?}` | 曲库、房间、私信和表情。具体方法与回包形状见[业务接口](api.md)     |
| `sessionInfo`     | `session-info`      | 无 → `{persistent:boolean,reason:string,version:string}`                       | 设置页展示登录态是否可持久化及原因，关于页显示当前构建版本         |
| `onTrace`         | `trace`             | 订阅 `Trace{id,time,method,duration,ok,request,response}`                      | 时间为 ISO 字符串，耗时为毫秒，渲染端保留最近 300 条               |
| `exportTrace`     | `export-trace`      | 无 → boolean                                                                   | 弹出系统保存框，成功写入返回 true，用户取消返回 false              |
| `copy`            | `copy`              | `text:string → void`                                                           | 复制如房间邀请的文本，主进程仅写入长度小于 10000 的字符串          |
| `openProject`     | `project-open`      | `repository / issues / releases → void`                                        | 打开项目、反馈或发布页                                             |
| `openMessageLink` | `message-link-open` | `url:string → void`                                                            | 允许的网易云资源或文件链接交系统打开。歌曲及专辑先经应用内资源解析 |

## 房间、匹配与私信事件

| 成员                     | IPC 通道                        | 入参 → 结果                                                 | 使用场景                                                                                             |
| ------------------------ | ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `matchOpen`              | `match-open`                    | `id:string → void`                                          | 用本次尝试的 UUID 准备 Mini 通知订阅，之后才请求 `multiMatch`                                        |
| `matchPoll`              | `match-poll`                    | `id:string → MiniNotice[]`                                  | 从本地队列取 `{timestamp,notice}`。notice 为 `{kind:'ready',roomId}` 或 `{kind:'failed',reason}`     |
| `matchClose`             | `match-close`                   | `id?:string → void`                                         | 释放该次匹配订阅。业务取消另用 `multiMatchCancel`，私信仍可共享 Mini                                 |
| `joinImChatroom`         | `join-im-chatroom`              | `chatroomId:string → void`                                  | 使用快照的 `chatRoomId` 启动 NIM 成员订阅。Promise 完成表示已交给 worker，成功收件以事件为准         |
| `leaveImChatroom`        | `leave-im-chatroom`             | 无 → void                                                   | 解除本机 IM 订阅。退出业务房间由 `multiLeave` 完成                                                   |
| `onRoomMembers`          | `room-members`                  | 订阅 `LtMemberUpdate{roomId,version,onlineCount,members[]}` | 30005 成员快照。仅在当前房间消费，有 roomId 时校验房间，丢弃较低成员版本。人数与已知成员条数可以不同 |
| `privateNotifications`   | `private-notifications`（调用） | `cursor?:number, session?:string → AccountNotifications`    | 启动或唤醒时从 worker 的账号事件缓冲补读。提供上次的 cursor 和 session                               |
| `onPrivateNotifications` | `private-notifications`（事件） | 订阅与上行相同的 `AccountNotifications`                     | 常驻接收后台消息，更新会话摘要、角标及气泡。会话打开时按需刷新 HTTP 历史                             |

`AccountNotifications` 包含 `accountUid, session, cursor, connected, reset, events`。`session` 标识通知会话代次，`connected` 是本机的通知连接状态。每个事件有递增的 `sequence` 和一个 `notice`。按账号过滤，换 session 清旧游标，按 notice.id 去重。reset 表示旧代次或错过缓存，当前可见视图重新取列表和历史。[通知类型](../../src/shared/private-notices.ts) · [消费端](../../src/renderer/src/usePrivateMessages.ts)

| notice.kind | 携带数据                                                                                   | 对界面的影响                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `message`   | `id,peerUid,senderUid,senderName?,senderAvatar?,messageId,timestamp,messageType,text,self` | 为目标会话生成预览、区分自己发出的消息、合并未读。notificationInbox 按对端合并，最多保留 8 个，toast 展示前 3 个。点其中一项打开该会话的快捷回复 |
| `change`    | 与 message 相同的类型结构                                                                  | 可见时刷新会话，对应对端正打开时刷新历史                                                                                                         |
| `sync`      | `id,timestamp`                                                                             | 连接恢复等同步信号，可见时补取数据                                                                                                               |

## 附件、录音与图片收藏

| 成员                | IPC 通道             | 入参 → 结果                                                      | 使用场景                                                                           |
| ------------------- | -------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `sendMedia`         | `media-send`         | `MediaRequest{requestId,target,file} → MediaReply`               | 文件选择、粘贴、录音、上传自定义表情。每次绑定固定账号和目标                       |
| `saveStickerImage`  | `sticker-image`      | `{requestId,image:{kind:'image',url,width,height}} → MediaReply` | 将普通聊天图片保存到自定义表情。已有官方表情身份时直接调 `stickerCollect`          |
| `cancelMedia`       | `media-cancel`       | `requestId:string → void`                                        | 向后台取消指定请求。进入发送阶段后的未确认结果要保留核对入口                       |
| `onMediaProgress`   | `media-progress`     | 订阅 `{requestId,phase,percent}`                                 | phase 为 `uploading` 或 `sending`，percent 为 0–100，按 requestId 找到发起它的草稿 |
| `requestMicrophone` | `microphone-request` | 无 → void                                                        | 用户开始录音时申请权限，渲染端再使用设备录制，形成 WAV 草稿                        |

`MediaTarget` 的三种形状为 `{kind:'room',roomId}`、`{kind:'private',uid}`、`{kind:'sticker'}`。`MediaFile` 有 `name,mime,kind,data:Uint8Array`。图片／视频提供像素宽高，录音／视频提供毫秒时长，视频可附 JPEG 封面字节。图片和语音上限 20 MiB，视频和普通文件上限 100 MiB。房间和自定义表情上传仅收图片。私信另支持 WAV 语音、MP4 视频和普通文件链接。[附件定义与校验](../../src/shared/media.ts)

`MediaReply` 为 `{ok,receipt?,error?,deliveryUnknown?,code?}`。`receipt` 带 `requestId,senderUid,time,text,attachments[],emoji?,messageId?`。应用将它交回原目标，由时间线与历史合并。主进程同一时刻只处理一个附件发送或图片收藏。文件草稿按账号和目标保存在内存，切换页面可找回，换号会清理。[媒体草稿](../../src/renderer/src/media-drafts.ts) · [发送与回执](../../src/main/media-send.ts) · [录音](../../src/renderer/src/recording.ts)

## 播放器、外观与系统

| 成员                      | IPC 通道                  | 入参 → 结果                                                               | 使用场景                                                                                                      |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `desktopInfo`             | `desktop-info`（调用）    | 无 → `DesktopInfo`                                                        | 启动读偏好、实际主题、平台和窗口状态                                                                          |
| `onDesktopInfo`           | `desktop-info`（事件）    | 订阅 `DesktopInfo`                                                        | 跟踪系统主题和窗口更改，按 fullScreenRevision 忽略过时的全屏状态                                              |
| `windowAction`            | `window-action`           | `'minimize' / 'toggle-maximize' / 'close' → void`                         | 自定义标题栏的最小化、最大化／还原和关闭                                                                      |
| `onNavigate`              | `navigate`                | 订阅 `'back' / 'forward'`                                                 | 原生前进、返回事件交给应用导航历史，渲染端同时处理鼠标侧键并去重                                              |
| `setFullScreen`           | `desktop-fullscreen`      | `boolean / 'toggle' → DesktopInfo`                                        | 控制原生窗口全屏。播放页展开是独立的渲染状态                                                                  |
| `updatePreferences`       | `desktop-settings`        | `Partial<Preferences> → DesktopInfo`                                      | 保存修改后的偏好，失败时可恢复当前显示值。playerBackground 要传完整对象                                       |
| `preparePlayerBackground` | `player-background-image` | `bytes:Uint8Array → {image,width,height}`                                 | 将本地选择的背景规范化为可保存 PNG，仅准备图片。用户保存时再提交偏好                                          |
| `updateMedia`             | `desktop-media`           | `DesktopMediaState → void`                                                | 将歌曲标题、歌手、播放状态、可用动作和房间 ID 送往托盘／系统控制                                              |
| `onPlayerCommand`         | `desktop-command`         | 订阅 `toggle / play / pause / next / previous / settings / lyrics / show` | 外部桌面命令复用现有播放和导航行为，结合跟听、试听模式决定可用动作                                            |
| `onLifecycle`             | `lifecycle`               | 订阅 `suspend / resume`                                                   | 系统挂起时停止旧房间同步，恢复时确认房间并补取私信事件。浏览器另提供 online/offline                           |
| `quit`                    | `desktop-quit`            | 无 → void                                                                 | 显式退出应用；窗口关闭时按 closeToTray 与托盘可用性处理。退出应用或安装更新会释放本机连接，保留服务端房间关系 |

`DesktopInfo` 包含 `preferences,trayAvailable,maximized,fullScreen,fullScreenRevision,resolvedTheme,platform,persistenceError`。`DesktopMediaState` 包含 `title,artist,playing,canToggle,canNext,canPrevious,roomId`，其中 roomId 可以为 null。[桌面类型与校验](../../src/shared/desktop.ts) · [状态与系统命令](../../src/renderer/src/useDesktop.ts)

渲染层还把 `current.name/artist/album/cover`、播放状态和秒级进度投给浏览器的 `navigator.mediaSession`。系统媒体键的播放、暂停、上一首和下一首复用与页面相同的控制。seek 仅在个人或试听时启用。把播放按钮移到别处时，仍要保留这一处系统绑定和共用的 audio 元素。[Media Session 接入](../../src/renderer/src/useDesktop.ts)

| Preferences 字段           | 默认值和范围                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `closeToTray`、`theme`     | closeToTray 默认 true。theme 默认 light，可选 light、dark、system。实际绘制使用 resolvedTheme                                                                                     |
| `language`、`mediaKeys`    | 界面与桌面菜单语言默认为 zh-CN，可选 en。系统媒体快捷键默认为 true                                                                                                                |
| `volume`、`repeatMode`     | 0.6，范围 0–1。默认 order，也支持 loop、single                                                                                                                                    |
| `fontScale`、`accentColor` | fontScale 为整套界面显示比例，默认 100，范围为整数 80–150%。accentColor 默认 null，亦接受 `#rrggbb`                                                                               |
| `playerBackground`         | `{image:null,zoom:100,opacity:48,layoutTransparency:100,componentTransparency:16,popupTransparency:12,blur:0,x:50,y:50}`。zoom 为 100–300%，blur 为 0–30 px，焦点 x/y 各为 0–100% |

背景的 `opacity` 存的是图片本身的不透明度，界面上的「图片透明度」显示 `100 - opacity`。布局、组件、弹窗的 Transparency 字段都直接代表透明度，0% 为完全不透明，100% 为全透明。壁纸铺设于整个窗口底层。默认 image 为 null，使用主题底色。导入 PNG、JPEG、GIF 或 WebP 时，输入限 20 MiB，转为最长边 2048 像素、最大 2 MiB 的静态 PNG data URL。[背景导入](../../src/renderer/src/background-import.ts) · [整窗背景](../../src/renderer/src/PlayerBackground.tsx)

## 应用更新

| 成员           | IPC 通道               | 入参 → 结果                                | 使用场景                           |
| -------------- | ---------------------- | ------------------------------------------ | ---------------------------------- |
| `updateState`  | `update-state`         | 无 → `UpdateState`                         | 打开设置或启动时读当前状态         |
| `updateAction` | `update-action`        | `check / download / install → UpdateState` | 用户检查、下载、安装对应版本       |
| `onUpdate`     | `update-state-changed` | 订阅 `UpdateState`                         | 更新提示、下载进度、版本说明和错误 |

`UpdateState` 的必需字段是 `phase,currentVersion,message`。可选字段为 `version,releaseNotes,percent,transferred,total`。支持更新的安装环境按 `idle → checking → current` 或 `available → downloading → downloaded → installing` 呈现。另有 `unsupported`、`error`。开发版、非 AppImage 的 Linux 环境及未支持平台有自己的状态说明。[更新模型](../../src/shared/updates.ts) · [更新界面](../../src/renderer/src/Updates.tsx)

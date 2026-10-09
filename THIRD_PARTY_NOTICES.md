# 第三方代码来源

以下文件移植自 [folium-mod-music-party](https://github.com/tabidachinokaze/folium-mod-music-party/tree/b01525f)，由 tabidachinokaze 维护，保留 `AGPL-3.0-only` 许可和文件内的来源说明：

- `src/main/mini-codec.ts`
- `src/main/mini-notifications.ts`
- `src/main/private-notice.ts`
- `src/main/shared-notifications.ts`
- `src/shared/match-notice.ts`
- `src/shared/private-notices.ts`
- `src/shared/room-activity.ts`
- `src/shared/room-activity-presentation.ts`
- `src/shared/private-history-gaps.ts`
- `src/renderer/src/ChatComposer.tsx`
- `src/renderer/src/composer-submit.ts`
- `src/renderer/src/composer-text.ts`
- `src/renderer/src/chat-composer.css`
- `src/renderer/src/member-recommendations.ts`
- 对应的 Mini、私信通知、共享连接、房间动态与输入框测试。

完整许可文本随应用分发，见 [licenses/folium-mod-music-party-AGPL-3.0.txt](licenses/folium-mod-music-party-AGPL-3.0.txt)。移植时去除了插件宿主类型，增加 Electron 事件订阅接口；没有包含官方 APK、反编译源码、账号凭据或私信原文。

房间动态展示的两个模块保留插件对活动类型、完整用户名和歌曲名的解析方式，由本项目的 React 组件渲染为纯文字动态行。

其他新增功能依据协议说明和本项目已有实现编写；上述声明保留移植模块的来源，不为本项目其余文件另行指定许可证。各 npm 依赖保留其自身许可证。

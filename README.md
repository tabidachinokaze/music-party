# Music Party

兼容网易云音乐「多人一起听」的桌面播放器。你可以在电脑上和使用网易云音乐手机 App 的好友一起听歌、推歌、聊天或收发私信。

[下载正式版 0.13.0（Windows x64 / Linux x64）](https://github.com/tabidachinokaze/music-party/releases/tag/v0.13.0) · [反馈问题](https://github.com/tabidachinokaze/music-party/issues)

## 第一次一起听

1. 用网易云音乐 App 扫码登录桌面端，打开「一起听」。
2. 粘贴好友的多人邀请链接加入房间，或选一首歌创建房间并分享链接。账号已在房间时可点「恢复当前房间」。
3. 推送的歌曲会进入共同的待播队列。在桌面暂停只影响本机。

## 开发

单窗口界面在 `redesign/adaptive-player` 分支开发。[开发版使用说明](docs/ADAPTIVE-PLAYER.md) · [界面规范](docs/UI-GUIDELINES.md)

使用 Node.js 24 和 pnpm 11.26.0，在仓库根目录启动开发版。

```sh
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm dev
```

运行 `pnpm run check` 检查类型、单元测试、格式和构建。[接口与数据](docs/ui-data/README.md) · [验证记录](docs/VALIDATION.md) · [打包与发布](docs/RELEASING.md) · [第三方许可](THIRD_PARTY_NOTICES.md)

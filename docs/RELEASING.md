# 打包与发布

## 本地打包

安装依赖后运行 `pnpm run pack` 生成可执行目录，或在 Linux 上运行 `pnpm run dist:linux` 生成 AppImage，在 Windows 上运行 `pnpm run dist:win` 生成 NSIS 安装包。文件写入 `dist/`。

升级 API 依赖时需复核 [NMTID 补丁](../patches/ncm-api-4.40.1.patch)。它基于上游提交 `a8c781fd64faab17fedfd46e0615a2609307f163`，当前适用于 `@neteasecloudmusicapienhanced/api@4.40.1`。

## 发布正式版

1. 更新 `package.json` 的 `x.y.z` 版本号和[发布说明](RELEASE-NOTES.md)。运行 `pnpm install --frozen-lockfile`、`pnpm run check` 和 `pnpm test:desktop`。
2. 将发布提交推送到 `main`，确认 CI 通过。从该提交创建并推送版本标签。

```sh
version=$(node -p "require('./package.json').version")
git tag -a "v$version" -m "Music Party v$version"
git push origin "v$version"
```

[发布工作流](../.github/workflows/release.yml)分别构建 Linux 和 Windows 产物。两边成功后才发布安装包、blockmap 和 `latest*.yml`，并将版本标记为 latest。后续修订另发新版本。

## 应用内更新

- 从 0.7.0 起，客户端在启动 30 秒后及之后每 6 小时检查 [GitHub Releases](https://github.com/tabidachinokaze/music-party/releases)，也可在设置页手动检查。用户选择下载、确认安装后重启。更早版本需先手动安装一次。
- Windows NSIS 安装包目前未签名。Linux 原位更新要求从可写目录启动 AppImage；解包或开发环境使用发布页手动更新。macOS 应用内安装尚未开放。更新包由 `electron-updater` 按清单校验 SHA-512。
- 安装时按当前运行版本处理房间。从 0.13.0 安装更新会尝试退房，最多等 3 秒。从 0.13.1 安装后续更新会保留房间记录，同一账号重启后由官方状态确认能否接回。[单窗口播放器使用说明](ADAPTIVE-PLAYER.md#一起听)

# 发布与应用内更新

更新源固定为 [tabidachinokaze/music-party 的 GitHub Releases](https://github.com/tabidachinokaze/music-party/releases)。客户端不需要 GitHub 账号或 token；仓库和下载资产需要保持公开。

## 更新体验

从 0.7.0 起，Linux AppImage 与 Windows NSIS 安装版通过 `electron-updater` 更新。启动 30 秒后及每 6 小时检查一次，也可在设置页手动检查。发现版本时设置入口出现“更新”标记，用户选择下载，再确认安装并重启。关闭应用不会自动安装已下载的更新。

安装先有限等待退出多人房间，再交给平台安装器。下载和完整性检查由 electron-updater 处理（GitHub HTTPS + manifest SHA-512）；当前 Windows 安装包没有签名证书，尚未配置发布者签名。macOS 自动安装需要额外签名配置，本轮关闭该平台的应用内安装入口。

Linux 必须直接启动可写目录中的 AppImage；解包运行、开发模式不能原位更新，设置页提供手动发布页入口。建议把文件放在 `~/Applications` 等自己的可写目录中。0.6.x 等旧版本没有更新器，需要手动安装一次 0.7.0。

## 发布新版本

1. 更新 `package.json` 中的版本号，例如 `0.13.0`，并更新 `docs/RELEASE-NOTES.md`。正式版采用普通 `x.y.z` 版本号，GitHub Release 不勾选 Pre-release，客户端只消费 latest 通道。
2. 执行 `pnpm install --frozen-lockfile`、`pnpm run check`，并在有显示服务的环境运行 `pnpm test:desktop`。
3. 提交到 main，确认 CI 通过。
4. 创建与版本完全匹配的标签，再推送：

```sh
git tag -a v0.13.0 -m 'Music Party v0.13.0'
git push origin main
git push origin v0.13.0
```

`Release` workflow 在 Linux 和 Windows runner 上独立构建。两边都通过后，才一次性创建 Release 并上传 AppImage、NSIS 安装器、blockmap 与 `latest*.yml`，最后标记为 latest。不要手工编辑 manifest 中的文件名/摘要，也不要只上传安装包而遗漏 manifest。

发布工作流使用仓库提供的临时 `GITHUB_TOKEN`；无需把个人 token 写进客户端或代码。workflow 的发布 job 需要 `contents: write`，构建 job 只有读取权限。标签必须对应稳定版 package.version；不覆盖已经发布的同名版本。

## 独立构建

依赖固定为 npm `@neteasecloudmusicapienhanced/api@4.40.1`。`patches/ncm-api-4.40.1.patch` 保留本项目已验证的上游 NMTID 会话标识修复，来自此前测试的上游提交 `a8c781fd64faab17fedfd46e0615a2609307f163`。升级 API 版本时需要重新审核该补丁。

```sh
pnpm install --frozen-lockfile
pnpm run dist:linux
# 在 Windows 环境：
pnpm run dist:win
```

本地打包设置 `--publish never`，不会上传安装包；只有推送版本标签触发发布。生成文件位于 dist，源代码仓库不存放安装包、账号数据或协议研究下载物。

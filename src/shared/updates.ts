import { ui } from './ui-language'
export const PROJECT_URL = 'https://github.com/tabidachinokaze/music-party'
export const PROJECT_LINKS = {
  repository: PROJECT_URL,
  releases: `${PROJECT_URL}/releases`,
  issues: `${PROJECT_URL}/issues`,
} as const
export type ProjectLink = keyof typeof PROJECT_LINKS
export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  version?: string
  releaseNotes?: string
  percent?: number
  transferred?: number
  total?: number
  message: string
}
// Status messages cross IPC and outlive the language selection. Resolve them at display time.
const englishUpdateMessages = new Map<string, string>([
  [
    '开发模式不执行安装更新，请使用发布的安装包。',
    'Updates are available in release builds. Install the packaged app to update.',
  ],
  [
    'Linux 应用内更新需要直接运行 AppImage；解包目录请从发布页下载新版。',
    'To update on Linux, run the AppImage directly or download a new build from GitHub releases.',
  ],
  [
    '此平台暂不支持应用内安装更新，请从 GitHub 发布页下载。',
    'Download updates for this platform from GitHub releases.',
  ],
  [
    '可手动检查新版本；发现更新后由你决定下载和安装。',
    'Check for a new version, then choose when to download and install it.',
  ],
  ['发现新版本，可以下载更新。', 'A new version is available to download.'],
  ['当前已是最新发布版本。', 'You’re up to date.'],
  [
    '正在下载更新，下载完成后可选择安装并重启。',
    'Downloading the update. You can choose when to install it and restart.',
  ],
  [
    '更新已下载并通过校验，点击安装后将重启播放器。',
    'The update is ready. Install it to restart the player.',
  ],
  [
    '暂时没有可用的更新发布，可稍后重试或打开 GitHub 发布页。',
    'No release is available. Try again later or visit GitHub releases.',
  ],
  [
    '更新失败，请检查网络或安装文件的写入权限后重试，也可从 GitHub 发布页手动下载。',
    'The update failed. Check your connection and file permissions, or download it from GitHub releases.',
  ],
  ['正在检查 GitHub Releases…', 'Checking GitHub releases…'],
  ['准备下载更新…', 'Preparing to download…'],
  ['正在安装更新并重启播放器…', 'Installing the update and restarting the player…'],
])
export function localizedUpdateMessage(message: string): string {
  return ui(message, englishUpdateMessages.get(message) ?? message)
}

export function updateSupport(
  packaged: boolean,
  platform: string,
  appImage?: string,
): string | null {
  if (!packaged) return '开发模式不执行安装更新，请使用发布的安装包。'
  if (platform === 'linux' && !appImage)
    return 'Linux 应用内更新需要直接运行 AppImage；解包目录请从发布页下载新版。'
  if (platform !== 'linux' && platform !== 'win32')
    return '此平台暂不支持应用内安装更新，请从 GitHub 发布页下载。'
  return null
}
export function plainReleaseNotes(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : Array.isArray(value)
        ? value
            .slice(0, 10)
            .map((item) => (typeof item?.note === 'string' ? item.note : ''))
            .join('\n')
        : ''
  return text
    .slice(0, 16000)
    .replace(/<[^>]*>/g, '')
    .slice(0, 8000)
}

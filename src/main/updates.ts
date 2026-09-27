import { plainReleaseNotes, type UpdateState } from '../shared/updates'

export interface UpdateBackend {
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(silent?: boolean, runAfter?: boolean): void
}
export class UpdateController {
  state: UpdateState
  private checkTask: Promise<UpdateState> | null = null
  private downloadTask: Promise<UpdateState> | null = null
  constructor(
    private backend: UpdateBackend,
    version: string,
    unsupported: string | null,
    private notify: (state: UpdateState) => void,
    private beforeInstall: () => Promise<void>,
    private installFailed: () => void = () => {},
  ) {
    this.state = {
      phase: unsupported ? 'unsupported' : 'idle',
      currentVersion: version,
      message: unsupported || '可手动检查新版本；发现更新后由你决定下载和安装。',
    }
    backend.on('update-available', (info) =>
      this.set({
        phase: 'available',
        version: info.version,
        releaseNotes: plainReleaseNotes(info.releaseNotes),
        message: '发现新版本，可以下载更新。',
        percent: undefined,
      }),
    )
    backend.on('update-not-available', () =>
      this.set({
        phase: 'current',
        message: '当前已是最新发布版本。',
        version: undefined,
        releaseNotes: undefined,
        percent: undefined,
      }),
    )
    backend.on('download-progress', (value) =>
      this.set({
        phase: 'downloading',
        percent: Math.max(0, Math.min(100, Number(value.percent) || 0)),
        transferred: Number(value.transferred) || 0,
        total: Number(value.total) || 0,
        message: '正在下载更新，下载完成后可选择安装并重启。',
      }),
    )
    backend.on('update-downloaded', (info) =>
      this.set({
        phase: 'downloaded',
        version: info.version,
        percent: 100,
        message: '更新已下载并通过校验，点击安装后将退出房间并重启。',
      }),
    )
    backend.on('error', (error) => this.fail(error))
  }
  private set(value: Partial<UpdateState>) {
    this.state = { ...this.state, ...value }
    this.notify({ ...this.state })
  }
  private fail(error: any) {
    if (this.state.phase === 'installing') this.installFailed()
    const missing = /LATEST_VERSION_NOT_FOUND|404|No published versions|No releases/i.test(
      `${error?.code || ''} ${error?.message || ''}`,
    )
    this.set({
      phase: 'error',
      message: missing
        ? '暂时没有可用的更新发布，可稍后重试或打开 GitHub 发布页。'
        : '更新失败，请检查网络或安装文件的写入权限后重试，也可从 GitHub 发布页手动下载。',
    })
  }
  async check(): Promise<UpdateState> {
    if (this.state.phase === 'unsupported') return this.state
    if (this.checkTask) return this.checkTask
    if (['downloading', 'downloaded', 'installing'].includes(this.state.phase)) return this.state
    this.set({ phase: 'checking', message: '正在检查 GitHub Releases…' })
    const task = (async () => {
      try {
        await this.backend.checkForUpdates()
      } catch (error) {
        this.fail(error)
      }
      return this.state
    })()
    this.checkTask = task
    try {
      return await task
    } finally {
      if (this.checkTask === task) this.checkTask = null
    }
  }
  async download(): Promise<UpdateState> {
    if (this.downloadTask) return this.downloadTask
    if (this.state.phase !== 'available') return this.state
    this.set({ phase: 'downloading', percent: 0, message: '准备下载更新…' })
    const task = (async () => {
      try {
        await this.backend.downloadUpdate()
      } catch (error) {
        this.fail(error)
      }
      return this.state
    })()
    this.downloadTask = task
    try {
      return await task
    } finally {
      if (this.downloadTask === task) this.downloadTask = null
    }
  }
  async install(): Promise<UpdateState> {
    if (this.state.phase !== 'downloaded') return this.state
    this.set({ phase: 'installing', message: '正在退出房间并安装更新…' })
    try {
      await this.beforeInstall()
      this.backend.quitAndInstall(false, true)
    } catch (error) {
      this.fail(error)
    }
    return this.state
  }
}

import { plainReleaseNotes, type UpdateMessageKey, type UpdateState } from '../shared/updates'

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
    unsupported: UpdateMessageKey | null,
    private notify: (state: UpdateState) => void,
    private beforeInstall: () => Promise<void>,
    private installFailed: () => void = () => {},
  ) {
    this.state = {
      phase: unsupported ? 'unsupported' : 'idle',
      currentVersion: version,
      message: unsupported || 'updates.idleNotice',
    }
    backend.on('update-available', (info) =>
      this.set({
        phase: 'available',
        version: info.version,
        releaseNotes: plainReleaseNotes(info.releaseNotes),
        message: 'updates.availableNotice',
        percent: undefined,
      }),
    )
    backend.on('update-not-available', () =>
      this.set({
        phase: 'current',
        message: 'updates.upToDate',
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
        message: 'updates.downloadingNotice',
      }),
    )
    backend.on('update-downloaded', (info) =>
      this.set({
        phase: 'downloaded',
        version: info.version,
        percent: 100,
        message: 'updates.downloadReady',
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
      message: missing ? 'updates.releaseUnavailable' : 'updates.failedNotice',
    })
  }
  async check(): Promise<UpdateState> {
    if (this.state.phase === 'unsupported') return this.state
    if (this.checkTask) return this.checkTask
    if (['downloading', 'downloaded', 'installing'].includes(this.state.phase)) return this.state
    this.set({ phase: 'checking', message: 'updates.checkingReleases' })
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
    this.set({ phase: 'downloading', percent: 0, message: 'updates.preparingDownload' })
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
    this.set({ phase: 'installing', message: 'updates.installingNotice' })
    try {
      await this.beforeInstall()
      this.backend.quitAndInstall(false, true)
    } catch (error) {
      this.fail(error)
    }
    return this.state
  }
}

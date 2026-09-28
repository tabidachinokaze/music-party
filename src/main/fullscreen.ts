import type { BrowserWindow } from 'electron'

// Events are authoritative; window managers may update isFullScreen() after emitting them.
export class FullScreenController {
  value: boolean
  revision = 0
  private target: boolean
  private operation: Promise<boolean> | null = null
  private changed: (() => void) | null = null
  constructor(
    private window: BrowserWindow,
    private notify: () => void,
  ) {
    this.value = this.target = window.isFullScreen()
    window.on('enter-full-screen', () => this.accept(true))
    window.on('leave-full-screen', () => this.accept(false))
  }
  private accept(value: boolean) {
    this.value = value
    this.revision++
    if (!this.operation) this.target = value
    this.notify()
    this.changed?.()
  }
  set(value: boolean | 'toggle'): Promise<boolean> {
    this.target = value === 'toggle' ? !this.target : value
    if (this.operation) return this.operation
    const run = async () => {
      while (this.value !== this.target) {
        await new Promise<void>((resolve, reject) => {
          const requested = this.target
          const cleanup = () => {
            clearTimeout(timer)
            this.changed = null
            this.window.removeListener('closed', closed)
          }
          const closed = () => {
            cleanup()
            reject(new Error('窗口已关闭'))
          }
          const timer = setTimeout(() => {
            cleanup()
            reject(new Error('系统全屏切换超时，请重试'))
          }, 5000)
          this.changed = () => {
            if (this.value === requested) {
              cleanup()
              resolve()
            }
          }
          this.window.once('closed', closed)
          try {
            this.window.setFullScreen(requested)
          } catch (error) {
            cleanup()
            reject(error)
          }
        })
      }
      return this.value
    }
    const operation = Promise.resolve()
      .then(run)
      .finally(() => {
        this.operation = null
        this.target = this.value
      })
    this.operation = operation
    return operation
  }
}

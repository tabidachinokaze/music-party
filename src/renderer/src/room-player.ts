import type { RoomPlayback, Song } from '../../shared/types'
import { shouldAccept, targetPosition } from '../../shared/multiplayer'

export interface AudioPort {
  src: string
  currentTime: number
  duration: number
  readyState: number
  paused: boolean
  pause(): void
  play(): Promise<void>
  load(): void
  addEventListener(type: string, callback: EventListener): void
  removeEventListener(type: string, callback: EventListener): void
}
// Snapshot application is one-way; audio events never cause a room mutation.
export class RoomPlayer {
  private epoch = 0
  private state: RoomPlayback | null = null
  private loaded = ''
  private desired = ''
  private loading: Promise<void> | null = null
  private cancelLoad: (() => void) | null = null
  private listening = true
  constructor(
    private audio: AudioPort,
    private resolve: (id: string) => Promise<{ song: Song; url: string }>,
    private changed: (song: Song) => void,
    private now: () => number = () => performance.now(),
  ) {}
  suspend() {
    this.epoch++
    this.cancelLoad?.()
    this.cancelLoad = null
    this.state = null
    this.loaded = ''
    this.desired = ''
    this.loading = null
    this.audio.pause()
  }
  reset() {
    this.suspend()
    this.listening = true
  }
  async setListening(listening: boolean) {
    this.listening = listening
    if (!listening) this.audio.pause()
    else if (this.state && this.loaded) {
      this.align(true)
      await this.audio.play()
    }
  }
  private align(force = false) {
    if (!this.state?.song || !this.listening || this.audio.readyState < 1) return
    const pos = targetPosition(this.state, this.now()) / 1000
    const bounded = Number.isFinite(this.audio.duration)
      ? Math.min(pos, Math.max(0, this.audio.duration - 0.1))
      : pos
    if (force || this.state.forceSync || Math.abs(this.audio.currentTime - bounded) > 1.5)
      this.audio.currentTime = bounded
  }
  async apply(next: RoomPlayback): Promise<void> {
    if (!shouldAccept(this.state, next)) return
    this.state = next
    if (!next.song) {
      this.epoch++
      this.cancelLoad?.()
      this.loading = null
      this.loaded = ''
      this.desired = ''
      this.audio.pause()
      return
    }
    const key = `${next.song.songId}:${next.song.songBizId}`
    if (key === this.loaded) {
      this.align()
      if (
        this.listening &&
        this.audio.paused &&
        (!next.duration || targetPosition(next, this.now()) < next.duration - 500)
      )
        await this.audio.play()
      return
    }
    if (key === this.desired && this.loading) return this.loading
    this.cancelLoad?.()
    this.desired = key
    const epoch = ++this.epoch
    this.audio.pause()
    const task = (async () => {
      const track = await this.resolve(next.song!.songId)
      if (epoch !== this.epoch) return
      this.audio.src = track.url
      const ready = new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer)
          this.audio.removeEventListener('loadedmetadata', done)
          this.audio.removeEventListener('error', fail)
          if (epoch === this.epoch) this.cancelLoad = null
        }
        const done: EventListener = () => {
          cleanup()
          resolve()
        }
        const fail: EventListener = () => {
          cleanup()
          reject(new Error('当前歌曲音频加载失败'))
        }
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('音频加载超时'))
        }, 15000)
        this.cancelLoad = () => {
          cleanup()
          resolve()
        }
        this.audio.addEventListener('loadedmetadata', done)
        this.audio.addEventListener('error', fail)
      })
      this.audio.load()
      await ready
      if (epoch !== this.epoch) return
      this.loaded = key
      this.changed(track.song)
      this.align(true)
      if (this.listening) await this.audio.play()
    })()
    this.loading = task
    try {
      await task
    } finally {
      if (epoch === this.epoch) {
        this.loading = null
        this.desired = ''
      }
    }
  }
}

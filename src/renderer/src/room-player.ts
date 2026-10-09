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
  private endedKey = ''
  auditioning = false
  private auditionListening = true
  private auditionLoaded = false
  private suspended = false
  constructor(
    private audio: AudioPort,
    private resolve: (id: string, audition?: boolean) => Promise<{ song: Song; url: string }>,
    private changed: (song: Song | null) => void,
    private now: () => number = () => performance.now(),
    private auditionChanged: (active: boolean) => void = () => {},
  ) {}
  suspend() {
    this.suspended = true
    if (this.auditioning) return
    this.epoch++
    this.cancelLoad?.()
    this.cancelLoad = null
    this.state = null
    this.loaded = ''
    this.endedKey = ''
    this.desired = ''
    this.loading = null
    this.audio.pause()
  }
  reset() {
    this.auditioning = false
    this.auditionLoaded = false
    this.auditionChanged(false)
    this.suspend()
    this.listening = true
    this.suspended = false
  }
  async ended() {
    if (this.auditioning) {
      await this.returnToRoom()
      return
    }
    this.endedKey = this.loaded
  }
  async setListening(listening: boolean) {
    if (this.auditioning) {
      this.auditionListening = listening
      if (!listening) this.audio.pause()
      else if (this.auditionLoaded) await this.audio.play()
      return
    }
    this.listening = listening
    if (!listening) this.audio.pause()
    else if (this.state && this.loaded && this.endedKey !== this.loaded) {
      this.align(true)
      await this.audio.play()
    }
  }
  private align(force = false) {
    if (this.auditioning || !this.state?.song || !this.listening || this.audio.readyState < 1)
      return
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
    this.suspended = false
    // Keep receiving the room timeline while a local audition owns the audio source.
    if (this.auditioning) return
    if (!next.song) {
      this.epoch++
      this.cancelLoad?.()
      this.cancelLoad = null
      this.loading = null
      this.loaded = ''
      this.desired = ''
      this.audio.pause()
      this.changed(null)
      return
    }
    const key = `${next.song.songId}:${next.song.songBizId}`
    if (key === this.loaded) {
      if (key === this.endedKey) return
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
      await this.loadSource(track.url, epoch)
      if (epoch !== this.epoch) return
      this.loaded = key
      this.endedKey = ''
      this.changed(track.song)
      this.align(true)
      if (this.listening) await this.audio.play()
    })()
    this.loading = task
    try {
      await task
    } catch (error) {
      if (epoch === this.epoch) throw error
    } finally {
      if (epoch === this.epoch) {
        this.loading = null
        this.desired = ''
      }
    }
  }
  private async loadSource(url: string, epoch: number) {
    this.audio.src = url
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
  }
  async audition(id: string) {
    if (!this.state) throw new Error('房间播放状态尚未同步，请稍后试听')
    this.cancelLoad?.()
    const epoch = ++this.epoch
    this.loaded = this.desired = this.endedKey = ''
    this.loading = null
    this.auditioning = true
    this.auditionLoaded = false
    this.auditionListening = true
    this.auditionChanged(true)
    this.audio.pause()
    try {
      const track = await this.resolve(id, true)
      if (epoch !== this.epoch) return
      await this.loadSource(track.url, epoch)
      if (epoch !== this.epoch) return
      this.auditionLoaded = true
      this.changed({
        ...track.song,
        duration:
          Number.isFinite(this.audio.duration) && this.audio.duration > 0
            ? this.audio.duration * 1000
            : track.song.duration,
      })
      this.audio.currentTime = 0
      if (this.auditionListening) await this.audio.play()
    } catch (error) {
      if (epoch !== this.epoch) return
      await this.returnToRoom()
      throw error
    }
  }
  seekAudition(progress: number) {
    if (!this.auditioning || !this.auditionLoaded || !Number.isFinite(progress)) return
    const position = Math.max(0, progress / 1000)
    this.audio.currentTime = Number.isFinite(this.audio.duration)
      ? Math.min(position, Math.max(0, this.audio.duration - 0.1))
      : position
  }
  async returnToRoom() {
    if (!this.auditioning) return
    this.epoch++
    this.cancelLoad?.()
    this.cancelLoad = null
    this.loading = null
    this.loaded = this.desired = this.endedKey = ''
    this.auditioning = false
    this.auditionLoaded = false
    this.auditionChanged(false)
    this.audio.pause()
    if (this.state && !this.suspended) await this.apply(this.state)
    else this.changed(null)
  }
}

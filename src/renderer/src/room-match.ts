import { ui } from '../../shared/ui-language'
import type { MatchNotice } from '../../shared/match-notice'
import type { Method } from '../../shared/types'

export interface MatchTransport {
  open(id: string): Promise<void>
  poll(id: string): Promise<Array<{ timestamp: number; notice: MatchNotice }>>
  close(id: string): Promise<void>
}
export type MatchPhase = 'connecting' | 'searching' | 'joining' | null
type Call = (method: Method, args?: Record<string, unknown>) => Promise<any>
function cancellable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error(ui('匹配已取消', 'Matching canceled')))
    if (signal.aborted) {
      task.catch(() => {})
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Matching is completed by the official notification ACK, never an unconfirmed status. */
export class RoomMatcher {
  private generation = 0
  private id = ''
  private abort: AbortController | null = null
  private started = false
  private confirmed = false
  private acknowledging = false
  private minimumTime = 0
  private pending: Array<{ timestamp: number; notice: MatchNotice }> = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private statusTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private call: Call,
    private transport: MatchTransport,
    private update: (phase: MatchPhase) => void,
    private accept: (snapshot: any) => void,
    private fail: (error: Error) => void,
  ) {}

  private live(generation: number) {
    return !!this.id && generation === this.generation
  }
  private deadline(delay: number, generation: number) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!this.live(generation)) return
      const started = this.started
      this.close()
      if (started) void this.call('multiMatchCancel').catch(() => {})
      this.fail(
        new Error(
          ui('匹配超时，请重试或换一首歌', 'Matching timed out. Try again or choose another song.'),
        ),
      )
    }, delay)
  }
  async start(songId: string) {
    if (!/^[1-9]\d{0,23}$/.test(songId))
      throw new Error(ui('请先选择一首匹配用歌曲', 'Choose a song for matching first'))
    await this.cancel()
    const generation = ++this.generation
    const id = crypto.randomUUID()
    const abort = new AbortController()
    this.abort = abort
    this.id = id
    this.update('connecting')
    this.deadline(20000, generation)
    try {
      await cancellable(this.transport.open(id), abort.signal)
      if (!this.live(generation)) {
        void this.transport.close(id).catch(() => {})
        return
      }
      this.update('searching')
      this.started = true
      this.poll(generation)
      const body = await cancellable(this.call('multiMatch', { songId }), abort.signal)
      if (!this.live(generation)) return
      const startTime = Number(body.data?.startMatchTimeMills)
      this.minimumTime = Number.isFinite(startTime) && startTime > 0 ? startTime : 0
      this.confirmed = true
      const wait = Number(body.data?.maxWaitTimeMills)
      this.deadline(
        Number.isFinite(wait) && wait > 0 ? Math.min(wait + 10000, 120000) : 60000,
        generation,
      )
      this.deliver(generation)
      this.pollStatus(generation)
    } catch (error: any) {
      if (!this.live(generation)) return
      const started = this.started
      this.close()
      if (started) void this.call('multiMatchCancel').catch(() => {})
      this.fail(
        error instanceof Error
          ? error
          : new Error(ui('匹配失败，请重试', "Couldn't find a room. Try again.")),
      )
    }
  }
  private poll(generation: number) {
    this.pollTimer = setTimeout(async () => {
      if (!this.live(generation)) return
      try {
        const events = await this.transport.poll(this.id)
        if (!this.live(generation)) return
        for (const event of events) {
          if (!Number.isFinite(event.timestamp)) continue
          if (this.pending.length >= 10) this.pending.shift()
          this.pending.push(event)
        }
        this.deliver(generation)
      } catch (error: any) {
        if (!this.live(generation)) return
        const started = this.started
        this.close()
        if (started) void this.call('multiMatchCancel').catch(() => {})
        this.fail(
          error instanceof Error
            ? error
            : new Error(
                ui(
                  '匹配通知连接已断开，请重试',
                  'Disconnected from the matching service. Try again.',
                ),
              ),
        )
        return
      }
      if (this.live(generation)) this.poll(generation)
    }, 1000)
  }
  private deliver(generation: number) {
    if (!this.confirmed || !this.live(generation)) return
    for (const event of this.pending.splice(0)) {
      if (event.timestamp >= this.minimumTime && this.live(generation))
        void this.notice(event.notice, generation)
    }
  }
  private async notice(notice: MatchNotice, generation: number) {
    if (!this.live(generation) || this.acknowledging) return
    if (notice.kind === 'failed') {
      this.close()
      this.fail(
        new Error(
          ui(
            '官方匹配未成功（{0}），请重试或换一首歌',
            'Matching failed ({0}). Try again or choose another song.',
            notice.reason,
          ),
        ),
      )
      return
    }
    this.acknowledging = true
    this.deadline(20000, generation)
    this.update('joining')
    try {
      const body = await this.call('multiJoin', { roomId: notice.roomId, inviterUid: '0' })
      if (!this.live(generation)) return
      const snapshot = body.data?.multiLtRoomSnapshot
      if (snapshot?.roomId !== notice.roomId)
        throw new Error(
          ui('匹配确认未返回对应房间', "The matching service didn't confirm this room"),
        )
      this.close()
      this.accept(snapshot)
    } catch (error: any) {
      if (!this.live(generation)) return
      this.close()
      this.fail(
        error instanceof Error
          ? error
          : new Error(ui('匹配确认失败，请重试', "Couldn't confirm the match. Try again.")),
      )
    }
  }
  private pollStatus(generation: number) {
    if (!this.live(generation)) return
    this.statusTimer = setTimeout(async () => {
      if (!this.live(generation)) return
      try {
        const body = await this.call('multiStatus')
        if (!this.live(generation)) return
        const snapshot = body.data?.multiLtRoomSnapshot
        if (!this.acknowledging && body.data?.status === 'RECONNECT_SUCCESS' && snapshot?.roomId) {
          this.close()
          this.accept(snapshot)
          return
        }
      } catch {
        // Independent deadline handles stalled or temporarily unavailable HTTP status.
      }
      if (this.live(generation)) this.pollStatus(generation)
    }, 2500)
  }
  async cancel() {
    const started = this.started
    this.close()
    if (started) await this.call('multiMatchCancel')
  }
  close() {
    ++this.generation
    this.abort?.abort()
    this.abort = null
    if (this.timer) clearTimeout(this.timer)
    if (this.pollTimer) clearTimeout(this.pollTimer)
    if (this.statusTimer) clearTimeout(this.statusTimer)
    this.timer = this.pollTimer = this.statusTimer = null
    const id = this.id
    this.id = ''
    this.started = this.confirmed = this.acknowledging = false
    this.minimumTime = 0
    this.pending = []
    if (id) void this.transport.close(id).catch(() => {})
    this.update(null)
  }
}

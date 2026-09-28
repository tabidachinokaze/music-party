import { afterEach, expect, it, vi } from 'vitest'
import { RoomTransition } from '../src/renderer/src/room-transition'
import type { RoomPlayback } from '../src/shared/types'
afterEach(() => vi.useRealTimers())
function state(): RoomPlayback {
  return {
    song: { songId: '1', songBizId: '11', songRcmdUid: '3' },
    version: 1,
    nextSongs: [],
    waitSongCount: 0,
    duration: 30000,
    playedTime: 29000,
    sampledAt: 0,
    forceSync: false,
  }
}
it('checks the expected end without waiting for a long heartbeat, then retries a stale first response', async () => {
  vi.useFakeTimers()
  let now = 0
  let current = state()
  const refresh = vi.fn(async () => {
    if (refresh.mock.calls.length === 2)
      current = {
        ...current,
        song: { ...current.song!, songId: '2', songBizId: '12' },
        version: 2,
        playedTime: 0,
        sampledAt: now,
      }
  })
  const watcher = new RoomTransition(
    () => current,
    refresh,
    () => now,
  )
  watcher.changed()
  now = 1080
  await vi.advanceTimersByTimeAsync(1080)
  expect(refresh).toHaveBeenCalledTimes(1)
  now += 750
  await vi.advanceTimersByTimeAsync(750)
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(current.song?.songId).toBe('2')
  await vi.advanceTimersByTimeAsync(1000)
  expect(refresh).toHaveBeenCalledTimes(2)
  watcher.pause()
})
it('uses ended as a boundary even when duration is unknown, and cancels retries on leaving', async () => {
  vi.useFakeTimers()
  const current = { ...state(), duration: 0 }
  const refresh = vi.fn(async () => {})
  const watcher = new RoomTransition(
    () => current,
    refresh,
    () => 0,
  )
  watcher.changed()
  await vi.advanceTimersByTimeAsync(5000)
  expect(refresh).not.toHaveBeenCalled()
  watcher.ended()
  await vi.advanceTimersByTimeAsync(100)
  expect(refresh).toHaveBeenCalledTimes(1)
  watcher.pause()
  await vi.advanceTimersByTimeAsync(60000)
  expect(refresh).toHaveBeenCalledTimes(1)
})
it('keeps confirming across a temporary empty playing slot between songs', async () => {
  vi.useFakeTimers()
  let current: RoomPlayback = state()
  const refresh = vi.fn(async () => {
    current =
      refresh.mock.calls.length === 1
        ? { ...current, song: null }
        : { ...state(), song: { songId: '2', songBizId: '12', songRcmdUid: '3' }, playedTime: 0 }
  })
  const watcher = new RoomTransition(
    () => current,
    refresh,
    () => 0,
  )
  watcher.changed()
  watcher.ended()
  await vi.advanceTimersByTimeAsync(100)
  expect(current.song).toBeNull()
  await vi.advanceTimersByTimeAsync(1500)
  expect(current.song?.songId).toBe('2')
  watcher.pause()
})
it('does not run overlapping refreshes or restart a paused watcher after a late response', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const watcher = new RoomTransition(
    () => state(),
    refresh,
    () => 30000,
  )
  watcher.ended()
  await vi.advanceTimersByTimeAsync(100)
  watcher.ended()
  watcher.changed()
  await vi.advanceTimersByTimeAsync(5000)
  expect(refresh).toHaveBeenCalledTimes(1)
  watcher.pause()
  finish()
  await vi.advanceTimersByTimeAsync(60000)
  expect(refresh).toHaveBeenCalledTimes(1)
})

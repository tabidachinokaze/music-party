import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RoomMatcher, type MatchTransport } from '../src/renderer/src/room-match'
import type { Method } from '../src/shared/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}
function setup() {
  const transport = {
    open: vi.fn(async () => {}),
    poll: vi.fn<MatchTransport['poll']>(async () => []),
    close: vi.fn(async () => {}),
  }
  const call = vi.fn(async (method: Method, _args?: Record<string, unknown>): Promise<any> => {
    if (method === 'multiMatch')
      return { data: { startMatchTimeMills: 8000, maxWaitTimeMills: 60000 } }
    if (method === 'multiJoin') return { data: { multiLtRoomSnapshot: { roomId: 'matched' } } }
    return { data: {} }
  })
  const update = vi.fn(),
    accept = vi.fn(),
    fail = vi.fn()
  const matcher = new RoomMatcher(call, transport, update, accept, fail)
  return { matcher, transport, call, update, accept, fail }
}
const ready = (timestamp = 9000) => ({
  timestamp,
  notice: { kind: 'ready' as const, roomId: 'matched' },
})
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('connects Mini before starting the selected song and ACKs the exact notified room', async () => {
  const { matcher, transport, call, accept, fail } = setup()
  await matcher.start('123')
  expect(transport.open.mock.invocationCallOrder[0]).toBeLessThan(call.mock.invocationCallOrder[0])
  expect(call).toHaveBeenCalledWith('multiMatch', { songId: '123' })
  transport.poll.mockResolvedValueOnce([ready()])
  await vi.advanceTimersByTimeAsync(1000)
  expect(call).toHaveBeenCalledWith('multiJoin', { roomId: 'matched', inviterUid: '0' })
  expect(accept).toHaveBeenCalledExactlyOnceWith({ roomId: 'matched' })
  expect(fail).not.toHaveBeenCalled()
})
it('buffers notifications arriving before the HTTP response and filters by server start time', async () => {
  const { matcher, transport, call, accept } = setup()
  const start = deferred<any>()
  const original = call.getMockImplementation()!
  call.mockImplementation((method, args) =>
    method === 'multiMatch' ? start.promise : original(method, args),
  )
  const running = matcher.start('123')
  transport.poll.mockResolvedValueOnce([
    { timestamp: 1000, notice: { kind: 'ready', roomId: 'old-room' } },
    ready(),
  ])
  await vi.advanceTimersByTimeAsync(1000)
  expect(call.mock.calls.some(([method]) => method === 'multiJoin')).toBe(false)
  start.resolve({ data: { startMatchTimeMills: 8000, maxWaitTimeMills: 60000 } })
  await running
  await vi.advanceTimersByTimeAsync(0)
  expect(call).toHaveBeenCalledWith('multiJoin', { roomId: 'matched', inviterUid: '0' })
  expect(accept).toHaveBeenCalledTimes(1)
})
it('cancelling while the channel opens cannot start a late matching request', async () => {
  const { matcher, transport, call, accept } = setup()
  const opening = deferred<void>()
  transport.open.mockImplementation(() => opening.promise)
  const running = matcher.start('123')
  await vi.advanceTimersByTimeAsync(0)
  await matcher.cancel()
  // The UI action completes immediately; no timeout or late transport response is needed.
  await running
  opening.resolve()
  await vi.advanceTimersByTimeAsync(10000)
  expect(call).not.toHaveBeenCalled()
  expect(accept).not.toHaveBeenCalled()
  expect(transport.close).toHaveBeenCalled()
})
it('cancelling an in-flight start discards its eventual response and notices', async () => {
  const { matcher, transport, call, accept } = setup()
  const start = deferred<any>()
  const original = call.getMockImplementation()!
  call.mockImplementation((method, args) =>
    method === 'multiMatch' ? start.promise : original(method, args),
  )
  const running = matcher.start('123')
  await vi.advanceTimersByTimeAsync(0)
  await matcher.cancel()
  await running
  start.resolve({ data: { startMatchTimeMills: 8000, maxWaitTimeMills: 60000 } })
  transport.poll.mockResolvedValue([ready()])
  await vi.advanceTimersByTimeAsync(5000)
  expect(call).toHaveBeenCalledWith('multiMatchCancel')
  expect(call.mock.calls.some(([method]) => method === 'multiJoin')).toBe(false)
  expect(accept).not.toHaveBeenCalled()
})
it('cancelling during ACK cannot attach the late joined snapshot', async () => {
  const { matcher, transport, call, accept } = setup()
  const ack = deferred<any>()
  const original = call.getMockImplementation()!
  call.mockImplementation((method, args) =>
    method === 'multiJoin' ? ack.promise : original(method, args),
  )
  await matcher.start('123')
  transport.poll.mockResolvedValueOnce([ready()])
  await vi.advanceTimersByTimeAsync(1000)
  await matcher.cancel()
  ack.resolve({ data: { multiLtRoomSnapshot: { roomId: 'matched' } } })
  await vi.advanceTimersByTimeAsync(0)
  expect(accept).not.toHaveBeenCalled()
})
it('gives ACK an independent deadline when a notice arrives near the original timeout', async () => {
  const { matcher, transport, call, accept, fail } = setup()
  const ack = deferred<any>()
  const original = call.getMockImplementation()!
  call.mockImplementation((method, args) => {
    if (method === 'multiMatch')
      return Promise.resolve({ data: { startMatchTimeMills: 8000, maxWaitTimeMills: 1000 } })
    return method === 'multiJoin' ? ack.promise : original(method, args)
  })
  await matcher.start('123')
  await vi.advanceTimersByTimeAsync(9000)
  transport.poll.mockResolvedValueOnce([ready()])
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(2000)
  expect(fail).not.toHaveBeenCalled()
  ack.resolve({ data: { multiLtRoomSnapshot: { roomId: 'matched' } } })
  await vi.advanceTimersByTimeAsync(0)
  expect(accept).toHaveBeenCalledTimes(1)
})
it('rejects an ACK that returned a different room', async () => {
  const { matcher, transport, call, accept, fail } = setup()
  const original = call.getMockImplementation()!
  call.mockImplementation((method, args) =>
    method === 'multiJoin'
      ? Promise.resolve({ data: { multiLtRoomSnapshot: { roomId: 'other' } } })
      : original(method, args),
  )
  await matcher.start('123')
  transport.poll.mockResolvedValueOnce([ready()])
  await vi.advanceTimersByTimeAsync(1000)
  expect(accept).not.toHaveBeenCalled()
  expect(fail.mock.calls[0][0].message).toContain('对应房间')
})
it.each(['WAIT_ACK', 'MATCHING', 'RECONNECT_SUCCESS'])(
  'status %s only restores a confirmed reconnect instead of substituting for notification ACK',
  async (status) => {
    const { matcher, call, accept } = setup()
    const original = call.getMockImplementation()!
    call.mockImplementation((method, args) =>
      method === 'multiStatus'
        ? Promise.resolve({ data: { status, multiLtRoomSnapshot: { roomId: 'matched' } } })
        : original(method, args),
    )
    await matcher.start('123')
    await vi.advanceTimersByTimeAsync(2500)
    expect(accept).toHaveBeenCalledTimes(status === 'RECONNECT_SUCCESS' ? 1 : 0)
  },
)
it('failed notices stop the attempt without ACKing or inventing a room', async () => {
  const { matcher, transport, call, accept, fail } = setup()
  await matcher.start('123')
  transport.poll.mockResolvedValueOnce([
    { timestamp: 9000, notice: { kind: 'failed', reason: 'NO_MATCH' } },
  ])
  await vi.advanceTimersByTimeAsync(1000)
  expect(call.mock.calls.some(([method]) => method === 'multiJoin')).toBe(false)
  expect(accept).not.toHaveBeenCalled()
  expect(fail.mock.calls[0][0].message).toContain('NO_MATCH')
})
it('does not accept an old generation notice after beginning a new selected-song attempt', async () => {
  const { matcher, transport, call, accept } = setup()
  const oldPoll = deferred<Awaited<ReturnType<MatchTransport['poll']>>>()
  await matcher.start('123')
  transport.poll.mockImplementationOnce(() => oldPoll.promise)
  // Start the poll without blocking on its unresolved request.
  vi.advanceTimersByTime(1000)
  await matcher.start('456')
  oldPoll.resolve([ready()])
  await vi.advanceTimersByTimeAsync(0)
  expect(accept).not.toHaveBeenCalled()
  expect(call.mock.calls.some(([method]) => method === 'multiJoin')).toBe(false)
  expect(call).toHaveBeenCalledWith('multiMatch', { songId: '456' })
})

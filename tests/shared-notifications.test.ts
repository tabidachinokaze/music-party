// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from tabidachinokaze/folium-mod-music-party at b01525f.
// Source: https://github.com/tabidachinokaze/folium-mod-music-party
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SharedNotifications, type NotificationFactory } from '../src/main/shared-notifications'
import type { MiniNotice, MiniNotificationOptions } from '../src/main/mini-notifications'
import { PRIVATE_REALTIME_BIZ } from '../src/main/private-notice'
import type { PrivateNotificationBatch } from '../src/shared/private-notices'

// tests/shared-notifications.test.ts
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const credentials = { accId: 'test-im-account', token: 'test-im-token' }
function setup(
  getCredentials = vi.fn(async () => credentials),
  onBatch?: (batch: PrivateNotificationBatch) => void,
) {
  const sockets: {
    options: MiniNotificationOptions
    notices: MiniNotice[]
    open: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    poll: () => MiniNotice[]
  }[] = []
  const make: NotificationFactory = (options) => {
    let closed = false
    const socket = {
      options,
      notices: [] as MiniNotice[],
      open: vi.fn(async () => {}),
      close: vi.fn(() => {
        if (closed) return
        closed = true
        options.onClose?.('test disconnected')
      }),
      poll: () => socket.notices.splice(0),
    }
    sockets.push(socket)
    return socket
  }
  return {
    manager: new SharedNotifications(getCredentials, make, onBatch),
    sockets,
    getCredentials,
  }
}
function message(id = '42', peer = '8') {
  const raw = {
    scene: 1,
    channelId: peer,
    senderUserId: peer,
    msgBody: { msgId: id, msgTime: Date.now(), msgType: 1, text: { textBody: 'test' } },
  }
  return {
    msgType: 133,
    bizType: PRIVATE_REALTIME_BIZ,
    serverExt: { data: gzipSync(JSON.stringify(raw)).toString('base64') },
  }
}
const settle = () => vi.advanceTimersByTimeAsync(0)

it('shares one authenticated transport with matching and keeps background delivery after closing match', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await x.manager.matchOpen('first')
  expect(x.sockets).toHaveLength(1)
  expect(x.getCredentials).toHaveBeenCalledOnce()
  expect(x.sockets[0].options.persistent).toBe(true)
  x.manager.matchClose('stale')
  expect(x.manager.matchPoll('first')).toEqual([])
  x.manager.matchClose('first')
  expect(x.sockets[0].close).not.toHaveBeenCalled()
  x.sockets[0].options.onNotification?.(message(), Date.now())
  const feed = x.manager.poll(0)
  expect(feed.connected).toBe(true)
  expect(feed.events.map((event) => event.notice.kind)).toEqual(['sync', 'message'])
  expect(JSON.stringify(feed)).not.toContain('test-im-token')
  expect(x.manager.poll(0)).toEqual(feed)
  expect(x.manager.poll(feed.cursor, feed.session).events).toEqual([])
  x.manager.close()
  expect(x.sockets[0].close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('adopts an existing matching socket when the account becomes verified', async () => {
  const x = setup()
  await x.manager.matchOpen('first')
  expect(x.manager.poll(0).events).toEqual([])
  x.manager.enablePrivate('9')
  x.manager.enablePrivate('9')
  x.manager.matchClose('first')
  expect(x.sockets).toHaveLength(1)
  expect(x.manager.poll(0).events).toHaveLength(1)
  expect(x.sockets[0].close).not.toHaveBeenCalled()
  x.manager.close()
})

it('backs off credential failures, does not retry on repeated account queries, and emits sync on recovery', async () => {
  const get = vi
    .fn(async () => credentials)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('still offline'))
  const x = setup(get)
  x.manager.enablePrivate('9')
  await settle()
  expect(x.manager.poll(0).connected).toBe(false)
  x.manager.enablePrivate('9')
  await vi.advanceTimersByTimeAsync(999)
  expect(get).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(get).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1999)
  expect(get).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(get).toHaveBeenCalledTimes(3)
  expect(x.manager.poll(0)).toMatchObject({ connected: true, cursor: 1 })
  x.manager.close()
})

it('invalidates an interrupted matching attempt while reconnecting the inbox and deduplicating replayed messages', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await x.manager.matchOpen('old')
  const notice = message()
  x.sockets[0].options.onNotification?.(notice, Date.now())
  x.sockets[0].options.onClose?.('connection lost')
  expect(() => x.manager.matchPoll('old')).toThrow('connection lost')
  await vi.advanceTimersByTimeAsync(1000)
  expect(x.sockets).toHaveLength(2)
  x.sockets[1].options.onNotification?.(notice, Date.now())
  expect(x.manager.poll(0).events.map((event) => event.notice.kind)).toEqual([
    'sync',
    'message',
    'sync',
  ])
  expect(() => x.manager.matchPoll('old')).toThrow('connection lost')
  x.sockets[1].notices.push({
    timestamp: Date.now(),
    notice: { kind: 'ready', roomId: 'old-room' },
  })
  await x.manager.matchOpen('new')
  expect(x.manager.matchPoll('new')).toEqual([])
  x.manager.matchClose('old')
  expect(x.manager.matchPoll('new')).toEqual([])
  x.manager.close()
})

it('cancels pending credentials and ignores all callbacks after disposal', async () => {
  let resolve!: (value: typeof credentials) => void
  const x = setup(
    vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    ),
  )
  x.manager.enablePrivate('9')
  x.manager.close()
  resolve(credentials)
  await settle()
  expect(x.sockets[0].open).not.toHaveBeenCalled()
  x.sockets[0].options.onNotification?.(message(), Date.now())
  x.sockets[0].options.onClose?.('late close')
  expect(x.manager.poll(0)).toMatchObject({ connected: false, events: [] })
  expect(vi.getTimerCount()).toBe(0)
})

it('isolates private feeds and old socket callbacks when the verified account changes', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await settle()
  x.sockets[0].options.onNotification?.(message(), Date.now())
  const previous = x.manager.poll(0)
  x.manager.enablePrivate('7')
  await settle()
  x.sockets[0].options.onNotification?.(message('100'), Date.now())
  const next = x.manager.poll(previous.cursor, previous.session)
  expect(next.session).not.toBe(previous.session)
  expect(next.reset).toBe(true)
  expect(next.events.map((event) => event.notice.kind)).toEqual(['sync'])
  expect(x.sockets[0].close).toHaveBeenCalledOnce()
  x.manager.close()
})

it('bounds the cursor feed, signals missed events, and rejects invalid cursors', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await settle()
  const first = x.manager.poll(0)
  for (let id = 1; id <= 300; id++)
    x.sockets[0].options.onNotification?.(message(String(id)), Date.now())
  const next = x.manager.poll(first.cursor, first.session)
  expect(next.reset).toBe(true)
  expect(next.events).toHaveLength(256)
  expect(next.cursor).toBe(301)
  expect(next.events[0].sequence).toBe(46)
  expect(x.manager.poll(0).events).toHaveLength(256)
  expect(() => x.manager.poll(-1)).toThrow('游标')
  expect(() => x.manager.poll(NaN)).toThrow('游标')
  x.manager.close()
})

it('expires idle matching leases without terminating a persistent inbox', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await x.manager.matchOpen('idle')
  await vi.advanceTimersByTimeAsync(30000)
  expect(() => x.manager.matchPoll('idle')).toThrow('页面已关闭')
  expect(x.manager.poll(0).connected).toBe(true)
  expect(x.sockets[0].close).not.toHaveBeenCalled()
  x.manager.close()
  const y = setup()
  await y.manager.matchOpen('idle')
  await vi.advanceTimersByTimeAsync(30000)
  expect(y.sockets[0].close).toHaveBeenCalledOnce()
  expect(() => y.manager.matchPoll('idle')).toThrow('页面已关闭')
  y.manager.close()
})

it('pushes new notices and connection changes directly without a polling timer', async () => {
  const onBatch = vi.fn()
  const x = setup(undefined, onBatch)
  x.manager.enablePrivate('9')
  await settle()
  expect(
    onBatch.mock.calls.map(([batch]) => [batch.reset, batch.connected, batch.events.length]),
  ).toEqual([
    [true, false, 0],
    [false, true, 1],
  ])
  x.sockets[0].options.onNotification?.(message(), Date.now())
  expect(onBatch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      cursor: 2,
      connected: true,
      events: [
        expect.objectContaining({
          sequence: 2,
          notice: expect.objectContaining({ kind: 'message' }),
        }),
      ],
    }),
  )
  const notifications = onBatch.mock.calls.length
  x.sockets[0].options.onNotification?.(message(), Date.now())
  expect(onBatch).toHaveBeenCalledTimes(notifications)
  expect(vi.getTimerCount()).toBe(0)
  x.sockets[0].options.onClose?.('network lost')
  expect(onBatch).toHaveBeenLastCalledWith(
    expect.objectContaining({ connected: false, events: [] }),
  )
  await vi.advanceTimersByTimeAsync(1000)
  expect(onBatch).toHaveBeenLastCalledWith(expect.objectContaining({ connected: true, cursor: 3 }))
  x.manager.close()
  expect(onBatch).toHaveBeenLastCalledWith(
    expect.objectContaining({ reset: true, connected: false, events: [] }),
  )
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps delivery active when an IPC subscriber throws and resets the session on account switch', async () => {
  const onBatch = vi.fn((_batch: PrivateNotificationBatch) => {
    throw new Error('window destroyed')
  })
  const x = setup(undefined, onBatch)
  x.manager.enablePrivate('9')
  await settle()
  x.sockets[0].options.onNotification?.(message(), Date.now())
  const first = x.manager.poll(0)
  expect(first.connected).toBe(true)
  expect(first.events).toHaveLength(2)
  x.manager.enablePrivate('7')
  await settle()
  const next = x.manager.poll(first.cursor, first.session)
  expect(next.reset).toBe(true)
  expect(next.events).toHaveLength(1)
  expect(next.session).not.toBe(first.session)
  expect(onBatch.mock.calls.some(([batch]) => batch.reset && batch.session === next.session)).toBe(
    true,
  )
  x.manager.close()
})

it('does not open stale credentials or accept callbacks when accounts change during login', async () => {
  let resolveOld!: (value: typeof credentials) => void
  const get = vi
    .fn(async () => credentials)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
  const x = setup(get)
  x.manager.enablePrivate('9')
  x.manager.enablePrivate('7')
  await settle()
  resolveOld(credentials)
  await settle()
  expect(x.sockets[0].open).not.toHaveBeenCalled()
  expect(x.sockets[1].open).toHaveBeenCalledOnce()
  x.sockets[0].options.onNotification?.(message(), Date.now())
  expect(x.manager.poll(0).events.map((event) => event.notice.kind)).toEqual(['sync'])
  x.manager.close()
})

it('supports removable IPC subscribers and isolates subscriber exceptions', async () => {
  const x = setup()
  const failed = vi.fn(() => {
    throw new Error('destroyed renderer')
  })
  const listener = vi.fn()
  const unsubscribeFailed = x.manager.subscribe(failed)
  const unsubscribe = x.manager.subscribe(listener)
  x.manager.enablePrivate('9')
  await settle()
  x.sockets[0].options.onNotification?.(message(), Date.now())
  expect(failed).toHaveBeenCalledTimes(3)
  expect(listener).toHaveBeenCalledTimes(3)
  unsubscribe()
  x.sockets[0].options.onNotification?.(message('second'), Date.now())
  expect(listener).toHaveBeenCalledTimes(3)
  expect(failed).toHaveBeenCalledTimes(4)
  unsubscribeFailed()
  x.manager.close()
  expect(listener).toHaveBeenCalledTimes(3)
  expect(failed).toHaveBeenCalledTimes(4)
})

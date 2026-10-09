import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  PrivatePresence,
  PRIVATE_PRESENCE_RETRY_DELAY,
  PRIVATE_PRESENCE_TTL,
} from '../src/main/private-presence'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const response = (online: unknown, uid = '8') => ({
  body: {
    code: 200,
    data: {
      online,
      liveOnline: true,
      personalHomepage: {
        userProfileData: {
          userId: uid,
          nickname: 'Peer',
          avatarUrl: 'http://p1.music.126.net/avatar.png',
          lastLoginIP: 'sensitive',
        },
      },
    },
  },
})

it('queries the fixed private setting endpoint, exports verified metadata, and caches for 45 seconds', async () => {
  const invoke = vi.fn(async () => response(true))
  const presence = new PrivatePresence(invoke, () => ({ cookie: 'test-cookie', epoch: 1 }))
  const expected = {
    uid: '8',
    online: true,
    nickname: 'Peer',
    avatar: 'https://p1.music.126.net/avatar.png',
  }
  expect(await presence.get('8')).toEqual(expected)
  expect(invoke).toHaveBeenCalledWith(
    'api',
    expect.objectContaining({
      uri: '/api/communication/msg/setting/get',
      crypto: 'eapi',
      data: { userId: '8', scene: 1 },
      cookie: 'test-cookie',
      noCookie: true,
    }),
  )
  await vi.advanceTimersByTimeAsync(PRIVATE_PRESENCE_TTL - 1)
  expect(await presence.get('8')).toEqual(expected)
  expect(invoke).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  await presence.get('8')
  expect(invoke).toHaveBeenCalledTimes(2)
})

it.each([false, undefined, null, 1, 'true'])(
  'does not infer online state from missing or non-boolean %s',
  async (value) => {
    const presence = new PrivatePresence(
      vi.fn(async () => response(value)),
      () => ({ cookie: 'test', epoch: 1 }),
    )
    expect((await presence.get('8')).online).toBe(value === false ? false : null)
  },
)

it('omits mismatched profile metadata and keeps failure unknown for 30 seconds before retry', async () => {
  const invoke = vi
    .fn(async () => response(true, '7'))
    .mockRejectedValueOnce(new Error('network offline'))
  const presence = new PrivatePresence(invoke, () => ({ cookie: 'test', epoch: 1 }))
  expect(await presence.get('8')).toEqual({ uid: '8', nickname: '', avatar: '', online: null })
  await vi.advanceTimersByTimeAsync(PRIVATE_PRESENCE_RETRY_DELAY - 1)
  await presence.get('8')
  expect(invoke).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  expect(await presence.get('8')).toEqual({ uid: '8', nickname: '', avatar: '', online: true })
  expect(invoke).toHaveBeenCalledTimes(2)
})

it('deduplicates concurrent contacts and limits official HTTP reads to two concurrent requests', async () => {
  const pending: (() => void)[] = []
  let active = 0,
    maximum = 0
  const invoke = vi.fn((_endpoint: string, args: Record<string, unknown>) => {
    active++
    maximum = Math.max(maximum, active)
    return new Promise<ReturnType<typeof response>>((resolve) =>
      pending.push(() => {
        active--
        resolve(response(true, String((args.data as any).userId)))
      }),
    )
  })
  const presence = new PrivatePresence(invoke, () => ({ cookie: 'test', epoch: 1 }))
  const first = presence.get('8'),
    duplicate = presence.get('8')
  expect(duplicate).toBe(first)
  const next = presence.get('9'),
    queued = presence.get('10')
  expect(invoke).toHaveBeenCalledTimes(2)
  pending.shift()!()
  await first
  expect(invoke).toHaveBeenCalledTimes(3)
  pending.shift()!()
  pending.shift()!()
  await Promise.all([duplicate, next, queued])
  expect(maximum).toBe(2)
})

it('rejects stale in-flight and queued reads when cookies rotate, even if account epoch is unchanged', async () => {
  let session = { cookie: 'first-cookie', epoch: 1 }
  const pending: (() => void)[] = []
  const invoke = vi.fn(
    (_endpoint: string, args: Record<string, unknown>) =>
      new Promise<ReturnType<typeof response>>((resolve) =>
        pending.push(() => resolve(response(true, String((args.data as any).userId)))),
      ),
  )
  const presence = new PrivatePresence(invoke, () => session)
  const first = presence.get('8').catch((error: Error) => error.message)
  const second = presence.get('9').catch((error: Error) => error.message)
  const queued = presence.get('10').catch((error: Error) => error.message)
  session = { ...session, cookie: 'next-cookie' }
  const next = presence.get('8')
  expect(await first).toContain('账号已变更')
  expect(await second).toContain('账号已变更')
  expect(await queued).toContain('账号已变更')
  pending.shift()!()
  await vi.advanceTimersByTimeAsync(0)
  expect(invoke).toHaveBeenLastCalledWith('api', expect.objectContaining({ cookie: 'next-cookie' }))
  pending.shift()!()
  pending.shift()!()
  expect((await next).online).toBe(true)
  expect(invoke).toHaveBeenCalledTimes(3)
  expect(await presence.get('8')).toEqual(await next)
})

it('rejects a late result after logout without caching online, then allows a fresh login query', async () => {
  let session = { cookie: 'first-cookie', epoch: 1 }
  let finish!: () => void
  const invoke = vi
    .fn(async () => response(false))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(response(true))
        }),
    )
  const presence = new PrivatePresence(invoke, () => session)
  const previous = presence.get('8').catch((error: Error) => error.message)
  session = { cookie: '', epoch: 2 }
  finish()
  expect(await previous).toContain('账号已变更')
  await expect(presence.get('8')).rejects.toThrow('登录')
  session = { cookie: 'new-cookie', epoch: 3 }
  expect((await presence.get('8')).online).toBe(false)
  expect(invoke).toHaveBeenCalledTimes(2)
})

it('bounds retained contact entries and never sends malformed identifiers to the server', async () => {
  const invoke = vi.fn(async (_endpoint: string, args: Record<string, unknown>) =>
    response(true, String((args.data as any).userId)),
  )
  const presence = new PrivatePresence(invoke, () => ({ cookie: 'test', epoch: 1 }))
  for (let id = 1; id <= 257; id++) await presence.get(String(id))
  await presence.get('1')
  expect(invoke).toHaveBeenCalledTimes(258)
  await expect(presence.get('../bad')).rejects.toThrow('联系人')
  expect(invoke).toHaveBeenCalledTimes(258)
})

import { expect, it, vi } from 'vitest'
import { ApiService } from '../src/main/service'
import { multiPayload } from '../src/main/multi-api'
function setup(owner = '123', bizId = '900') {
  const invoke = vi.fn(async (name: string, _args: any): Promise<{ body: any }> => {
    if (name === 'login_status') return { body: { data: { profile: { userId: 123 } } } }
    if (name === 'multiStatus')
      return {
        body: {
          code: 200,
          data: {
            multiLtRoomSnapshot: {
              roomId: 'room',
              roomPlaySongInfo: { playSong: { songId: '111', songBizId: '800' } },
            },
          },
        },
      }
    if (name === 'multiQueue')
      return {
        body: {
          code: 200,
          data: {
            songLists: [{ rcmdUid: owner, songInfo: { bizId, resourceId: '222' } }],
            page: { more: false },
          },
        },
      }
    return { body: { code: 200, data: { failedCode: 0, result: true } } }
  })
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=test')
  return { service, invoke }
}
it('uses distinct delete, UP and room-like operations without affecting red-heart collection', () => {
  for (const [method, operate] of [
    ['multiRemove', 7],
    ['multiUp', 2],
    ['multiLike', 3],
    ['multiRedHeart', 5],
  ] as const)
    expect(
      multiPayload(method, { roomId: 'room', songId: '222', bizId: '900' }, 'token'),
    ).toMatchObject({ operate, songId: '222', bizId: '900', checkToken: 'token' })
})
it('sends red-heart activity only for the authenticated room current business item', async () => {
  const { service, invoke } = setup()
  const current = { roomId: 'room', songId: '111', bizId: '800' }
  expect((await service.call({ method: 'multiRedHeart', args: current })).ok).toBe(true)
  expect(invoke.mock.calls.some(([method]) => method === 'multiRedHeart')).toBe(true)
  invoke.mockClear()
  for (const target of [
    { ...current, roomId: 'other' },
    { ...current, songId: '222' },
    { ...current, bizId: '801' },
  ])
    expect((await service.call({ method: 'multiRedHeart', args: target })).ok).toBe(false)
  expect(invoke.mock.calls.some(([method]) => method === 'multiRedHeart')).toBe(false)
})
it.each([
  { failedCode: 0, result: false },
  { result: true },
  { failedCode: 11, failedMsg: '不允许红心' },
])('requires the room red-heart business acknowledgement %j', async (data) => {
  const { service, invoke } = setup()
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation(async (method, args) =>
    method === 'multiRedHeart' ? { body: { code: 200, data } } : original(method, args),
  )
  expect(
    (
      await service.call({
        method: 'multiRedHeart',
        args: { roomId: 'room', songId: '111', bizId: '800' },
      })
    ).ok,
  ).toBe(false)
})
it('does not announce a red heart when status lookup failed even if a snapshot was included', async () => {
  const { service, invoke } = setup()
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation(async (method, args) => {
    const reply = await original(method, args)
    return method === 'multiStatus' ? { body: { ...reply.body, code: 301 } } : reply
  })
  expect(
    (
      await service.call({
        method: 'multiRedHeart',
        args: { roomId: 'room', songId: '111', bizId: '800' },
      })
    ).ok,
  ).toBe(false)
  expect(invoke.mock.calls.some(([method]) => method === 'multiRedHeart')).toBe(false)
})
it('checks exact business item ownership before removing a recommendation', async () => {
  for (const owner of ['123', '456']) {
    const { service, invoke } = setup(owner)
    const reply = await service.call({
      method: 'multiRemove',
      args: { roomId: 'room', songId: '222', bizId: '900' },
    })
    expect(reply.ok).toBe(owner === '123')
    expect(invoke.mock.calls.some(([name]) => name === 'multiRemove')).toBe(owner === '123')
  }
  const { service, invoke } = setup('123', '901')
  expect(
    (
      await service.call({
        method: 'multiRemove',
        args: { roomId: 'room', songId: '222', bizId: '900' },
      })
    ).ok,
  ).toBe(false)
  expect(invoke.mock.calls.some(([name]) => name === 'multiRemove')).toBe(false)
})
it('rejects a stale current-song like and preserves official UP/delete rejection messages', async () => {
  const { service, invoke } = setup()
  expect(
    (
      await service.call({
        method: 'multiLike',
        args: { roomId: 'room', songId: '222', bizId: '900' },
      })
    ).ok,
  ).toBe(false)
  expect(invoke.mock.calls.some(([name]) => name === 'multiLike')).toBe(false)
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation(async (name, args) =>
    name === 'multiUp'
      ? { body: { code: 200, data: { failedCode: 10007, failedMsg: '已经顶过', result: false } } }
      : original(name, args),
  )
  const reply = await service.call({
    method: 'multiUp',
    args: { roomId: 'room', songId: '222', bizId: '900' },
  })
  expect(reply).toMatchObject({ ok: false, error: '已经顶过' })
})

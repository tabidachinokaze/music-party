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
  ] as const)
    expect(
      multiPayload(method, { roomId: 'room', songId: '222', bizId: '900' }, 'token'),
    ).toMatchObject({ operate, songId: '222', bizId: '900', checkToken: 'token' })
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

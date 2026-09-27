import { describe, expect, it } from 'vitest'
import {
  invitation,
  parseInvitation,
  queueIds,
  redact,
  SerialCommands,
} from '../src/shared/protocol'
describe('invitation parsing', () => {
  it('round trips an opaque room ID and a large inviter ID without precision loss', () => {
    const room = { roomId: 'room-ABC_123', inviterUid: '99999999999999999', role: 'host' as const }
    expect(parseInvitation(`和我一起听：${invitation(room)}`)).toEqual({
      roomId: room.roomId,
      inviterUid: room.inviterUid,
      isFLT: false,
    })
  })
  it.each([
    'https://evil.test/listen-together/share/?roomId=1&inviterId=2',
    'https://st.music.163.com/listen-together/share/?roomId=1',
    'javascript:alert(1)',
    'https://st.music.163.com.evil.test/listen-together/share/?roomId=1&inviterId=2',
  ])('rejects invalid invitations: %s', (input) => expect(() => parseInvitation(input)).toThrow())
})
it('distinguishes unknown queue schema from a confirmed empty queue', () => {
  expect(queueIds({ data: {} })).toBeNull()
  expect(queueIds({ data: { playlist: { displayList: { result: [] } } } })).toEqual([])
})
it('redacts nested credentials and media URLs', () => {
  const result = JSON.stringify(
    redact({
      cookie: 'secret',
      nested: [{ MUSIC_U: 'ok', url: 'https://music.test/token' }],
      message: 'MUSIC_U=secret; failed https://music.test/private',
      qrimg: 'base64',
    }),
  )
  expect(result).not.toContain('secret')
  expect(result).not.toContain('https://')
  expect(result).not.toContain('base64')
})
it('serializes competing commands and keeps advancing after rejection', async () => {
  const serial = new SerialCommands()
  const seen: number[] = []
  const first = serial.run(async (seq) => {
    await new Promise((r) => setTimeout(r, 10))
    seen.push(seq)
    throw new Error('fail')
  })
  const second = serial.run(async (seq) => {
    seen.push(seq)
    return seq
  })
  await expect(first).rejects.toThrow('fail')
  await expect(second).resolves.toBe(2)
  expect(seen).toEqual([1, 2])
})

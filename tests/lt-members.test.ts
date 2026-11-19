import { expect, it } from 'vitest'
import { parseLtMemberUpdate } from '../src/shared/lt-members'

const content = {
  version: 12,
  onlineNums: 3,
  onlineUserInfos: [
    { uid: 1, nickname: 'alice', avatar: 'https://p1.music.126.net/a.jpg' },
    { uid: '2', nickname: '', avatarUrl: 'https://p1.music.126.net/b.jpg' },
    { uid: 2, nickname: 'duplicate' },
    { uid: -1, nickname: 'invalid' },
  ],
}
const envelope = (value: unknown) => ({
  msgType: 133,
  bizType: 'music_listenTogether_multi_match_song',
  serverExt: { type: 30005, content: value },
})

it('parses a 30005 member change into a complete room user list', () => {
  expect(parseLtMemberUpdate(envelope(content))).toEqual({
    roomId: '',
    version: 12,
    onlineCount: 3,
    members: [
      { uid: '1', nickname: 'alice', avatar: 'https://p1.music.126.net/a.jpg' },
      { uid: '2', nickname: '听友', avatar: 'https://p1.music.126.net/b.jpg' },
    ],
  })
})

it('accepts stringified serverExt and content because both wire paths exist', () => {
  const value = { ...content, roomId: 'room_1' }
  expect(
    parseLtMemberUpdate({
      serverExt: JSON.stringify({ type: '30005', content: JSON.stringify(value) }),
    }),
  ).toMatchObject({ roomId: 'room_1', version: 12, onlineCount: 3 })
})

it('reads the chatroom message remoteExtension shape as well', () => {
  expect(
    parseLtMemberUpdate({
      remoteExtension: { serverExt: { type: 30005, content } },
    }),
  ).toMatchObject({ version: 12, members: [{ uid: '1' }, { uid: '2' }] })
})

it('ignores every other IM business and malformed payload', () => {
  expect(parseLtMemberUpdate({ serverExt: { type: 30004, content } })).toBeNull()
  expect(parseLtMemberUpdate({ serverExt: { type: 30005 } })).toBeNull()
  expect(parseLtMemberUpdate({ serverExt: { type: 30005, content: [] } })).toBeNull()
  expect(parseLtMemberUpdate('not json')).toBeNull()
  expect(parseLtMemberUpdate(null)).toBeNull()
})

it('rejects an oversized member list instead of freezing the renderer', () => {
  expect(
    parseLtMemberUpdate(
      envelope({ onlineUserInfos: Array.from({ length: 501 }, (_, i) => ({ uid: i + 1 })) }),
    ),
  ).toBeNull()
})

it('falls back to the parsed member count when onlineNums is missing', () => {
  expect(
    parseLtMemberUpdate(envelope({ version: 1, onlineUserInfos: [{ uid: 7, nickname: 'x' }] })),
  ).toMatchObject({ version: 1, onlineCount: 1, members: [{ uid: '7' }] })
})

it('uses serverSeq as the ordering version in the real 30005 chatroom payload', () => {
  expect(
    parseLtMemberUpdate(
      JSON.stringify({
        serverExt: {
          type: 30005,
          bizType: 3,
          content: {
            serverSeq: 1795098772586,
            roomId: '81b1cd4b1a5a61782a24b8ab9e054217_1795088351662',
            onlineNums: 2,
            onlineUserInfos: [
              { uid: 1444540056, avatar: 'http://p3.music.126.net/a.jpg', nickname: 'a' },
              { uid: 12625392267, avatar: 'http://p3.music.126.net/b.jpg', nickname: 'b' },
            ],
            version: 160,
          },
        },
      }),
    ),
  ).toMatchObject({
    roomId: '81b1cd4b1a5a61782a24b8ab9e054217_1795088351662',
    version: 160,
    onlineCount: 2,
    members: [{ uid: '1444540056' }, { uid: '12625392267' }],
  })
})

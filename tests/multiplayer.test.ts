import { expect, it, vi } from 'vitest'
import { parseInvitation, invitation } from '../src/shared/protocol'
import {
  parseSnapshot,
  parseRoomPlayback,
  targetPosition,
  shouldAccept,
  heartbeatInterval,
  roomTypeLabel,
} from '../src/shared/multiplayer'
import { multiPayload } from '../src/main/multi-api'
import { ApiService } from '../src/main/service'
import { RoomPlayer, type AudioPort } from '../src/renderer/src/room-player'
import type { RoomPlayback, Song } from '../src/shared/types'
const info = (overrides = {}) => ({
  playSong: { songId: '123', songBizId: '999', songRcmdUid: '12' },
  nextSongs: [],
  version: 2,
  playedTime: 5000,
  songDuration: 200000,
  ...overrides,
})
const state = (overrides = {}): RoomPlayback => parseRoomPlayback(info(overrides), 1000)!

it.each([
  [1, 1, '私密好友房'],
  ['2', 2, '公开好友房'],
  [3, 3, '公开匹配房'],
  [99, 99, '房间类型未知'],
  ['future', 'future', '房间类型未知'],
  [undefined, null, '房间类型未知'],
])(
  'reads real room business type %s without inferring it from other fields',
  (raw, expected, label) => {
    const snapshot = parseSnapshot(
      { roomId: 'r', multiRoomInfoDTO: { roomBizType: raw, roomType: 2 } },
      1000,
    )
    expect(snapshot.roomBizType).toBe(expected)
    expect(roomTypeLabel(snapshot.roomBizType)).toBe(label)
  },
)
it('creates a public friend room and rematches without inviting any contacts', () => {
  expect(multiPayload('multiCreate', { songId: '123', allowStrangerMatch: true }, 'token')).toEqual(
    {
      type: 2,
      songId: '123',
      groupIds: '[]',
      inviteUids: '[]',
      checkToken: 'token',
    },
  )
  expect(multiPayload('multiMatch', { songId: '123' }, 'token')).toEqual({
    songId: '123',
    checkToken: 'token',
  })
  expect(multiPayload('multiMatchCancel', {})).toEqual({})
  expect(multiPayload('multiRematchLeave', { roomId: 'r' })).toEqual({
    roomId: 'r',
    exitType: 'CHANGE_ROOM',
  })
})

it('parses markdown official multi invitations and preserves large inviter IDs', () => {
  const room = { roomId: 'test-room_123', inviterUid: '99999999999999999', role: 'host' as const }
  const link = invitation(room)
  expect(parseInvitation(`[邀请](${link})`)).toEqual({
    roomId: room.roomId,
    inviterUid: room.inviterUid,
    isFLT: false,
  })
})
it.each(['&', String.raw`\&`, '&amp;', '&#38;', '&#x26;'])(
  'accepts clipboard query separators %s',
  (separator) => {
    const link = `https://st.music.163.com/listen-together/multishare/index.html?roomId=test_123${separator}inviterUid=456${separator}isFLT=false`
    for (const text of [link, `[一起听](${link})`, `[${link}](${link})`]) {
      expect(parseInvitation(text)).toEqual({ roomId: 'test_123', inviterUid: '456', isFLT: false })
    }
  },
)
it('validates the Markdown destination instead of trusting a different visible label', () => {
  const label =
    'https://st.music.163.com/listen-together/multishare/index.html?roomId=r&inviterUid=1'
  expect(() => parseInvitation(`[${label}](https://evil.test/invite)`)).toThrow('官方多人邀请')
})
it('uses the actual upcoming songs when the server omits waitSongCount', () => {
  const playback = parseRoomPlayback(
    info({ nextSongs: [{ songId: '456', songBizId: '1000' }] }),
    1000,
  )!
  expect(playback.waitSongCount).toBe(1)
})
it.each([
  'https://st.music.163.com/listen-together/share/?roomId=a&inviterId=1',
  'https://st.music.163.com/listen-together/multishare/index.html?roomId=a&inviterUid=1&isFLT=true',
  'https://st.music.163.com/listen-together/multishare/index.html?roomId=a&roomId=b&inviterUid=1',
  'https://st.music.163.com.evil.test/listen-together/multishare/index.html?roomId=a&inviterUid=1',
])('never treats pair/follow/malformed invitations as a multi room: %s', (link) =>
  expect(() => parseInvitation(link)).toThrow(),
)
it('parses three members and independently checks song business IDs', () => {
  const snapshot = parseSnapshot(
    {
      roomId: 'r',
      roomPlaySongInfo: info(),
      roomUserList: {
        onlineNums: 3,
        onlineUserInfos: [1, 2, 3].map((uid) => ({ uid, nickname: `user${uid}` })),
      },
    },
    1000,
  )
  expect(snapshot.members).toHaveLength(3)
  expect(snapshot.onlineCount).toBe(3)
  expect(() =>
    parseRoomPlayback(info({ playSong: { songId: 123, songBizId: 999999999999999999 } }), 1000),
  ).toThrow('精度')
})
it('advances milliseconds using the sample time and rejects delayed stale snapshots', () => {
  expect(targetPosition(state(), 2500)).toBe(6500)
  expect(shouldAccept(state(), { ...state(), version: 1 })).toBe(false)
  expect(shouldAccept(state(), { ...state(), sampledAt: 500 })).toBe(false)
  expect(heartbeatInterval(10)).toBe(10000)
  expect(heartbeatInterval(0)).toBe(5000)
})
it('uses official friend-room, add-song and leave payloads without inviting other accounts automatically', () => {
  expect(multiPayload('multiCreate', { songId: '123' }, 't')).toEqual({
    type: 1,
    songId: '123',
    groupIds: '[]',
    inviteUids: '[]',
    checkToken: 't',
  })
  expect(multiPayload('multiAdd', { roomId: 'r', songId: '123' }, 't')).toEqual({
    roomId: 'r',
    songId: '123',
    bizId: '0',
    operate: 1,
    checkToken: 't',
  })
  expect(multiPayload('multiLeave', { roomId: 'r' })).toEqual({
    roomId: 'r',
    exitType: 'NORMAL_END',
  })
})
it('reports business rejection even when upstream HTTP code is 200', async () => {
  const service = new ApiService(async () => ({
    body: { code: 200, data: { failedCode: 10000, failedMsg: '没有切歌权限' } },
  }))
  service.restore('MUSIC_U=test')
  const reply = await service.call({
    method: 'multiNext',
    args: { roomId: 'r', songId: '123', bizId: '999' },
  })
  expect(reply.ok).toBe(false)
  expect(reply.error).toBe('没有切歌权限')
  expect(reply.trace?.response).toMatchObject({ body: { data: { failedCode: 10000 } } })
})
it('retains the expired-room code and rejects the legacy pair API at the boundary', async () => {
  const service = new ApiService(async () => {
    throw { body: { code: 488, message: '失效' } }
  })
  service.restore('MUSIC_U=test')
  expect((await service.call({ method: 'multiHeartbeat', args: { roomId: 'r' } })).code).toBe(488)
  expect((await service.call({ method: 'roomCreate' as any })).ok).toBe(false)
})
class FakeAudio extends EventTarget implements AudioPort {
  src = ''
  currentTime = 0
  duration = 200
  readyState = 1
  paused = true
  pause() {
    this.paused = true
  }
  play = vi.fn(async () => {
    this.paused = false
  })
  load() {
    queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')))
  }
}
const track = (id: string) => ({
  song: { id, name: id, artist: '', album: '', cover: '', duration: 200000 } as Song,
  url: `https://audio.test/${id}`,
})
it('does not replay a completed business item when the first post-end snapshot still points to it', async () => {
  const audio = new FakeAudio()
  const player = new RoomPlayer(
    audio,
    async (id) => track(id),
    vi.fn(),
    () => 2000,
  )
  await player.apply(state())
  audio.pause()
  player.ended()
  const before = audio.play.mock.calls.length
  await player.apply({ ...state(), sampledAt: 2000 })
  await player.setListening(true)
  expect(audio.play).toHaveBeenCalledTimes(before)
  await player.apply({
    ...state({ version: 3, playSong: { songId: '123', songBizId: '1000' } }),
    sampledAt: 2000,
  })
  expect(audio.play).toHaveBeenCalledTimes(before + 1)
})
it('applies remote state without publishing commands and keeps a local pause through updates', async () => {
  const audio = new FakeAudio()
  const changed = vi.fn()
  const player = new RoomPlayer(
    audio,
    async (id) => track(id),
    changed,
    () => 2000,
  )
  await player.apply(state())
  expect(audio.currentTime).toBe(6)
  expect(audio.paused).toBe(false)
  await player.setListening(false)
  await player.apply({ ...state(), sampledAt: 2000, playedTime: 15000 })
  expect(audio.paused).toBe(true)
  await player.setListening(true)
  expect(audio.currentTime).toBe(15)
  expect(audio.paused).toBe(false)
})
it('prevents a late song URL from replacing the newer remote song', async () => {
  const audio = new FakeAudio()
  let resolveFirst!: (value: ReturnType<typeof track>) => void
  const player = new RoomPlayer(
    audio,
    (id) =>
      id === '123'
        ? new Promise((resolve) => {
            resolveFirst = resolve
          })
        : Promise.resolve(track(id)),
    vi.fn(),
    () => 2000,
  )
  const first = player.apply(state())
  await player.apply(state({ version: 3, playSong: { songId: '456', songBizId: '1000' } }))
  resolveFirst(track('123'))
  await first
  expect(audio.src).toBe('https://audio.test/456')
})
it('leaving during an audio request cannot restart playback', async () => {
  const audio = new FakeAudio()
  let resolve!: (value: ReturnType<typeof track>) => void
  const player = new RoomPlayer(
    audio,
    () =>
      new Promise((r) => {
        resolve = r
      }),
    vi.fn(),
  )
  const work = player.apply(state())
  player.reset()
  resolve(track('123'))
  await work
  expect(audio.paused).toBe(true)
  expect(audio.src).toBe('')
})
it('rejects creation without a real initial song before contacting upstream', async () => {
  const invoke = vi.fn()
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=test')
  const result = await service.call({ method: 'multiCreate', args: { songId: '0' } })
  expect(result.ok).toBe(false)
  expect(result.error).toContain('匹配用歌曲')
  expect(invoke).not.toHaveBeenCalled()
})
it('explains the official initial-song rejection and preserves protocol evidence', async () => {
  const service = new ApiService(async () => ({
    body: {
      code: 200,
      data: { success: false, failedType: 'MULTI_SONG_NOT_SATISFIED', failedMessage: '' },
    },
  }))
  service.restore('MUSIC_U=test')
  const result = await service.call({ method: 'multiCreate', args: { songId: '123' } })
  expect(result.ok).toBe(false)
  expect(result.error).toContain('开房条件')
  expect(JSON.stringify(result.trace)).toContain('MULTI_SONG_NOT_SATISFIED')
})
it('preserves local pause across reconnect while allowing a fresh server snapshot', async () => {
  const audio = new FakeAudio()
  const player = new RoomPlayer(
    audio,
    async (id) => track(id),
    vi.fn(),
    () => 2000,
  )
  await player.apply(state())
  await player.setListening(false)
  player.suspend()
  await player.apply(state({ version: 3, playSong: { songId: '456', songBizId: '1000' } }))
  expect(audio.paused).toBe(true)
  expect(audio.src).toBe('https://audio.test/456')
  await player.setListening(true)
  expect(audio.paused).toBe(false)
  expect(audio.currentTime).toBe(6)
})

it('keeps local audition through remote track changes and returns to the latest room timeline', async () => {
  const audio = new FakeAudio()
  const changed = vi.fn()
  const auditionChanged = vi.fn()
  const player = new RoomPlayer(
    audio,
    async (id) => track(id),
    changed,
    () => 2000,
    auditionChanged,
  )
  await player.apply(state())
  await player.audition('777')
  expect(audio.src).toBe('https://audio.test/777')
  expect(audio.currentTime).toBe(0)
  expect(player.auditioning).toBe(true)
  player.seekAudition(32000)
  await player.apply(state({ version: 3, playSong: { songId: '456', songBizId: '1000' } }))
  expect(audio.src).toBe('https://audio.test/777')
  expect(audio.currentTime).toBe(32)
  expect(changed.mock.calls.at(-1)?.[0].id).toBe('777')
  await player.returnToRoom()
  expect(audio.src).toBe('https://audio.test/456')
  expect(audio.currentTime).toBe(6)
  expect(audio.paused).toBe(false)
  expect(auditionChanged.mock.calls).toEqual([[true], [false]])
})

it('preserves the room listening preference independently of audition pause', async () => {
  const audio = new FakeAudio()
  const player = new RoomPlayer(
    audio,
    async (id) => track(id),
    vi.fn(),
    () => 2000,
  )
  await player.apply(state())
  await player.setListening(false)
  await player.audition('777')
  expect(audio.paused).toBe(false)
  await player.returnToRoom()
  expect(audio.paused).toBe(true)
  await player.setListening(true)
  await player.audition('777')
  await player.setListening(false)
  expect(audio.paused).toBe(true)
  await player.returnToRoom()
  expect(audio.paused).toBe(false)
})

it('returns automatically when local audition ends without ending the room item', async () => {
  const audio = new FakeAudio()
  const player = new RoomPlayer(
    audio,
    async (id) => track(id),
    vi.fn(),
    () => 2000,
  )
  await player.apply(state())
  await player.audition('777')
  audio.pause()
  await player.ended()
  expect(player.auditioning).toBe(false)
  expect(audio.src).toBe('https://audio.test/123')
  expect(audio.paused).toBe(false)
})

it('cancels an unfinished audition so a late source cannot replace room playback', async () => {
  const audio = new FakeAudio()
  let resolveAudition!: (value: ReturnType<typeof track>) => void
  const player = new RoomPlayer(
    audio,
    (id) =>
      id === '777'
        ? new Promise((resolve) => {
            resolveAudition = resolve
          })
        : Promise.resolve(track(id)),
    vi.fn(),
    () => 2000,
  )
  await player.apply(state())
  const pending = player.audition('777')
  await player.returnToRoom()
  resolveAudition(track('777'))
  await pending
  expect(audio.src).toBe('https://audio.test/123')
  expect(player.auditioning).toBe(false)
})

it('restores the room after audition failure and requests the audition source as a preview', async () => {
  const audio = new FakeAudio()
  const resolve = vi.fn(async (id: string, audition?: boolean) => {
    if (id === '777') throw new Error('试听不可用')
    return track(id)
  })
  const player = new RoomPlayer(audio, resolve, vi.fn(), () => 2000)
  await player.apply(state())
  await expect(player.audition('777')).rejects.toThrow('试听不可用')
  expect(resolve).toHaveBeenCalledWith('777', true)
  expect(audio.src).toBe('https://audio.test/123')
  expect(audio.paused).toBe(false)
  expect(player.auditioning).toBe(false)
})

it('leaving while an audition loads cannot restart audio or restore an obsolete room', async () => {
  const audio = new FakeAudio()
  let resolveAudition!: (value: ReturnType<typeof track>) => void
  const player = new RoomPlayer(
    audio,
    (id) =>
      id === '777'
        ? new Promise((resolve) => {
            resolveAudition = resolve
          })
        : Promise.resolve(track(id)),
    vi.fn(),
    () => 2000,
  )
  await player.apply(state())
  const pending = player.audition('777')
  player.reset()
  resolveAudition(track('777'))
  await pending
  expect(audio.paused).toBe(true)
  expect(player.auditioning).toBe(false)
})

import { expect, it, vi } from 'vitest'
import { multiEndpoints, multiPayload } from '../src/main/multi-api'
import { ApiService } from '../src/main/service'
import type { RoomPlayback, RoomQueueEntry, Song } from '../src/shared/types'
import {
  currentMemberRecommendation,
  currentRecommendationOwner,
  loadMemberRecommendations,
  memberRecommendationGroups,
} from '../src/renderer/src/member-recommendations'

const song: Song = {
  id: '1',
  name: '同一首歌',
  artist: '歌手',
  album: '',
  cover: '',
  duration: 30_000,
}
function entry(bizId: string, uid = '9'): RoomQueueEntry {
  return {
    songId: '1',
    songBizId: bizId,
    songRcmdUid: uid,
    track: song,
    recommender: '推荐人',
    selfRecommended: uid === '9',
    uped: false,
    upCount: 4,
    liked: false,
    likeCount: 2,
  }
}
const playback: RoomPlayback = {
  song: { songId: '1', songBizId: '101', songRcmdUid: '9' },
  nextSongs: [],
  version: 1,
  playedTime: 0,
  duration: 30_000,
  sampledAt: 0,
  forceSync: false,
  waitSongCount: 1,
  likeCount: 12,
}
const page = (bizIds: string[], cursor?: string) => ({
  data: {
    songLists: bizIds.map((bizId) => ({
      songInfo: { resourceId: '1', bizId, title: song.name, artistName: ['歌手'] },
      rcmdUid: '9',
    })),
    page: { more: !!cursor, cursor },
  },
})

it('uses the official played-list route, sort and cursor with closed service validation', async () => {
  expect(multiEndpoints.multiPlayed).toBe('/api/listen/together/multi/match/played/song/list')
  expect(multiPayload('multiPlayed', { roomId: 'room', cursor: 'next' })).toEqual({
    roomId: 'room',
    sort: 1,
    page: '{"size":20,"cursor":"next"}',
  })
  const invoke = vi.fn(async (_method: string, _args: Record<string, unknown>) => ({
      body: { code: 200, ...page(['100']) },
    })),
    service = new ApiService(invoke)
  expect((await service.call({ method: 'multiPlayed', args: { roomId: 'room' } })).ok).toBe(false)
  expect(invoke).not.toHaveBeenCalled()
  service.restore('MUSIC_U=test')
  expect(
    (await service.call({ method: 'multiPlayed', args: { roomId: 'room', cursor: 'next' } })).ok,
  ).toBe(true)
  expect(invoke.mock.calls[0]?.[0]).toBe('multiPlayed')
  expect(
    (
      await service.call({
        method: 'multiPlayed',
        args: { roomId: 'room', cursor: '', uri: '/anything' },
      })
    ).ok,
  ).toBe(false)
})

it('includes current playback before history catches up and keeps occurrences distinct', () => {
  const current = currentMemberRecommendation(playback, [], song)!
  expect(current.track).toEqual(song)
  expect(current.likeCount).toBe(12)
  const groups = memberRecommendationGroups(
    '9',
    [entry('101'), entry('100'), entry('102')],
    [entry('101'), entry('102'), entry('102'), entry('103', '8')],
    current,
  )
  expect(groups.played.map((row) => [row.songBizId, row.likeCount])).toEqual([
    ['101', 12],
    ['100', 2],
  ])
  expect(groups.waiting.map((row) => row.songBizId)).toEqual(['102'])
})

it('keeps system and departed recommenders distinct and rejects stale owner metadata', () => {
  const departed = currentMemberRecommendation(playback, [entry('101')], null)!
  expect(currentRecommendationOwner([], departed)).toEqual({
    uid: '9',
    nickname: '推荐人',
    avatar: '',
  })
  const changed = currentMemberRecommendation(playback, [entry('101', '8')], null)!
  expect(currentRecommendationOwner([], changed)?.nickname).toBe('听友')
  const system = currentMemberRecommendation(
    { ...playback, song: { ...playback.song!, songRcmdUid: '0' } },
    [],
    { ...song, id: '2', name: '另一首歌' },
  )!
  expect(system.track.name).toBe('正在读取房间歌曲…')
  expect(currentRecommendationOwner([], system)?.nickname).toBe('系统推荐')
  expect(memberRecommendationGroups('9', [], [], system).played).toEqual([])
  expect(currentMemberRecommendation(null, [], song)).toBeNull()
})

it.each(['multiQueue', 'multiPlayed'] as const)(
  'loads every %s page by business ID, accepting an advancing empty page',
  async (method) => {
    const api = vi.fn(async (_method, args) =>
      !args?.cursor
        ? page(['101', '102'], 'empty')
        : args.cursor === 'empty'
          ? page([], 'tail')
          : page(['102', '103']),
    )
    const result = await loadMemberRecommendations(api, 'room', () => true, method)
    expect(result.map((row) => row.songBizId)).toEqual(['101', '102', '103'])
    expect(api.mock.calls.map(([name, args]) => [name, args?.cursor || ''])).toEqual([
      [method, ''],
      [method, 'empty'],
      [method, 'tail'],
    ])
  },
)

it('stops a repeated cursor and discards a late response after a room or account change', async () => {
  const repeat = vi.fn(async () => page(['101'], 'same'))
  await expect(
    loadMemberRecommendations(repeat, 'room', () => true, 'multiPlayed'),
  ).rejects.toThrow('继续前进')
  expect(repeat).toHaveBeenCalledTimes(2)
  let active = true,
    resolve!: (value: any) => void
  const api = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = loadMemberRecommendations(api, 'room', () => active, 'multiPlayed')
  active = false
  resolve(page(['101'], 'next'))
  expect(await pending).toEqual([])
  expect(api).toHaveBeenCalledTimes(1)
})

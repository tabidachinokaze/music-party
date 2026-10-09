import { expect, it } from 'vitest'
import { parseRoomQueue, waitingCount, waitingSongs } from '../src/shared/playback-queue'
import { multiPayload } from '../src/main/multi-api'
import type { QueueSong, RoomPlayback } from '../src/shared/types'
const entry = (id: string, bizId: string): QueueSong => ({
  songId: id,
  songBizId: bizId,
  songRcmdUid: '1',
})
it('uses the official wait-list cursor, including distinct business items of the same song', () => {
  expect(multiPayload('multiQueue', { roomId: 'r', cursor: 'next' })).toEqual({
    roomId: 'r',
    page: '{"size":20,"cursor":"next"}',
  })
  const page = parseRoomQueue({
    data: {
      songLists: [1, 2].map((id) => ({
        songInfo: {
          resourceId: 10,
          bizId: id,
          title: '歌名',
          coverUrl: 'https://p1.music.126.net/a.jpg',
          artistName: ['A', 'B'],
        },
        rcmdUid: 3,
        nickname: '推荐者',
      })),
      page: { more: true, cursor: 'next' },
    },
  })
  expect(page.entries.map((row) => row.songBizId)).toEqual(['1', '2'])
  expect(page.entries[0]).toMatchObject({
    recommender: '推荐者',
    track: { id: '10', name: '歌名', artist: 'A / B' },
  })
  expect(() => parseRoomQueue({ data: {} })).toThrow('响应异常')
})
it('shows pending entries in server order and excludes only the current business item', () => {
  expect(
    waitingSongs(
      [entry('10', 'current'), entry('20', 'b'), entry('10', 'c'), entry('20', 'b')],
      'current',
    ),
  ).toEqual([entry('20', 'b'), entry('10', 'c')])
})
it('reads promotion state inside songInfo and distinguishes missing counts from zero', () => {
  const page = parseRoomQueue({
    data: {
      songLists: [
        { rcmdUid: 1, uped: false, songInfo: { resourceId: 10, bizId: 1, uped: true } },
        { rcmdUid: 1, uped: true, songInfo: { resourceId: 10, bizId: 2, uped: false, upCnt: 0 } },
      ],
      page: { more: false },
    },
  })
  expect(page.entries[0]).toMatchObject({ uped: true, upCount: 0, upCountKnown: false })
  expect(page.entries[1]).toMatchObject({ uped: false, upCount: 0, upCountKnown: true })
})
it('distinguishes an unknown queue from an empty one and never understates visible pending tracks', () => {
  expect(waitingCount(null)).toBeUndefined()
  const state: RoomPlayback = {
    song: entry('10', 'current'),
    nextSongs: [entry('20', 'b')],
    waitSongCount: 0,
    version: 1,
    playedTime: 0,
    duration: 30000,
    sampledAt: 0,
    forceSync: false,
  }
  expect(waitingCount(state)).toBe(1)
  expect(waitingCount({ ...state, waitSongCount: 20 })).toBe(20)
})

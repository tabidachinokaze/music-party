import { expect, it, vi } from 'vitest'
import { buildRoomQueueHandoff, loadRoomQueueHandoff } from '../src/renderer/src/room-queue-handoff'
import type { QueueSong, RoomPlayback } from '../src/shared/types'

const entry = (songBizId: string, songId = songBizId): QueueSong => ({
  songBizId,
  songId,
  songRcmdUid: '1',
})
const playback = (song: QueueSong | null, nextSongs: QueueSong[] = []): RoomPlayback => ({
  song,
  nextSongs,
  version: 1,
  playedTime: 0,
  sampledAt: 0,
  duration: 60000,
  waitSongCount: nextSongs.length,
  forceSync: false,
})
const page = (rows: QueueSong[], cursor?: string) => ({
  data: {
    songLists: rows.map(({ songBizId, songId }) => ({
      songInfo: { bizId: songBizId, resourceId: songId },
    })),
    page: { more: !!cursor, cursor },
  },
})

it('reads every played and waiting page and preserves repeat performances on either side of the current track', async () => {
  const current = entry('101', '4')
  const api = vi.fn(async (method, args) => {
    if (method === 'multiPlayed') {
      return args?.cursor
        ? page([entry('99', '7'), entry('98', '4')])
        : page([current, entry('99', '7')], 'older')
    }
    return args?.cursor
      ? page([entry('104', '6')])
      : page([current, entry('102', '5'), entry('103', '4')], 'later')
  })
  const lists = await loadRoomQueueHandoff(api, 'room', () => true)
  expect(buildRoomQueueHandoff(lists, playback(current), current)).toEqual({
    ids: ['4', '7', '4', '5', '4', '6'],
    index: 2,
  })
  expect(api).toHaveBeenCalledTimes(4)
  expect(api).toHaveBeenCalledWith('multiPlayed', { roomId: 'room', cursor: 'older' })
  expect(api).toHaveBeenCalledWith('multiQueue', { roomId: 'room', cursor: 'later' })
})

it('carries newly passed occurrences into history and uses the last heartbeat before leaving', () => {
  const original = entry('2'),
    current = entry('4', '2')
  const lists = { played: [entry('1')], waiting: [entry('3'), current, entry('5'), entry('6')] }
  expect(
    buildRoomQueueHandoff(lists, playback(current, [entry('7'), entry('5')]), original),
  ).toEqual({
    ids: ['1', '2', '3', '2', '7', '5', '6'],
    index: 3,
  })
})

it('keeps overlapping history before the current occurrence, including a lagging history page during a skip', () => {
  const current = entry('4')
  expect(
    buildRoomQueueHandoff(
      { played: [current, entry('3'), entry('1')], waiting: [entry('3'), current, entry('5')] },
      playback(current),
      current,
    ),
  ).toEqual({ ids: ['1', '3', '4', '5'], index: 2 })
  expect(
    buildRoomQueueHandoff(
      { played: [entry('1')], waiting: [entry('3'), current, entry('5')] },
      playback(current),
      current,
    ),
  ).toEqual({ ids: ['1', '3', '4', '5'], index: 2 })
  expect(
    buildRoomQueueHandoff(
      { played: [entry('3'), entry('1')], waiting: [entry('3'), current, entry('5')] },
      playback(current),
      entry('2'),
    ),
  ).toEqual({ ids: ['1', '2', '3', '4', '5'], index: 3 })
})

it('chooses the first upcoming song or the last played song when the room is idle', () => {
  const played = [entry('2'), entry('1')]
  expect(buildRoomQueueHandoff({ played, waiting: [entry('3')] }, playback(null))).toEqual({
    ids: ['1', '2', '3'],
    index: 2,
  })
  expect(buildRoomQueueHandoff({ played, waiting: [] }, null)).toEqual({
    ids: ['1', '2'],
    index: 1,
  })
  expect(buildRoomQueueHandoff({ played: [], waiting: [] }, null)).toEqual({ ids: [], index: -1 })
})

it('propagates pagination failures so a partial queue cannot silently replace personal playback', async () => {
  const api = vi.fn(async (method, args) => {
    if (method === 'multiQueue' && args?.cursor) throw new Error('queue unavailable')
    return page([entry('1')], method === 'multiQueue' ? 'later' : undefined)
  })
  await expect(loadRoomQueueHandoff(api, 'room', () => true)).rejects.toThrow('queue unavailable')
})

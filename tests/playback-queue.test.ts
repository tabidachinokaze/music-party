import { expect, it } from 'vitest'
import { waitingCount, waitingSongs } from '../src/shared/playback-queue'
import type { QueueSong, RoomPlayback } from '../src/shared/types'
const entry = (id: string, bizId: string): QueueSong => ({
  songId: id,
  songBizId: bizId,
  songRcmdUid: '1',
})
it('shows pending entries in server order and excludes only the current business item', () => {
  expect(
    waitingSongs(
      [entry('10', 'current'), entry('20', 'b'), entry('10', 'c'), entry('20', 'b')],
      'current',
    ),
  ).toEqual([entry('20', 'b'), entry('10', 'c')])
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

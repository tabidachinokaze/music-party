import type { QueueSong, RoomPlayback } from '../../shared/types'
import { waitingSongs } from '../../shared/playback-queue'
import { loadMemberRecommendations } from './member-recommendations'
import type { ApiCall } from './music-data'

/** Fetch both full lists while the account still has access to the room. */
export async function loadRoomQueueHandoff(api: ApiCall, roomId: string, current: () => boolean) {
  let loading = true
  const active = () => loading && current()
  try {
    const [played, waiting] = await Promise.all([
      loadMemberRecommendations(api, roomId, active, 'multiPlayed'),
      loadMemberRecommendations(api, roomId, active, 'multiQueue'),
    ])
    return { played, waiting }
  } finally {
    loading = false
  }
}

function chronologicalHistory(played: readonly QueueSong[], passed: readonly QueueSong[]) {
  const passedIndexes = new Map(passed.map((entry, index) => [entry.songBizId, index]))
  const history: QueueSong[] = []
  let next = 0
  // Fill any missing occurrences before their first known successor in the server history.
  for (const entry of [...played].reverse()) {
    const index = passedIndexes.get(entry.songBizId)
    if (index === undefined) history.push(entry)
    else while (next <= index) history.push(passed[next++])
  }
  return history.concat(passed.slice(next))
}

/** Keep occurrence identity until we know the personal queue's exact playback index. */
export function buildRoomQueueHandoff(
  lists: { played: readonly QueueSong[]; waiting: readonly QueueSong[] },
  playback: RoomPlayback | null,
  initialSong?: QueueSong | null,
): { ids: string[]; index: number } {
  const current = playback?.song
  const advanced = initialSong !== undefined && initialSong?.songBizId !== current?.songBizId
  const boundary = lists.waiting.findIndex((entry) => entry.songBizId === current?.songBizId)
  // The final heartbeat can advance the queue after either paged request completes.
  const passed = boundary < 0 ? [] : lists.waiting.slice(0, boundary)
  if (advanced && initialSong && !passed.some((entry) => entry.songBizId === initialSong.songBizId))
    passed.unshift(initialSong)
  const pending = waitingSongs(
    [...(advanced ? (playback?.nextSongs ?? []) : []), ...lists.waiting.slice(boundary + 1)],
    current?.songBizId,
  ).filter((entry) => entry.songBizId !== initialSong?.songBizId)
  const pendingIds = new Set(pending.map((entry) => entry.songBizId))
  // multiPlayed is newest first, including occasional overlaps with current and waiting.
  const history = waitingSongs(
    chronologicalHistory(lists.played, passed),
    current?.songBizId,
  ).filter((entry) => !pendingIds.has(entry.songBizId))
  const ids = [...history, ...(current ? [current] : []), ...pending].map((entry) => entry.songId)
  return { ids, index: Math.min(history.length, ids.length - 1) }
}

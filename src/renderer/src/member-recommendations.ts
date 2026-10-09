// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from folium-mod-music-party/src/client/member-recommendations.ts and room-data.ts
// at b01525f. See THIRD_PARTY_NOTICES.md.
import type { Member, RoomPlayback, RoomQueueEntry, Song } from '../../shared/types'
import { parseRoomQueue } from '../../shared/playback-queue'
import type { ApiCall } from './music-data'

export async function loadMemberRecommendations(
  api: ApiCall,
  roomId: string,
  current: () => boolean,
  method: 'multiQueue' | 'multiPlayed',
): Promise<RoomQueueEntry[]> {
  const rows = new Map<string, RoomQueueEntry>(),
    seen = new Set<string>([''])
  let cursor = ''
  while (current()) {
    const page = parseRoomQueue(await api(method, { roomId, ...(cursor ? { cursor } : {}) }))
    if (!current()) return []
    for (const entry of page.entries) rows.set(entry.songBizId, entry)
    if (!page.more) return [...rows.values()]
    if (!page.cursor || seen.has(page.cursor) || seen.size >= 1000)
      throw new Error('推荐记录分页没有继续前进，请刷新重试')
    seen.add(page.cursor)
    cursor = page.cursor
  }
  return []
}

/** The current occurrence may precede its appearance in the played-history endpoint. */
export function currentMemberRecommendation(
  playback: RoomPlayback | null,
  entries: readonly RoomQueueEntry[],
  metadata: Song | null,
): RoomQueueEntry | null {
  const current = playback?.song
  if (!current) return null
  const known = entries.find((entry) => entry.songBizId === current.songBizId),
    song = metadata?.id === current.songId ? metadata : null
  return {
    ...current,
    track: known?.track ||
      song || {
        id: current.songId,
        name: '正在读取房间歌曲…',
        artist: '',
        album: '',
        cover: '',
        duration: playback?.duration || 0,
      },
    recommender: known?.songRcmdUid === current.songRcmdUid ? known.recommender : '',
    selfRecommended: known?.selfRecommended || false,
    uped: known?.uped || false,
    upCount: known?.upCount || 0,
    liked: known?.liked || false,
    likeCount: playback?.likeCount ?? known?.likeCount ?? 0,
  }
}

export function currentRecommendationOwner(
  members: readonly Member[],
  current: RoomQueueEntry | null,
): Member | null {
  if (!current) return null
  return (
    members.find((member) => member.uid === current.songRcmdUid) || {
      uid: current.songRcmdUid,
      nickname: current.songRcmdUid === '0' ? '系统推荐' : current.recommender || '听友',
      avatar: '',
    }
  )
}

/** Keep repeated recordings separate by business ID and classify current playback as played. */
export function memberRecommendationGroups(
  uid: string,
  played: readonly RoomQueueEntry[],
  waiting: readonly RoomQueueEntry[],
  current: RoomQueueEntry | null,
) {
  const pending = new Map(
    waiting
      .filter((entry) => entry.songBizId !== current?.songBizId)
      .map((entry) => [entry.songBizId, entry]),
  )
  const history = new Map(
    [...(current ? [current] : []), ...played]
      .filter((entry) => !pending.has(entry.songBizId))
      .map((entry) => [entry.songBizId, entry]),
  )
  if (current) history.set(current.songBizId, current)
  return {
    waiting: [...pending.values()].filter((entry) => entry.songRcmdUid === uid),
    played: [...history.values()].filter((entry) => entry.songRcmdUid === uid),
  }
}

import { t } from './ui-language'
import type { QueueSong, RoomPlayback, RoomSnapshot } from './types'

function id(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error(t('multiplayer.invalidRoomIdPrecisionUpdateTheApi'))
  const result = String(value ?? '')
  if (!/^\d{1,24}$/.test(result)) throw new Error(t('multiplayer.invalidRoomTrackOrUserId'))
  return result
}
function finite(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}
export function parseRoomBizType(value: unknown): number | string | null {
  if (value === '1' || value === '2' || value === '3') return Number(value)
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : null
}
export function roomTypeLabel(value: unknown): string {
  switch (parseRoomBizType(value)) {
    case 1:
      return t('multiplayer.privateFriendsRoom')
    case 2:
      return t('multiplayer.publicFriendsRoom')
    case 3:
      return t('multiplayer.publicMatchingRoom')
    default:
      return t('multiplayer.unknownRoomType')
  }
}
function queueSong(value: any): QueueSong {
  return {
    songId: id(value.songId),
    songBizId: id(value.songBizId),
    songRcmdUid: id(value.songRcmdUid ?? 0),
  }
}
export function parseRoomPlayback(value: any, sampledAt: number): RoomPlayback | null {
  if (!value || !Object.hasOwn(value, 'playSong')) return null
  if (!Number.isSafeInteger(value.version) || value.version < 0)
    throw new Error(t('multiplayer.invalidRoomTrackVersion'))
  if (!Number.isFinite(value.playedTime) || value.playedTime < 0)
    throw new Error(t('multiplayer.invalidRoomPlaybackPosition'))
  const nextSongs = Array.isArray(value.nextSongs) ? value.nextSongs.map(queueSong) : []
  return {
    song: value.playSong ? queueSong(value.playSong) : null,
    nextSongs,
    version: value.version,
    playedTime: value.playedTime,
    duration: finite(value.songDuration),
    sampledAt,
    forceSync: value.forceSync === true,
    waitSongCount: finite(value.waitSongCount, nextSongs.length),
    likeCount: finite(value.playingSongZanCnt),
  }
}
export function parseRoomTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [
    ...new Set(value.flatMap((tag) => (typeof tag === 'string' && tag.trim() ? [tag.trim()] : []))),
  ]
}
function memberUid(value: unknown): string | undefined {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value)))
    return undefined
  const uid = String(value)
  return /^[1-9]\d{0,23}$/.test(uid) ? uid : undefined
}
function memberNickname(members: unknown, uid: string): string | undefined {
  if (!Array.isArray(members)) return undefined
  for (const member of members) {
    if (
      memberUid(member?.uid ?? member?.userId) === uid &&
      typeof member.nickname === 'string' &&
      member.nickname.trim()
    )
      return member.nickname.trim()
  }
}
/** The share preview distinguishes roomCreator from the user who issued the invitation. */
export function parsePreviewCreator(
  data: any,
  knownUid?: string,
): Pick<RoomSnapshot, 'creatorUid' | 'creatorName'> {
  const profile = data?.roomCreator
  const creatorUid = memberUid(profile?.userId ?? profile?.uid)
  if (!creatorUid || (knownUid && knownUid !== creatorUid)) return {}
  const creatorName = typeof profile.nickname === 'string' ? profile.nickname.trim() : ''
  return creatorName ? { creatorUid, creatorName } : { creatorUid }
}
export function parseSnapshot(value: any, sampledAt: number): RoomSnapshot {
  if (!value || typeof value.roomId !== 'string' || !/^[\w-]{1,128}$/.test(value.roomId))
    throw new Error(t('multiplayer.missingRoomSnapshotSeeTheActivityLog'))
  // Wire names are @JSONField aliases in the official Android models.
  const users = value.multiLtRoomUserAgg ?? value.roomUserList
  const info = value.multiRoomInfoDTO ?? value.roomInfo
  const rawMembers = users?.onlineUserInfos ?? info?.roomUsers
  const creatorUid = memberUid(info?.creatorId)
  const creatorName = creatorUid
    ? (memberNickname(users?.onlineUserInfos, creatorUid) ??
      memberNickname(info?.roomUsers, creatorUid))
    : undefined
  const members = new Map<string, import('./types').Member>()
  if (Array.isArray(rawMembers))
    for (const member of rawMembers) {
      try {
        const uid = id(member?.uid ?? member?.userId)
        members.set(uid, {
          uid,
          nickname: typeof member.nickname === 'string' ? member.nickname : t('common.listener'),
          avatar:
            typeof (member.avatar ?? member.avatarUrl) === 'string'
              ? (member.avatar ?? member.avatarUrl)
              : '',
        })
      } catch {
        /* A malformed member must not interrupt music playback. */
      }
    }
  const onlineCount =
    Number.isInteger(users?.onlineNums) && users.onlineNums >= 0
      ? users.onlineNums
      : Array.isArray(rawMembers)
        ? members.size
        : null
  const chatId = info?.chatRoomId
  const chatRoomId =
    (typeof chatId === 'string' || (typeof chatId === 'number' && Number.isSafeInteger(chatId))) &&
    /^[1-9]\d{0,23}$/.test(String(chatId))
      ? String(chatId)
      : null
  return {
    roomId: value.roomId,
    creatorUid,
    creatorName,
    tags: parseRoomTags(value.roomTagList ?? info?.roomTagList),
    playback: parseRoomPlayback(value.roomPlaySongInfo, sampledAt),
    members: [...members.values()],
    membersKnown: Array.isArray(rawMembers),
    onlineCount,
    chatRoomId,
    roomBizType: parseRoomBizType(info?.roomBizType),
  }
}
export function targetPosition(state: RoomPlayback, now: number): number {
  const progress = state.playedTime + Math.max(0, now - state.sampledAt)
  return state.duration > 0 ? Math.min(progress, Math.max(0, state.duration - 100)) : progress
}
export function shouldAccept(previous: RoomPlayback | null, next: RoomPlayback): boolean {
  return !previous || (next.version >= previous.version && next.sampledAt >= previous.sampledAt)
}
// Official heartBeatDuration is seconds; playedTime/songDuration are milliseconds.
export function heartbeatInterval(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1000, Math.min(value * 1000, 60000))
    : 5000
}

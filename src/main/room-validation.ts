import { ui } from '../shared/ui-language'
/** A red-heart activity must still refer to the authenticated room's current occurrence. */
export function assertRoomCurrentSong(
  body: any,
  target: { roomId: unknown; songId: unknown; bizId: unknown },
  redHeart = false,
) {
  const raw = body?.data?.multiLtRoomSnapshot
  if (body?.code !== 200)
    throw Object.assign(
      new Error(
        ui(
          '无法确认当前房间，请重新同步',
          'Could not verify your current room. Reconnect and try again.',
        ),
      ),
      {
        code: Number(body?.code) || undefined,
      },
    )
  if (raw?.roomId !== target.roomId)
    throw new Error(
      ui(
        '账号已不在此房间，请重新同步',
        'Your account has left this room. Reconnect to update its status.',
      ),
    )
  const current = raw.roomPlaySongInfo?.playSong
  if (String(current?.songId) !== target.songId || String(current?.songBizId) !== target.bizId)
    throw new Error(
      redHeart
        ? ui(
            '房间已切换歌曲，红心动态未发送',
            'The room changed tracks before the favorite could be shared.',
          )
        : ui(
            '房间已切换歌曲，请给当前歌曲点赞',
            'The room changed tracks. Like the current track instead.',
          ),
    )
}

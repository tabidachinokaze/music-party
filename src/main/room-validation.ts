import { t } from '../shared/ui-language'
/** A red-heart activity must still refer to the authenticated room's current occurrence. */
export function assertRoomCurrentSong(
  body: any,
  target: { roomId: unknown; songId: unknown; bizId: unknown },
  redHeart = false,
) {
  const raw = body?.data?.multiLtRoomSnapshot
  if (body?.code !== 200)
    throw Object.assign(new Error(t('roomValidation.couldNotVerifyYourCurrentRoomReconnectAnd')), {
      code: Number(body?.code) || undefined,
    })
  if (raw?.roomId !== target.roomId)
    throw new Error(t('common.yourAccountHasLeftThisRoomReconnectTo'))
  const current = raw.roomPlaySongInfo?.playSong
  if (String(current?.songId) !== target.songId || String(current?.songBizId) !== target.bizId)
    throw new Error(
      redHeart
        ? t('roomValidation.theRoomChangedTracksBeforeTheFavoriteCould')
        : t('roomValidation.theRoomChangedTracksLikeTheCurrentTrack'),
    )
}

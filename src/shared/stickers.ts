import { t } from './ui-language'
import type { ChatEmoji } from './types'
export interface StickerGroup {
  id: string
  name: string
  editable: boolean
}
export interface SavedSticker extends ChatEmoji {
  picId: string
  restricted: boolean
  restriction: string
}
export function stickerKey(item: SavedSticker): string {
  return item.emojiId !== '0' ? item.emojiId : `picture:${item.picId || item.emojiImgUrl}`
}
export function parseStickerGroups(body: any): StickerGroup[] {
  if (!Array.isArray(body?.data?.emojiGroups))
    throw new Error(t('stickers.couldNotReadStickerGroupsTryAgain'))
  return body.data.emojiGroups
    .filter((group: any) => group?.edit === true)
    .map((group: any) => {
      if (typeof group.id === 'number' && !Number.isSafeInteger(group.id))
        throw new Error(t('stickers.invalidStickerGroupIdPrecision'))
      const id = String(group.id)
      if (!/^-?\d{1,24}$/.test(id)) throw new Error(t('stickers.invalidStickerGroupId'))
      return {
        id,
        name: typeof group.name === 'string' ? group.name : t('common.customStickers'),
        editable: true,
      }
    })
}

export function receivedStickerIdentity(value: unknown): { emojiId: string; emojiGroupId: string } {
  const item = value as { emojiId?: unknown; emojiGroupId?: unknown } | null
  const id = item?.emojiId,
    group = item?.emojiGroupId
  if (
    typeof id !== 'string' ||
    !/^[1-9]\d{0,23}$/.test(id) ||
    typeof group !== 'string' ||
    !/^-?\d{1,24}$/.test(group)
  )
    throw new Error(t('stickers.invalidStickerChooseAnOfficialStickerFromA'))
  return { emojiId: id, emojiGroupId: group }
}

export function stickerDeleteIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    value.some((id) => typeof id !== 'string' || !/^[1-9]\d{0,23}$/.test(id))
  )
    throw new Error(t('stickers.chooseAValidCustomSticker'))
  return [...new Set(value)]
}

export function stickerDeletePayload(value: unknown): { emojiIds: string } {
  // IDs can exceed Number.MAX_SAFE_INTEGER; preserve their numeric JSON tokens.
  return { emojiIds: `[${stickerDeleteIds(value).join(',')}]` }
}

export function stickerMutationResult(body: any): void {
  if (body?.code !== 200 || body?.data?.result !== true)
    throw Object.assign(
      new Error(
        body?.data?.toast ||
          body?.message ||
          body?.msg ||
          t('stickers.neteaseDidNotConfirmTheStickerAction'),
      ),
      { code: body?.code },
    )
}

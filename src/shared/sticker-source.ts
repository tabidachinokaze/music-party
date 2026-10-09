import type { ChatEmoji, MessageAttachment } from './types'
import { neteaseAssetUrl } from './media'
import { receivedStickerIdentity } from './stickers'

export interface StickerImage {
  kind: 'image'
  url: string
  width: number
  height: number
}
export type StickerSource = ChatEmoji | StickerImage

export function messageStickerSource(
  item: MessageAttachment,
  width = item.width,
  height = item.height,
): StickerSource | undefined {
  if (item.kind !== 'image') return
  if (item.emoji?.emojiId && item.emoji.emojiId !== '0') {
    try {
      receivedStickerIdentity(item.emoji)
      return item.emoji
    } catch {}
  }
  const url = neteaseAssetUrl(item.url)
  if (
    !url ||
    [width, height].some((size) => !Number.isSafeInteger(size) || size! < 1 || size! > 30000)
  )
    return
  return { kind: 'image', url, width: width!, height: height! }
}

export function stickerSourceKeys(source: StickerSource): string[] {
  const keys: string[] = []
  if ('emojiId' in source && /^[1-9]\d{0,23}$/.test(source.emojiId))
    keys.push(`emoji:${source.emojiId}`)
  const url = neteaseAssetUrl('url' in source ? source.url : source.emojiImgUrl)
  if (url) {
    const asset = new URL(url)
    keys.push(`image:${asset.origin}${asset.pathname}`)
  }
  return keys
}

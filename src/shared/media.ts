import { t } from './ui-language'
import type { MessageAttachment, ChatEmoji } from './types'
export type MediaKind = 'image' | 'voice' | 'video' | 'file'
export type MediaTarget =
  { kind: 'room'; roomId: string } | { kind: 'private'; uid: string } | { kind: 'sticker' }
export interface MediaFile {
  name: string
  mime: string
  kind: MediaKind
  data: Uint8Array
  width?: number
  height?: number
  duration?: number
  cover?: Uint8Array
}
export interface MediaRequest {
  requestId: string
  target: MediaTarget
  file: MediaFile
}
export interface MediaProgress {
  requestId: string
  phase: 'uploading' | 'sending'
  percent: number
}
export interface MediaReceipt {
  requestId: string
  senderUid: string
  text: string
  attachments: MessageAttachment[]
  emoji?: ChatEmoji
  messageId?: string
  time: number
}
export interface MediaReply {
  ok: boolean
  receipt?: MediaReceipt
  error?: string
  deliveryUnknown?: boolean
  code?: number
}
export const MEDIA_LIMITS: Record<MediaKind, number> = {
  image: 20 * 1024 * 1024,
  voice: 20 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  file: 100 * 1024 * 1024,
}
export function validateMediaRequest(value: unknown): MediaRequest {
  const v = value as MediaRequest
  if (!v || typeof v.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(v.requestId))
    throw new Error(t('media.invalidAttachmentRequestId'))
  const target = v.target
  if (
    !target ||
    !(
      (target.kind === 'room' &&
        typeof target.roomId === 'string' &&
        /^[\w-]{1,128}$/.test(target.roomId)) ||
      (target.kind === 'private' &&
        typeof target.uid === 'string' &&
        /^[1-9]\d{0,23}$/.test(target.uid)) ||
      target.kind === 'sticker'
    )
  )
    throw new Error(t('media.invalidAttachmentRecipient'))
  const f = v.file
  if (
    !f ||
    !Object.hasOwn(MEDIA_LIMITS, f.kind) ||
    typeof f.name !== 'string' ||
    !f.name.trim() ||
    f.name.length > 200 ||
    /[\x00-\x1f/\\]/.test(f.name)
  )
    throw new Error(t('media.invalidAttachmentNameOrType'))
  if (
    !(f.data instanceof Uint8Array) ||
    !(f.data.buffer instanceof ArrayBuffer) ||
    !f.data.byteLength ||
    f.data.byteLength > MEDIA_LIMITS[f.kind]
  )
    throw new Error(t('media.theAttachmentIsEmptyOrExceedsTheSize'))
  if (target.kind === 'room' && f.kind !== 'image')
    throw new Error(t('media.roomChatSupportsImageAndStickerAttachments'))
  if (target.kind === 'sticker' && f.kind !== 'image')
    throw new Error(t('media.chooseAnImageOrGifForYourSticker'))
  if (typeof f.mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(f.mime) || f.mime.length > 100)
    throw new Error(t('media.unsupportedAttachmentFormat'))
  const signature = (text: string, offset = 0) =>
    [...text].every((c, i) => f.data[offset + i] === c.charCodeAt(0))
  if (
    f.kind === 'image' &&
    !(
      (f.mime === 'image/png' && f.data[0] === 137 && signature('PNG', 1)) ||
      (f.mime === 'image/jpeg' && f.data[0] === 255 && f.data[1] === 216) ||
      (f.mime === 'image/gif' && signature('GIF8')) ||
      (f.mime === 'image/webp' && signature('RIFF') && signature('WEBP', 8))
    )
  )
    throw new Error(t('common.chooseAPngJpegGifOrWebpImage'))
  if (f.kind === 'video' && !(f.mime === 'video/mp4' && signature('ftyp', 4)))
    throw new Error(t('common.chooseAnMp4Video'))
  if (f.kind === 'voice' && !(f.mime === 'audio/wav' && signature('RIFF') && signature('WAVE', 8)))
    throw new Error(t('media.invalidRecordingFormat'))
  if (
    ['voice', 'video'].includes(f.kind) &&
    (!Number.isFinite(f.duration) || f.duration! <= 0 || f.duration! > 3600000)
  )
    throw new Error(t('media.couldNotReadTheMediaDuration'))
  if (
    ['image', 'video'].includes(f.kind) &&
    [f.width, f.height].some((n) => !Number.isSafeInteger(n) || n! <= 0 || n! > 30000)
  )
    throw new Error(t('media.couldNotReadTheImageOrVideoDimensions'))
  if (
    f.cover &&
    (!(f.cover instanceof Uint8Array) ||
      f.cover.byteLength > 2 * 1024 * 1024 ||
      f.cover[0] !== 255 ||
      f.cover[1] !== 216)
  )
    throw new Error(t('media.invalidVideoThumbnail'))
  return {
    requestId: v.requestId,
    target:
      target.kind === 'room'
        ? { kind: 'room', roomId: target.roomId }
        : target.kind === 'sticker'
          ? { kind: 'sticker' }
          : { kind: 'private', uid: target.uid },
    file: {
      name: f.name,
      mime: f.mime,
      kind: f.kind,
      data: f.data,
      width: f.width,
      height: f.height,
      duration: f.duration,
      cover: f.cover,
    },
  }
}
export function neteaseAssetUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return
  try {
    const u = new URL(value)
    if (u.protocol === 'http:') u.protocol = 'https:'
    if (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      /(^|\.)(music\.126\.net|nos\.netease\.com|nosdn\.127\.net|nos-hz\.163yun\.com|nos-jd\.163yun\.com|nos-hz\.netease\.com)$/.test(
        u.hostname,
      )
    )
      return u.href
  } catch {}
}

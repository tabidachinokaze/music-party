import type { ChatEmoji, MessageAttachment, MessageTextPart, MessageFallback } from './types'
import { getUiLanguage, translateIn, type StaticMessageKey } from './ui-language'
import { neteaseAssetUrl } from './media'

export function localizedMessageText(
  raw: string,
  fallback?: MessageFallback,
  locale = getUiLanguage(),
): string {
  if (!fallback) return raw
  return typeof fallback === 'string'
    ? translateIn(locale, fallback)
    : translateIn(locale, fallback.key, { name: fallback.name })
}

export function messageObject(value: unknown): any {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      return messageObject(JSON.parse(value))
    } catch {}
  }
  return {}
}
const text = (value: unknown, max = 1000) => (typeof value === 'string' ? value.slice(0, max) : '')
export function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' && /(^|\.)music\.126\.net$/.test(url.hostname))
      url.protocol = 'https:'
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes('.') ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(
        url.hostname,
      ) ||
      /\.(local|internal)$/.test(url.hostname)
    )
      return
    return url.href
  } catch {
    return
  }
}
export function musicMessageLink(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || typeof value !== 'string' || value.length > 4096) return
  try {
    const url = new URL(value)
    if (url.protocol === 'orpheus:') {
      const type = url.hostname === 'djradio' ? 'radio' : url.hostname
      const link = resourceLink(type, url.pathname.replace(/^\//, '') || url.searchParams.get('id'))
      if (link) return link
      if (url.hostname === 'nm' && ['/redirect', '/webview'].includes(url.pathname.toLowerCase())) {
        for (const key of ['url2', 'url1', 'url']) {
          const nested = musicMessageLink(url.searchParams.get(key), depth + 1)
          if (nested) return nested
        }
      }
      return
    }
    if (url.protocol === 'http:') url.protocol = 'https:'
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === 'music.163.com' || url.hostname.endsWith('.music.163.com'))
    )
      return url.href
  } catch {}
}
const resourceLink = (type: string, id: unknown) => {
  const value = String(id ?? '')
  if (!/^[\w-]{1,100}$/.test(value)) return
  const route: Record<string, string> = {
    song: 'song',
    playlist: 'playlist',
    album: 'album',
    artist: 'artist',
    program: 'program',
    radio: 'djradio',
    mv: 'mv',
    video: 'video',
    user: 'user/home',
    topic: 'topic',
    event: 'event',
    mlog: 'mlog',
  }
  return route[type]
    ? `https://music.163.com/${route[type]}?id=${encodeURIComponent(value)}`
    : undefined
}
export function parseEmoji(value: unknown): ChatEmoji | undefined {
  const item = messageObject(value)
  const url = mediaUrl(item.emojiImgUrl)
  const id = String(item.emojiId ?? 0),
    group = String(item.emojiGroupId ?? 0)
  if (!url || !/^\d{1,24}$/.test(id) || !/^-?\d{1,24}$/.test(group)) return
  if (
    [item.emojiId, item.emojiGroupId].some((v) => typeof v === 'number' && !Number.isSafeInteger(v))
  )
    return
  return {
    emojiId: id,
    emojiGroupId: group,
    // The canonical placeholder also identifies sticker envelopes returned by the service.
    emojiName:
      text(item.emojiName || item.name, 80) || translateIn('zh-CN', 'emojiPicker.stickers'),
    emojiImgUrl: url,
    width: Math.min(4096, Math.max(1, Number(item.width) || 160)),
    height: Math.min(4096, Math.max(1, Number(item.height) || 160)),
    format: text(item.format, 16),
  }
}
export function richMessageContent(value: unknown): {
  attachments?: MessageAttachment[]
  richText?: MessageTextPart[]
} {
  const envelope = messageObject(value)
  const nested = messageObject(envelope.msgBody)
  const root = envelope.msgType === undefined && nested.msgType !== undefined ? nested : envelope
  const body = messageObject(root.body ?? root.msgBody)
  const data = { ...root, ...body }
  const attachments: MessageAttachment[] = []
  const addMedia = (
    kind: 'image' | 'audio' | 'video',
    raw: any,
    fallbackKey: StaticMessageKey,
    suppliedTitle?: string,
  ) => {
    if (!raw) return
    const item = messageObject(raw)
    const url = mediaUrl(
      typeof raw === 'string'
        ? raw
        : item.url ||
            item.originUrl ||
            item.originalUrl ||
            item.picUrl ||
            item.imgUrl ||
            item.emojiImgUrl ||
            item.voiceUrl ||
            item.playUrlInfo?.url ||
            item.videoUrl,
    )
    const mediaTitle = text(item.name || item.title) || suppliedTitle
    attachments.push({
      kind,
      title: mediaTitle || translateIn('zh-CN', fallbackKey),
      ...(!mediaTitle && { fallbackTitle: fallbackKey }),
      url,
      cover: mediaUrl(
        item.coverUrl || item.cover || item.coverImage?.url || item.coverImage?.picUrl,
      ),
      ...(kind === 'image'
        ? {
            width:
              Number.isSafeInteger(Number(item.width)) &&
              Number(item.width) > 0 &&
              Number(item.width) <= 30000
                ? Number(item.width)
                : undefined,
            height:
              Number.isSafeInteger(Number(item.height)) &&
              Number(item.height) > 0 &&
              Number(item.height) <= 30000
                ? Number(item.height)
                : undefined,
            emoji: parseEmoji({ ...item, emojiImgUrl: url }),
          }
        : {}),
      resourceId:
        typeof (item.md5 || item.voiceKey || item.videoKey) === 'string'
          ? item.md5 || item.voiceKey || item.videoKey
          : undefined,
    })
  }
  const emoji = parseEmoji(data.emoji)
  if (emoji) {
    const raw = messageObject(data.emoji)
    addMedia('image', emoji, 'emojiPicker.stickers', text(raw.emojiName || raw.name, 80))
  }
  const images = data.pics || data.pictures || data.images
  if (Array.isArray(images))
    images.slice(0, 9).forEach((pic) => addMedia('image', pic, 'chat.image'))
  else
    addMedia(
      'image',
      data.picInfo ||
        data.picture ||
        data.image ||
        (root.msgType === 2 || (root.msgType >= 30 && root.msgType <= 48)
          ? undefined
          : data.picUrl),
      'chat.image',
    )
  addMedia('audio', data.voice || data.audio || (data.voiceUrl ? data : null), 'chat.voice')
  const video = messageObject(data.video)
  if (
    video.url ||
    video.videoUrl ||
    video.playUrlInfo?.url ||
    data.videoUrl ||
    data.playUrlInfo?.url
  )
    addMedia('video', data.video || data, 'chat.videoMessage')
  // New message-center envelopes use msgType; legacy private-history type values are different.
  if (root.msgType === 1 && !attachments.length) addMedia('image', body, 'chat.image')
  if (root.msgType === 4 && !attachments.length) addMedia('audio', body, 'chat.voice')
  if (root.msgType === 5 && !attachments.length) addMedia('video', body, 'chat.videoMessage')
  const resources: [string, string, StaticMessageKey][] = [
    ['song', 'song', 'chat.song'],
    ['playlist', 'playlist', 'messageContent.playlist'],
    ['album', 'album', 'common.album'],
    ['artist', 'artist', 'common.artist'],
    ['program', 'program', 'chat.episode'],
    ['djRadio', 'radio', 'chat.podcast'],
    ['radio', 'radio', 'chat.podcast'],
    ['mv', 'mv', 'chat.mv'],
    ['video', 'video', 'chat.video'],
    ['user', 'user', 'chat.user'],
    ['profile', 'user', 'chat.user'],
    ['topic', 'topic', 'chat.topic'],
    ['subject', 'topic', 'chat.feature'],
    ['event', 'event', 'chat.post'],
    ['activity', 'event', 'chat.event'],
    ['mlog', 'mlog', 'chat.mlog'],
    ['concert', 'concert', 'chat.concert'],
    ['live', 'live', 'chat.live'],
    ['comment', 'comment', 'chat.comment'],
    ['generalMsg', 'general', 'chat.card'],
    ['promotion', 'general', 'chat.eventCard'],
  ]
  for (const [key, type, labelKey] of resources) {
    let raw = data[key]
    const typed: Record<number, string> = {
      2: 'generalMsg',
      30: 'song',
      31: 'song',
      32: 'playlist',
      33: 'program',
      34: 'artist',
      35: 'album',
      36: 'mv',
      37: 'topic',
      38: 'user',
      39: 'event',
      40: 'radio',
      41: 'comment',
      42: 'concert',
      43: 'concert',
      44: 'video',
      45: 'live',
      46: 'promotion',
      47: 'generalMsg',
      48: 'mlog',
    }
    if (!raw && typed[root.msgType] === key) raw = body
    if (!raw || (key === 'video' && (video.url || video.videoUrl || video.playUrlInfo?.url)))
      continue
    const item = messageObject(raw)
    const rawId = item.id ?? item.resourceId ?? item.userId ?? item.vid ?? item.resId ?? ''
    const id = typeof rawId === 'number' && !Number.isSafeInteger(rawId) ? '' : String(rawId)
    const artists = item.artists || item.ar || []
    const subtitle =
      text(
        item.description ||
          item.content ||
          item.briefDesc ||
          item.subTitle?.title ||
          item.subTitle ||
          item.creator?.nickname,
      ) ||
      (Array.isArray(artists)
        ? artists
            .map((a: any) => text(a.name))
            .filter(Boolean)
            .join(' / ')
        : '')
    const title = text(
      item.name || item.title || item.nickname || item.mainTitle?.title || item.mainTitle,
    )
    attachments.push({
      kind: 'resource',
      resourceType: type,
      resourceId: id,
      title: title || translateIn('zh-CN', labelKey),
      subtitle: subtitle || translateIn('zh-CN', labelKey),
      ...(!title && { fallbackTitle: labelKey }),
      ...(!subtitle && { fallbackSubtitle: labelKey }),
      cover: mediaUrl(
        item.picUrl ||
          item.coverImgUrl ||
          item.coverUrl ||
          item.cover ||
          item.img1v1Url ||
          item.avatarUrl ||
          item.al?.picUrl ||
          item.album?.picUrl,
      ),
      actionUrl:
        musicMessageLink(item.url || item.webUrl || item.targetUrl || item.nativeUrl) ||
        resourceLink(type, id),
    })
  }
  if (data.file || root.msgType === 49) {
    const file = messageObject(data.file || body)
    const title = text(file.name || file.fileName)
    attachments.push({
      kind: 'file',
      title: title || translateIn('zh-CN', 'common.file'),
      ...(!title && { fallbackTitle: 'common.file' }),
      subtitle: text(file.description),
      actionUrl: musicMessageLink(file.url) || neteaseAssetUrl(file.url),
    })
  }
  const parts = messageObject(data.msgRichText).contentTextList
  const richText: MessageTextPart[] = Array.isArray(parts)
    ? parts
        .slice(0, 100)
        .map((part) => ({
          text: text(part?.text),
          emphasized: part?.highLighted === true,
          url: musicMessageLink(part?.url || part?.orpheus),
        }))
        .filter((part) => part.text)
    : []
  return {
    ...(attachments.length ? { attachments: attachments.slice(0, 12) } : {}),
    ...(richText.length ? { richText } : {}),
  }
}

/** Old clients supply this fallback text alongside supported picture metadata. */
export function messageDisplayText(value: string, attachments?: MessageAttachment[]): string {
  if (
    attachments?.some((item) => item.kind === 'image' && item.url) &&
    /^\s*[（(]?升级\s*App\s*到最新版本即可查看该消息[）)]?\s*$/i.test(value)
  )
    return ''
  if (attachments?.some((item) => item.emoji && value === `[${item.emoji.emojiName}]`)) return ''
  return value
}

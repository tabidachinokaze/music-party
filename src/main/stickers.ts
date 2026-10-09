import { createHash } from 'node:crypto'
import { parseEmoji } from '../shared/message-content'
import type { SavedSticker } from '../shared/stickers'

export function imageUrlForPicId(value: unknown): string | undefined {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('表情图片 ID 精度异常，请使用内置 API')
  const id = String(value ?? '')
  if (!/^[1-9]\d{0,23}$/.test(id)) return
  const key = Buffer.from('3go8&$8*3*3h0k(2)2'),
    bytes = Buffer.from(id)
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length]
  const hash = createHash('md5')
    .update(bytes)
    .digest('base64')
    .replaceAll('/', '_')
    .replaceAll('+', '-')
  return `https://p1.music.126.net/${hash}/${id}.jpg`
}
export function savedSticker(raw: any, groupId?: string): SavedSticker | null {
  if (!raw || typeof raw !== 'object') return null
  const picId = String(raw.picId ?? '')
  const fallback = imageUrlForPicId(raw.picId)
  const emoji = parseEmoji({
    ...raw,
    emojiGroupId: raw.emojiGroupId ?? groupId ?? '0',
    emojiImgUrl: raw.emojiImgUrl || fallback,
  })
  if (!emoji) return null
  return {
    ...emoji,
    picId,
    restricted: raw.enable === false || raw.disabled === true,
    restriction: typeof raw.vipMessage === 'string' ? raw.vipMessage : '此表情暂不可用',
  }
}
export function normalizeStickerPage(body: any, groupId: string) {
  if (!Array.isArray(body?.data?.emojis)) throw new Error('自定义表情响应异常，请重试')
  const items = body.data.emojis.map((raw: any) => savedSticker(raw, groupId)).filter(Boolean)
  return {
    ...body,
    data: { ...body.data, emojis: items, unavailable: body.data.emojis.length - items.length },
  }
}

/** Fetch public chat pictures without exposing authenticated API credentials. */
export async function downloadStickerImage(
  source: unknown,
  assertCurrent: () => void,
  fetcher: typeof fetch = fetch,
  abort?: AbortSignal,
): Promise<import('../shared/media').MediaFile> {
  const { neteaseAssetUrl, MEDIA_LIMITS } = await import('../shared/media')
  const { imageFormat } = await import('../shared/image-format')
  const image = source as {
    kind?: unknown
    url?: unknown
    width?: unknown
    height?: unknown
  } | null
  const safe = neteaseAssetUrl(image?.url)
  if (
    !safe ||
    image?.kind !== 'image' ||
    [image.width, image.height].some(
      (n) => !Number.isSafeInteger(n) || Number(n) < 1 || Number(n) > 30000,
    )
  )
    throw new Error('图片地址或尺寸无效，无法添加到表情包')
  let url = safe
  const timeout = AbortSignal.timeout(15000)
  const signal = abort ? AbortSignal.any([abort, timeout]) : timeout
  for (let hop = 0; hop < 4; hop++) {
    assertCurrent()
    signal.throwIfAborted()
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'image/png,image/jpeg,image/gif,image/webp' },
      signal,
    })
    try {
      assertCurrent()
      signal.throwIfAborted()
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const destination = response.headers.get('location')
        const next = destination && neteaseAssetUrl(new URL(destination, url).href)
        if (!next || hop === 3) throw new Error('图片重定向地址无效')
        url = next
        continue
      }
      if (!response.ok) throw new Error('无法读取聊天图片')
      const length = response.headers.get('content-length')
      if (length && (!/^\d+$/.test(length) || Number(length) > MEDIA_LIMITS.image))
        throw new Error('图片为空或超过 20 MB')
      if (!response.body) throw new Error('无法读取聊天图片')
      const reader = response.body.getReader(),
        parts: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          assertCurrent()
          signal.throwIfAborted()
          if (done) break
          size += value.byteLength
          if (size > MEDIA_LIMITS.image) throw new Error('图片为空或超过 20 MB')
          parts.push(value)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      const data = new Uint8Array(size)
      let offset = 0
      for (const part of parts) {
        data.set(part, offset)
        offset += part.byteLength
      }
      const format = imageFormat(data)
      if (!format) throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片')
      return {
        kind: 'image',
        name: `chat-image.${format.extension}`,
        mime: format.mime,
        data,
        width: Number(image.width),
        height: Number(image.height),
      }
    } finally {
      if (response.body && !response.body.locked) await response.body.cancel().catch(() => {})
    }
  }
  throw new Error('无法读取聊天图片')
}

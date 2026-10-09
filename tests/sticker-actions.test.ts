import { expect, it, vi } from 'vitest'
import { downloadStickerImage } from '../src/main/stickers'
import { MediaSender } from '../src/main/media-send'
import { imageFormat } from '../src/shared/image-format'
import { messageStickerSource, stickerSourceKeys } from '../src/shared/sticker-source'
import {
  receivedStickerIdentity,
  stickerDeletePayload,
  stickerMutationResult,
} from '../src/shared/stickers'
import { richMessageContent, messageDisplayText } from '../src/shared/message-content'

const url = 'https://p1.music.126.net/stored.jpg'
const image = { kind: 'image' as const, url, width: 1, height: 1 }
const png = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
    'base64',
  ),
)
const gif = new Uint8Array(
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
)
const emoji = {
  emojiId: '109951166199016466',
  emojiGroupId: '-2',
  emojiName: '表情',
  emojiImgUrl: url,
  width: 1,
  height: 1,
  format: 'png',
}

it('uses real image bytes even when every format is served as image/jpg', async () => {
  const jpeg = new Uint8Array([255, 216, 255, 224])
  const webp = new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBPVP8 \0\0\0\0', 'binary'))
  for (const [data, mime] of [
    [png, 'image/png'],
    [gif, 'image/gif'],
    [jpeg, 'image/jpeg'],
    [webp, 'image/webp'],
  ] as const) {
    const fetcher = vi.fn(
      async (_request: unknown, _options?: RequestInit) =>
        new Response(data, { headers: { 'Content-Type': 'image/jpg' } }),
    )
    const file = await downloadStickerImage(image, () => {}, fetcher)
    expect(file.mime).toBe(mime)
    expect(file.data).toEqual(data)
    expect(file.name).toBe(`chat-image.${imageFormat(data)?.extension}`)
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('cookie')
  }
})
it('validates the redirect chain, size limits and account generation before any authenticated upload', async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { location: 'https://example.test/picture.png' } }),
    new Response(png, { headers: { 'content-length': String(21 * 1024 * 1024) } }),
    new Response('not an image', { headers: { 'content-type': 'image/png' } }),
  ])
    await expect(
      downloadStickerImage(
        image,
        () => {},
        vi.fn(async () => response),
      ),
    ).rejects.toThrow()
  const fetcher = vi.fn(async (request: unknown) =>
    request === url
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://p2.music.126.net/picture' },
        })
      : new Response(png),
  )
  expect((await downloadStickerImage(image, () => {}, fetcher)).mime).toBe('image/png')
  expect(fetcher).toHaveBeenCalledTimes(2)
  let epoch = 1
  const invoke = vi.fn()
  const media = new MediaSender(
    invoke,
    () => ({ epoch, cookie: 'MUSIC_U=test' }),
    vi.fn(async () => {
      epoch++
      return new Response(png)
    }),
  )
  expect(
    await media.saveImage({ requestId: '33333333-3333-4333-8333-333333333333', image }, () => {}),
  ).toMatchObject({ ok: false, deliveryUnknown: false })
  expect(invoke).not.toHaveBeenCalled()
})
it('saves an ordinary received image through NOS and sticker upload without sending a message', async () => {
  const invoke = vi.fn(async (endpoint: string, args: any) => {
    if (endpoint === 'login_status') return { body: { data: { profile: { userId: 123 } } } }
    if (args.uri === '/api/nos/token/alloc')
      return {
        body: {
          code: 200,
          result: {
            bucket: 'yyimgs',
            docId: '109951166199016466',
            objectKey: 'copy.png',
            token: 'secret',
            channel: 1,
          },
        },
      }
    if (args.uri === '/api/social/emoji/upload')
      return {
        body: { code: 200, data: { emojiMap: [{ ...emoji, picId: '109951166199016466' }] } },
      }
    throw new Error('Unexpected message send')
  })
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) =>
    options?.method === 'GET'
      ? new Response(png, { headers: { 'content-type': 'image/jpg' } })
      : new Response('{}'),
  )
  const sender = new MediaSender(invoke, () => ({ cookie: 'MUSIC_U=test', epoch: 1 }), fetcher)
  const result = await sender.saveImage(
    { requestId: '33333333-3333-4333-8333-333333333333', image },
    () => {},
  )
  expect(result).toMatchObject({ ok: true, receipt: { emoji: { emojiId: emoji.emojiId } } })
  expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ 'Content-Type': 'image/png' })
  expect(
    invoke.mock.calls.some(
      ([, args]) => args.uri?.includes('communication') || args.uri?.includes('chatroom'),
    ),
  ).toBe(false)
})
it('accepts self and peer image attachments, collects official identities, and excludes covers', () => {
  expect(messageStickerSource({ ...image, title: '图片' })).toEqual(image)
  expect(messageStickerSource({ ...image, title: '表情', emoji })).toEqual(emoji)
  expect(
    messageStickerSource({
      ...image,
      title: '普通上传',
      emoji: { ...emoji, emojiId: '0', emojiGroupId: '0' },
    }),
  ).toEqual(image)
  expect(
    messageStickerSource({ kind: 'resource', title: '歌曲', cover: url }, 1, 1),
  ).toBeUndefined()
  expect(
    messageStickerSource({ ...image, title: '不可信', url: 'https://example.test/a.png' }),
  ).toBeUndefined()
  expect(messageStickerSource({ kind: 'image', url, title: '未知尺寸' })).toBeUndefined()
  expect(stickerSourceKeys({ ...image, url: `${url}?param=120y120` })).toEqual(
    stickerSourceKeys(image),
  )
})
it('retains modern image identity and dimensions including nested msgBody envelopes', () => {
  const payload = {
    msgBody: {
      msgType: 1,
      body: JSON.stringify({
        url,
        width: 300,
        height: 200,
        name: '收到的图片',
        emojiId: emoji.emojiId,
        emojiGroupId: '-2',
      }),
    },
  }
  const result = richMessageContent(payload)
  expect(result.attachments?.[0]).toMatchObject({
    kind: 'image',
    url,
    width: 300,
    height: 200,
    emoji: { emojiId: emoji.emojiId, emojiGroupId: '-2' },
  })
  expect(messageDisplayText('（升级App到最新版本即可查看该消息）', result.attachments)).toBe('')
  expect(messageDisplayText('这张图片很有趣', result.attachments)).toBe('这张图片很有趣')
  expect(messageDisplayText('（升级App到最新版本即可查看该消息）')).not.toBe('')
})
it('does not turn album and song cover art into collectible chat images', () => {
  for (const msgType of [2, 30, 35]) {
    const attachments = richMessageContent({
      msgType,
      body: { id: 123, name: '资源', picUrl: url },
    }).attachments
    expect(attachments?.some((item) => item.kind === 'image')).toBe(false)
    expect(attachments?.[0].kind).toBe('resource')
  }
})
it('serializes large deletion IDs as exact numeric tokens and checks explicit business success', () => {
  expect(stickerDeletePayload([emoji.emojiId, '991', emoji.emojiId])).toEqual({
    emojiIds: '[109951166199016466,991]',
  })
  expect(receivedStickerIdentity(emoji)).toEqual({ emojiId: emoji.emojiId, emojiGroupId: '-2' })
  for (const bad of [
    { ...emoji, emojiId: 0 },
    { ...emoji, emojiGroupId: 'invalid' },
    { ...emoji, emojiId: Number(emoji.emojiId) },
  ])
    expect(() => receivedStickerIdentity(bad)).toThrow()
  for (const body of [
    { code: 200 },
    { code: 200, data: { result: false, toast: '收藏已满' } },
    { code: 500, data: { result: true } },
  ])
    expect(() => stickerMutationResult(body)).toThrow()
  expect(() => stickerMutationResult({ code: 200, data: { result: true } })).not.toThrow()
})

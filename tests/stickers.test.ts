import { expect, it, vi } from 'vitest'
import { parsePreciseJson, preciseMediaEndpoint } from '../src/main/precise-json'
import { imageUrlForPicId, normalizeStickerPage } from '../src/main/stickers'
import { parseStickerGroups, stickerKey } from '../src/shared/stickers'
import { ApiService, validate } from '../src/main/service'
import { MediaSender } from '../src/main/media-send'
import type { MediaRequest } from '../src/shared/media'
const picId = '109951166199016466'
const url = `https://p1.music.126.net/5rgzlgx3yofdin1Rnf8iQw==/${picId}.jpg`
const raw = {
  emojiId: '991',
  picId,
  emojiGroupId: '-2',
  name: '我的表情',
  format: 'gif',
  width: 120,
  height: 100,
}
const requestId = '33333333-3333-4333-8333-333333333333'
it('preserves original large JSON numbers without changing ordinary numbers or quoted content', () => {
  const body = parsePreciseJson(
    '{"picId":109951166199016466,"negative":-109951166199016466,"code":200,"name":"109951166199016466"}',
  )
  expect(body).toEqual({ picId, negative: `-${picId}`, code: 200, name: picId })
  expect(
    preciseMediaEndpoint('https://interface.music.163.com/eapi/social/emoji/groups/detail/page'),
  ).toBe(true)
  expect(preciseMediaEndpoint('/api/nos/token/alloc')).toBe(true)
  expect(preciseMediaEndpoint('/api/song/detail')).toBe(false)
})
it('derives the same picture URL as the official client and retains custom group IDs', () => {
  expect(imageUrlForPicId(picId)).toBe(url)
  expect(() => imageUrlForPicId(Number(picId))).toThrow('精度')
  const page = normalizeStickerPage(
    { code: 200, data: { emojis: [raw], page: { more: true, cursor: 'next' } } },
    '-2',
  )
  expect(page.data.emojis[0]).toMatchObject({
    emojiId: '991',
    emojiGroupId: '-2',
    emojiImgUrl: url,
    format: 'gif',
  })
  expect(page.data.page).toEqual({ more: true, cursor: 'next' })
  expect(
    parseStickerGroups({
      data: {
        emojiGroups: [
          { id: 1, name: '官方包', edit: false },
          { id: -2, name: '自定义', edit: true },
        ],
      },
    }),
  ).toEqual([{ id: '-2', name: '自定义', editable: true }])
})
it('keeps distinct custom pictures when the service uses zero emoji IDs', () => {
  const result = normalizeStickerPage(
    {
      data: {
        emojis: [
          { ...raw, emojiId: 0 },
          { ...raw, emojiId: 0, picId: '109951166199016467' },
        ],
      },
    },
    '-2',
  )
  expect(result.data.emojis).toHaveLength(2)
  expect(new Set(result.data.emojis.map(stickerKey)).size).toBe(2)
})
it('keeps catalogue queries authenticated, constrained and paginated', async () => {
  const invoke = vi.fn(async (_name: string, args: any) => ({
    body: {
      code: 200,
      data: args.uri.endsWith('/page')
        ? { emojis: [raw], page: { more: false } }
        : { emojiGroups: [] },
    },
  }))
  const api = new ApiService(invoke)
  expect((await api.call({ method: 'stickerGroups', args: { scope: 'room' } })).ok).toBe(false)
  expect(invoke).not.toHaveBeenCalled()
  api.restore('MUSIC_U=test')
  for (const scope of ['room', 'private'])
    await api.call({ method: 'stickerGroups', args: { scope } })
  expect(invoke.mock.calls.slice(0, 2).map(([, args]) => args.data.resourceType)).toEqual([3, 2])
  const page = await api.call({ method: 'stickerPage', args: { groupId: '-2', cursor: 'next' } })
  expect(page.data.data.emojis[0].emojiImgUrl).toBe(url)
  expect(invoke.mock.calls[2][1].data).toEqual({ emojiGroupId: '-2', cursor: 'next', size: 10 })
  expect(() => validate({ method: 'stickerPage', args: { groupId: '-2', uri: '/evil' } })).toThrow()
  expect(() => validate({ method: 'stickerGroups', args: { scope: 'other' } })).toThrow()
})
it('sends a saved sticker to one private recipient without uploading it again', async () => {
  const invoke = vi.fn(async (name: string, _args: any) =>
    name === 'login_status'
      ? { body: { data: { profile: { userId: 123 } } } }
      : name === 'register_checktoken_v3'
        ? { body: { token: 'private-check-token' } }
        : { body: { code: 200, data: { msgBody: { msgId: 'server-id', status: 0 } } } },
  )
  const api = new ApiService(invoke)
  api.restore('MUSIC_U=secret')
  const emoji = normalizeStickerPage({ data: { emojis: [raw] } }, '-2').data.emojis[0]
  const request = { method: 'privateSticker' as const, args: { uid: '456', emoji, requestId } }
  const [a, b] = await Promise.all([api.call(request), api.call(request)])
  expect(a.ok && b.ok).toBe(true)
  const sends = invoke.mock.calls.filter(([name]) => name === 'api')
  expect(sends).toHaveLength(1)
  const body = JSON.parse(sends[0][1].data.sendMsgBody)
  expect(body).toMatchObject({
    scene: 1,
    receiverUserIds: '456',
    msgBody: { msgType: 1, status: 1 },
  })
  expect(JSON.parse(body.msgBody.body)).toMatchObject({ url, emojiId: '991', emojiGroupId: '-2' })
  expect(JSON.stringify(a.trace)).not.toContain('private-check-token')
  expect(JSON.stringify(a.trace)).not.toContain(picId)
  expect(() => validate({ method: 'privateSticker', args: { uid: '456', requestId } })).toThrow()
})
const image: MediaRequest = {
  requestId,
  target: { kind: 'sticker' },
  file: {
    kind: 'image',
    name: 'custom.gif',
    mime: 'image/gif',
    width: 1,
    height: 1,
    data: new Uint8Array(
      Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    ),
  },
}
function sender(empty = false) {
  let epoch = 1
  const invoke = vi.fn(async (name: string, args: any): Promise<{ body: any }> => {
    if (name === 'login_status') return { body: { data: { profile: { userId: 123 } } } }
    if (args.uri === '/api/nos/token/alloc')
      return {
        body: {
          code: 200,
          result: {
            bucket: 'yyimgs',
            docId: picId,
            objectKey: 'image.gif',
            token: 'upload-secret',
          },
        },
      }
    if (args.uri === '/api/social/emoji/upload')
      return {
        body: {
          code: 200,
          data: { emojiMap: empty ? [] : [raw], toast: empty ? '自定义表情已达上限' : '' },
        },
      }
    throw new Error('Unexpected endpoint')
  })
  const fetcher = vi.fn(async () => new Response('{}'))
  return {
    invoke,
    fetcher,
    changeAccount: () => epoch++,
    media: new MediaSender(invoke, () => ({ cookie: 'MUSIC_U=test', epoch }), fetcher as any),
  }
}
it('uploads and registers the custom sticker once, without sending a room or private message', async () => {
  const { invoke, fetcher, media } = sender()
  const [a, b] = await Promise.all([media.send(image, () => {}), media.send(image, () => {})])
  expect(a.ok && b.ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
  const save = invoke.mock.calls.filter(([, args]) => args.uri === '/api/social/emoji/upload')
  expect(save).toHaveLength(1)
  expect(JSON.parse(save[0][1].data.imgs)).toEqual([{ picId, width: 1, height: 1, format: 'gif' }])
  expect(a.receipt?.emoji?.emojiId).toBe('991')
  expect(
    invoke.mock.calls.some(
      ([name, args]) =>
        name === 'send_text' ||
        args.uri?.includes('chatroom') ||
        args.uri?.includes('communication'),
    ),
  ).toBe(false)
})
it('reports collection limits and account changes without claiming the sticker was saved', async () => {
  const { media } = sender(true)
  expect(await media.send(image, () => {})).toMatchObject({
    ok: false,
    error: '自定义表情已达上限',
    deliveryUnknown: false,
  })
  const env = sender()
  env.fetcher.mockImplementation(async () => {
    env.changeAccount()
    return new Response('{}')
  })
  expect((await env.media.send(image, () => {})).ok).toBe(false)
  expect(env.invoke.mock.calls.some(([, args]) => args.uri === '/api/social/emoji/upload')).toBe(
    false,
  )
})

import { expect, it, vi } from 'vitest'
import { MediaSender } from '../src/main/media-send'
import { validateMediaRequest, type MediaFile, type MediaRequest } from '../src/shared/media'
import { encodeWav } from '../src/renderer/src/recording'
const png = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
    'base64',
  ),
)
const id = '11111111-1111-4111-8111-111111111111'
const image: MediaFile = {
  kind: 'image',
  name: '表情.png',
  mime: 'image/png',
  data: png,
  width: 1,
  height: 1,
}
const request = (file = image): MediaRequest => ({
  requestId: id,
  target: { kind: 'private', uid: '456' },
  file,
})
function setup() {
  let epoch = 1,
    roomId = 'room'
  const invoke = vi.fn(async (endpoint: string, args: any): Promise<{ body: any }> => {
    if (endpoint === 'login_status') return { body: { data: { profile: { userId: 123 } } } }
    if (endpoint === 'multiStatus')
      return {
        body: {
          code: 200,
          data: { multiLtRoomSnapshot: { roomId, multiRoomInfoDTO: { chatRoomId: '789' } } },
        },
      }
    if (endpoint === 'register_checktoken_v3') return { body: { token: 'check-secret' } }
    if (endpoint === 'send_text') return { body: { code: 200 } }
    if (args.uri?.includes('/nos/token/'))
      return {
        body: {
          code: 200,
          [args.uri.endsWith('whalealloc') ? 'data' : 'result']: {
            bucket: args.data.bucket,
            objectKey: 'example.png',
            docId: '123456',
            token: 'upload-secret',
            channel: 1,
          },
        },
      }
    return { body: { code: 200, data: { success: true, msgBody: { msgId: '888', status: 0 } } } }
  })
  const fetcher = vi.fn(
    async (url: any, init: any) =>
      new Response(
        JSON.stringify({
          offset: Number(new URL(url).searchParams.get('offset')) + init.body.length,
          context: 'context',
        }),
      ),
  )
  return {
    invoke,
    fetcher,
    sender: new MediaSender(invoke, () => ({ cookie: 'MUSIC_U=test', epoch }), fetcher as any),
    changeAccount: () => epoch++,
    changeRoom: () => (roomId = 'other'),
  }
}
it('uploads a picture only to the fixed NOS host and sends the verified private media envelope once', async () => {
  const { sender, invoke, fetcher } = setup()
  const progress = vi.fn()
  const [a, b] = await Promise.all([
    sender.send(request(), progress),
    sender.send(request(), progress),
  ])
  expect(a.ok && b.ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [url, options] = fetcher.mock.calls[0]
  expect(new URL(url).origin).toBe('https://nosup-hz1.127.net')
  expect(options.redirect).toBe('error')
  expect(options.headers['x-nos-token']).toBe('upload-secret')
  const sent = invoke.mock.calls.find(([, args]) => args.uri === '/api/communication/send/msg')![1]
  const body = JSON.parse(sent.sendMsgBody || sent.data.sendMsgBody)
  expect(body).toMatchObject({
    scene: 1,
    receiverUserIds: '456',
    channelId: '456',
    msgBody: { msgType: 1, unikey: id },
  })
  expect(JSON.parse(body.msgBody.body)).toMatchObject({
    width: 1,
    height: 1,
    url: 'https://p1.music.126.net/example.png',
  })
  expect(JSON.stringify(a)).not.toContain('secret')
  expect(progress).toHaveBeenLastCalledWith({ requestId: id, phase: 'sending', percent: 100 })
})
it('keeps voice seconds and video milliseconds separate, and allocates the correct upload business keys', async () => {
  for (const kind of ['voice', 'video'] as const) {
    const { sender, invoke } = setup()
    const file: MediaFile =
      kind === 'voice'
        ? {
            kind,
            name: '录音.wav',
            mime: 'audio/wav',
            data: encodeWav([new Float32Array(16000)], 16000),
            duration: 1000,
          }
        : {
            kind,
            name: '视频.mp4',
            mime: 'video/mp4',
            data: new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 109, 112, 52, 50]),
            duration: 2500,
            width: 64,
            height: 48,
          }
    expect((await sender.send(request(file), () => {})).ok).toBe(true)
    const allocation = invoke.mock.calls.find(
      ([, args]) => args.uri === '/api/nos/token/whalealloc',
    )![1]
    expect(allocation.data.bizKey).toBe(kind === 'voice' ? '519abfd2' : 'cb8c016e')
    const sent = invoke.mock.calls.find(
      ([, args]) => args.uri === '/api/communication/send/msg',
    )![1]
    const body = JSON.parse(JSON.parse(sent.data.sendMsgBody).msgBody.body)
    expect(body.duration).toBe(kind === 'voice' ? 1 : 2500)
    expect(body.nosKey).toBe(`${kind === 'voice' ? 'ymusic' : 'cloudmusic'}/example.png`)
  }
})
it('sends an ordinary file as one named download link and chunks its upload', async () => {
  const { sender, invoke, fetcher } = setup()
  const reply = await sender.send(
    request({
      kind: 'file',
      name: 'notes.txt',
      mime: 'text/plain',
      data: new Uint8Array(3 * 1024 * 1024),
    }),
    () => {},
  )
  expect(reply.ok).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('offset')).toBe('2097152')
  const sent = invoke.mock.calls.find(([endpoint]) => endpoint === 'send_text')![1]
  expect(sent.user_ids).toBe('456')
  expect(sent.msg).toBe('[文件] notes.txt\nhttps://dmusic.nos-hz.163yun.com/example.png')
})
it('sends room images as official emoji messages and rejects room voice/video/file attachments', async () => {
  const { sender, invoke } = setup()
  const reply = await sender.send(
    { ...request(), target: { kind: 'room', roomId: 'room' } },
    () => {},
  )
  expect(reply.ok).toBe(true)
  const sent = invoke.mock.calls.find(([, args]) => args.uri === '/api/middle/im/chatroom/send')![1]
    .data
  expect(sent.chatroomId).toBe('789')
  expect(JSON.parse(sent.clientExt).emoji.emojiImgUrl).toBe('https://p1.music.126.net/example.png')
  expect(() =>
    validateMediaRequest({
      ...request(),
      target: { kind: 'room', roomId: 'room' },
      file: { ...image, kind: 'file' },
    }),
  ).toThrow('仅支持图片')
})
it('never sends if the room or account changed during upload', async () => {
  for (const change of ['changeRoom', 'changeAccount'] as const) {
    const env = setup()
    env.fetcher.mockImplementation(async () => {
      env[change]()
      return new Response('{}')
    })
    const reply = await env.sender.send(
      { ...request(), target: { kind: 'room', roomId: 'room' } },
      () => {},
    )
    expect(reply.ok).toBe(false)
    expect(reply.deliveryUnknown).toBe(false)
    expect(
      env.invoke.mock.calls.some(([, args]) => args.uri === '/api/middle/im/chatroom/send'),
    ).toBe(false)
  }
})
it('treats upload failures as unsent and message transport timeouts as uncertain without retry', async () => {
  const env = setup()
  env.fetcher.mockResolvedValue(new Response('{}', { status: 500 }))
  expect(await env.sender.send(request(), () => {})).toMatchObject({
    ok: false,
    deliveryUnknown: false,
  })
  expect(env.invoke.mock.calls.some(([, args]) => args.uri === '/api/communication/send/msg')).toBe(
    false,
  )
  const next = setup()
  const original = next.invoke.getMockImplementation()!
  next.invoke.mockImplementation(async (endpoint, args) => {
    if (args.uri === '/api/communication/send/msg') throw new Error('network timeout')
    return original(endpoint, args)
  })
  expect(await next.sender.send(request(), () => {})).toMatchObject({
    ok: false,
    deliveryUnknown: true,
  })
  await next.sender.send(request(), () => {})
  expect(next.fetcher).toHaveBeenCalledTimes(1)
})
it('cancels an in-progress upload before sending and rejects mismatched retries or forged file metadata', async () => {
  const env = setup()
  env.fetcher.mockImplementation(async (_url, init) => {
    env.sender.cancel(id)
    init.signal.throwIfAborted()
    return new Response('{}')
  })
  expect(await env.sender.send(request(), () => {})).toMatchObject({
    ok: false,
    error: '上传已取消',
    deliveryUnknown: false,
  })
  expect(await env.sender.send(request({ ...image, name: 'other.png' }), () => {})).toMatchObject({
    ok: false,
    error: '附件请求标识已被使用',
  })
  expect(() => validateMediaRequest(request({ ...image, name: '../secret' }))).toThrow()
  expect(() =>
    validateMediaRequest(request({ ...image, data: new Uint8Array([1, 2, 3]) })),
  ).toThrow()
})
it('encodes captured samples as mono 16-bit PCM WAV without losing sample rate or clipping', () => {
  const data = encodeWav([new Float32Array([-2, 0, 2])], 16000),
    view = new DataView(data.buffer)
  expect(new TextDecoder().decode(data.slice(0, 4))).toBe('RIFF')
  expect(view.getUint32(24, true)).toBe(16000)
  expect(view.getUint16(22, true)).toBe(1)
  expect(view.getInt16(44, true)).toBe(-32768)
  expect(view.getInt16(48, true)).toBe(32767)
})
it('does not report a successful send when the official business response explicitly rejects it', async () => {
  const env = setup(),
    original = env.invoke.getMockImplementation()!
  env.invoke.mockImplementation(async (endpoint, args) =>
    args.uri === '/api/middle/im/chatroom/send'
      ? { body: { code: 200, data: false, message: '附件被拒绝' } }
      : original(endpoint, args),
  )
  expect(
    await env.sender.send({ ...request(), target: { kind: 'room', roomId: 'room' } }, () => {}),
  ).toMatchObject({ ok: false, error: '附件被拒绝', deliveryUnknown: false })
})
it('uses the server-confirmed media URL for private playback instead of assuming the upload object is public', async () => {
  const env = setup(),
    original = env.invoke.getMockImplementation()!
  env.invoke.mockImplementation(async (endpoint, args) =>
    args.uri === '/api/communication/send/msg'
      ? {
          body: {
            code: 200,
            data: {
              msgBody: {
                msgId: '999',
                msgType: 4,
                status: 0,
                body: JSON.stringify({
                  voiceKey: '123456',
                  voiceUrl: 'https://m10.music.126.net/authorized.wav',
                }),
              },
            },
          },
        }
      : original(endpoint, args),
  )
  const reply = await env.sender.send(
    request({
      kind: 'voice',
      name: 'voice.wav',
      mime: 'audio/wav',
      data: encodeWav([new Float32Array(16000)], 16000),
      duration: 1000,
    }),
    () => {},
  )
  expect(reply.receipt?.attachments[0].url).toBe('https://m10.music.126.net/authorized.wav')
})

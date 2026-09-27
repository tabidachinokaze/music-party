import { expect, it, vi } from 'vitest'
import { ApiService, validate } from '../src/main/service'
import { createHttpInvoker } from '../src/main/transport'
it('never passes renderer cookie, proxy, URLs or sequence overrides to upstream', () => {
  for (const name of ['cookie', 'proxy', 'domain', 'clientSeq'])
    expect(() => validate({ method: 'multiStatus', args: { [name]: 'evil' } })).toThrow()
  expect(() => validate({ method: 'constructor' as any })).toThrow()
})
it('does not claim success when HTTP succeeded but the business operation failed', async () => {
  const service = new ApiService(async () => ({ body: { code: 200, data: { success: false } } }))
  service.restore('MUSIC_U=test')
  expect((await service.call({ method: 'multiCreate', args: { songId: '123' } })).ok).toBe(false)
})
it('requires login before a room mutation', async () => {
  const invoke = vi.fn()
  const service = new ApiService(invoke)
  expect((await service.call({ method: 'multiCreate', args: { songId: '123' } })).ok).toBe(false)
  expect(invoke).not.toHaveBeenCalled()
})
it('keeps QR credentials on the service side and omits them from replies and traces', async () => {
  const persist = vi.fn()
  const service = new ApiService(
    async (name) =>
      name === 'login_qr_key'
        ? { body: { code: 200, data: { unikey: 'key-123' } } }
        : name === 'login_qr_create'
          ? { body: { data: { qrimg: 'data:image/png;base64,image' } } }
          : {
              body: { code: 803, cookie: 'MUSIC_U=private-secret;' },
              cookie: ['MUSIC_U=private-secret; Path=/; HttpOnly', '__csrf=csrf-secret; Path=/'],
            },
    persist,
  )
  await service.call({ method: 'qrCreate' })
  const reply = await service.call({ method: 'qrCheck', args: { key: 'key-123' } })
  expect(reply.ok).toBe(true)
  expect(persist).toHaveBeenCalledWith('MUSIC_U=private-secret; __csrf=csrf-secret')
  expect(JSON.stringify(reply)).not.toContain('private-secret')
  expect(JSON.stringify(reply)).not.toContain('csrf-secret')
})
it('transport uses POST, suppresses the server default account, and extracts QR cookies', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ code: 803, cookie: 'MUSIC_U=secret; Path=/; __csrf=test; HttpOnly' }),
      ),
  )
  const result = await createHttpInvoker('http://127.0.0.1:3000', fetcher as any)(
    'login_qr_check',
    { key: 'test', cookie: '' },
  )
  const [url, request] = fetcher.mock.calls[0] as any
  expect(url.pathname).toBe('/login/qr/check')
  expect(request.method).toBe('POST')
  expect(JSON.parse(request.body).cookie).toBe('MUSIC_U=; MUSIC_A=')
  expect(result.cookie).toEqual(['MUSIC_U=secret', '__csrf=test'])
})
it('rejects non-JSON API errors with an actionable message', async () => {
  await expect(
    createHttpInvoker(
      'http://127.0.0.1:3000',
      (async () => new Response('<html>oops</html>')) as any,
    )('login_status', {}),
  ).rejects.toThrow('非 JSON')
})
it('falls back to the ordinary Netease URL endpoint with the same account if key initialization fails', async () => {
  const invoke = vi.fn(async (name: string, _args: any) => {
    if (name === 'song_url_v1') throw new Error('xeapi public key response missing sk')
    return { body: { code: 200, data: [{ id: 123, url: 'https://music.test/track.mp3' }] } }
  })
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=private')
  const reply = await service.call({ method: 'stream', args: { id: '123' } })
  expect(reply.ok).toBe(true)
  expect(invoke.mock.calls[1]).toEqual([
    'song_url',
    { id: '123', br: 320000, cookie: 'MUSIC_U=private', timeout: 12000 },
  ])
  expect(reply.data.compatibility.source).toBe('song_url')
  expect(JSON.stringify(reply.trace)).not.toContain('track.mp3')
})
it('never reuses the upstream cache key across POST requests and retains room-expiry errors', async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ code: 488, message: '房间失效' }), { status: 488 }),
  )
  const invoke = createHttpInvoker('http://127.0.0.1:3000', fetcher as any)
  for (let i = 0; i < 2; i++)
    await expect(invoke('api', { data: { i } })).rejects.toMatchObject({ body: { code: 488 } })
  const calls = fetcher.mock.calls as any
  expect(calls[0][0].search).not.toBe(calls[1][0].search)
  expect(calls[0][1].headers['x-apicache-bypass']).toBe('true')
})

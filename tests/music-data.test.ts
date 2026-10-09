import { expect, it, vi } from 'vitest'
import {
  allAlbums,
  allPlaylists,
  songsByIds,
  parseLyrics,
  likedPlaylist,
  writablePlaylists,
  playlistFrom,
} from '../src/renderer/src/music-data'
import { nextQueueIndex } from '../src/shared/personal-queue'
import { ApiService, validate } from '../src/main/service'
it('loads all subscribed album pages without duplicates and preserves artist metadata', async () => {
  const api = vi.fn(async (_method, args) =>
    args.offset === 0
      ? {
          data: [
            { id: 1, name: '专辑', artists: [{ name: 'A' }, { name: 'B' }], size: 10 },
            { id: 2 },
          ],
          hasMore: true,
        }
      : { data: [{ id: 2 }, { id: 3 }], hasMore: false },
  )
  const albums = await allAlbums(
    api,
    () => true,
    () => {},
  )
  expect(albums.map((album) => album.id)).toEqual(['1', '2', '3'])
  expect(albums[0]).toMatchObject({ artist: 'A / B', count: 10 })
  expect(api.mock.calls[1][1]).toEqual({ offset: 2 })
})
it('does not report repeated or cancelled album pages as a complete library', async () => {
  await expect(
    allAlbums(
      async () => ({ data: [{ id: 1 }], hasMore: true }),
      () => true,
      () => {},
    ),
  ).rejects.toThrow('分页未继续前进')
  let active = true
  const progress = vi.fn()
  await allAlbums(
    async () => {
      active = false
      return { data: [{ id: 1 }], hasMore: false }
    },
    () => active,
    progress,
  )
  expect(progress).not.toHaveBeenCalled()
})
it('loads every playlist page, deduplicates overlaps, and uses the actual page offset', async () => {
  const api = vi.fn(async (_method, args) =>
    args.offset === 0
      ? { playlist: [{ id: 1 }, { id: 2 }], more: true }
      : { playlist: [{ id: 2 }, { id: 3 }], more: false },
  )
  const result = await allPlaylists(
    api,
    '123',
    () => true,
    () => {},
  )
  expect(result.map((p) => p.id)).toEqual(['1', '2', '3'])
  expect(api.mock.calls[1][1].offset).toBe(2)
})
it('fails visibly on repeated pages instead of silently calling a partial library complete', async () => {
  await expect(
    allPlaylists(
      async () => ({ playlist: [{ id: 1 }], more: true }),
      '123',
      () => true,
      () => {},
    ),
  ).rejects.toThrow('尚未加载完整')
})
it('ignores a late page after the account has changed', async () => {
  let active = true
  const progress = vi.fn()
  await allPlaylists(
    async () => {
      active = false
      return { playlist: [{ id: 1 }], more: false }
    },
    '123',
    () => active,
    progress,
  )
  expect(progress).not.toHaveBeenCalled()
})
it('keeps original playlist order when song-detail results arrive reordered or missing', async () => {
  const songs = await songsByIds(
    async () => ({
      songs: [
        { id: 3, name: 'third' },
        { id: 1, name: 'first' },
      ],
    }),
    ['1', '2', '3'],
  )
  expect(songs.map((s) => s.id)).toEqual(['1', '3'])
})
it('uses the current account’s ordered favorite playlist rather than unordered like IDs', async () => {
  const playlists = [
    { id: 1, specialType: 5, creator: { userId: 456 } },
    { id: 2, specialType: 0, creator: { userId: 123 } },
    { id: 3, specialType: 5, creator: { userId: 123 } },
  ].map(playlistFrom)
  expect(likedPlaylist(playlists, '123')?.id).toBe('3')
  expect(likedPlaylist(playlists, null)).toBeUndefined()
  expect(writablePlaylists(playlists, '123').map((playlist) => playlist.id)).toEqual(['2'])
  // The list endpoint is explicitly unordered; the same playlist trackIds drive both views.
  const ordered = ['9', '2', '7']
  const items = await songsByIds(
    async () => ({ songs: [{ id: 2 }, { id: 7 }, { id: 9 }] }),
    ordered,
  )
  expect(items.map((song) => song.id)).toEqual(ordered)
})
it('adds one song only after rechecking the current account and owned target playlist', async () => {
  const invoke = vi.fn(async (endpoint: string) => ({
    body:
      endpoint === 'login_status'
        ? { data: { code: 200, profile: { userId: 123 } } }
        : endpoint === 'playlist_detail'
          ? { code: 200, playlist: { id: 9, creator: { userId: 123 }, trackIds: [] } }
          : { code: 200 },
  }))
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=playlist-fixture')
  expect(
    (
      await service.call({
        method: 'playlistAdd',
        args: { uid: '123', playlistId: '9', songId: '7' },
      })
    ).ok,
  ).toBe(true)
  expect(invoke.mock.calls.map(([endpoint]) => endpoint)).toEqual([
    'login_status',
    'playlist_detail',
    'api',
  ])
  expect(invoke.mock.calls[2]).toEqual([
    'api',
    {
      uri: '/api/playlist/manipulate/tracks',
      crypto: 'weapi',
      data: { op: 'add', pid: '9', trackIds: '["7"]', imme: 'true' },
      cookie: 'MUSIC_U=playlist-fixture',
      timeout: 12000,
    },
  ])
})
it.each([
  { name: 'collected playlist', playlist: { creator: { userId: 456 }, trackIds: [] } },
  {
    name: 'favorite playlist',
    playlist: { creator: { userId: 123 }, specialType: 5, trackIds: [] },
  },
  { name: 'unconfirmed contents', playlist: { creator: { userId: 123 } } },
])('blocks adding to $name before any mutation', async ({ playlist }) => {
  const invoke = vi.fn(async (endpoint: string) => ({
    body:
      endpoint === 'login_status'
        ? { data: { profile: { userId: 123 } } }
        : { code: 200, playlist: { id: 9, ...playlist } },
  }))
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=playlist-fixture')
  expect(
    (
      await service.call({
        method: 'playlistAdd',
        args: { uid: '123', playlistId: '9', songId: '7' },
      })
    ).ok,
  ).toBe(false)
  expect(invoke.mock.calls).toHaveLength(2)
  expect(invoke.mock.calls.some(([endpoint]) => endpoint === 'api')).toBe(false)
})
it('confirms an existing track without writing it again', async () => {
  const invoke = vi.fn(async (endpoint: string) => ({
    body:
      endpoint === 'login_status'
        ? { data: { profile: { userId: 123 } } }
        : { code: 200, playlist: { id: 9, creator: { userId: 123 }, trackIds: [{ id: 7 }] } },
  }))
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=playlist-fixture')
  expect(
    await service.call({
      method: 'playlistAdd',
      args: { uid: '123', playlistId: '9', songId: '7' },
    }),
  ).toMatchObject({ ok: true, data: { alreadyExists: true } })
  expect(invoke).toHaveBeenCalledTimes(2)
})
it.each([{ code: 500 }, { code: 200, data: false }, { code: 200, data: { result: false } }, {}])(
  'requires business confirmation for playlist changes: %j',
  async (body) => {
    const invoke = vi.fn(async (endpoint: string) => ({
      body:
        endpoint === 'login_status'
          ? { data: { profile: { userId: 123 } } }
          : endpoint === 'playlist_detail'
            ? { code: 200, playlist: { id: 9, creator: { userId: 123 }, trackIds: [] } }
            : body,
    }))
    const service = new ApiService(invoke)
    service.restore('MUSIC_U=playlist-fixture')
    expect(
      (
        await service.call({
          method: 'playlistAdd',
          args: { uid: '123', playlistId: '9', songId: '7' },
        })
      ).ok,
    ).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(3)
  },
)
it('invalidates playlist preflight after account changes and blocks stale rendered UIDs', async () => {
  let resolve!: (value: any) => void
  const pending = new Promise<any>((done) => {
    resolve = done
  })
  const invoke = vi.fn(() => pending)
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=first-fixture')
  const reply = service.call({
    method: 'playlistAdd',
    args: { uid: '123', playlistId: '9', songId: '7' },
  })
  await Promise.resolve()
  service.restore('MUSIC_U=second-fixture')
  resolve({ body: { data: { profile: { userId: 123 } } } })
  expect(await reply).toMatchObject({ ok: false, code: 409 })
  expect(invoke).toHaveBeenCalledTimes(1)
  const other = vi.fn(async () => ({ body: { data: { profile: { userId: 456 } } } }))
  const current = new ApiService(other)
  current.restore('MUSIC_U=second-fixture')
  expect(
    await current.call({
      method: 'playlistAdd',
      args: { uid: '123', playlistId: '9', songId: '7' },
    }),
  ).toMatchObject({ ok: false, error: '账号已变化，请重新选择歌单' })
  expect(other).toHaveBeenCalledTimes(1)
})
it('restricts playlist addition to one positive song, playlist and expected account', () => {
  expect(() =>
    validate({ method: 'playlistAdd', args: { uid: '123', playlistId: '9', songId: '7' } }),
  ).not.toThrow()
  for (const args of [
    { uid: '123', playlistId: '9', songId: '7,8' },
    { uid: '123', playlistId: '0', songId: '7' },
    { uid: '123', playlistId: '9', songId: '7', uri: '/arbitrary' },
    { uid: '123', playlistId: '9', songId: '7', op: 'del' },
  ])
    expect(() => validate({ method: 'playlistAdd', args })).toThrow()
})
it('supports multiple LRC timestamps, fractional milliseconds, metadata and offset', () => {
  expect(parseLyrics('[ar:Artist]\n[offset:100]\n[01:02.50][02:03.005]hello')).toEqual([
    { time: 62400, text: 'hello' },
    { time: 122905, text: 'hello' },
  ])
})
it('distinguishes manual skip from automatic repeat and stops at the end of an ordered queue', () => {
  expect(nextQueueIndex(3, 2, 1, 'order', true)).toBeNull()
  expect(nextQueueIndex(3, 2, 1, 'loop', true)).toBe(0)
  expect(nextQueueIndex(3, 1, 1, 'single', true)).toBe(1)
  expect(nextQueueIndex(3, 1, 1, 'single', false)).toBe(2)
  expect(nextQueueIndex(0, -1, 1, 'loop')).toBeNull()
})
it('converts unlike to the upstream string flag and preserves the authenticated session', async () => {
  const invoke = vi.fn(async () => ({ body: { code: 200 } }))
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=test')
  expect((await service.call({ method: 'like', args: { id: '123', value: false } })).ok).toBe(true)
  expect(invoke.mock.calls[0]).toEqual([
    'like',
    { id: '123', like: 'false', cookie: 'MUSIC_U=test', timeout: 12000 },
  ])
})
it('accepts constrained search pagination and rejects malformed library parameters', () => {
  expect(() =>
    validate({ method: 'search', args: { keywords: 'artist', kind: 'artists', offset: 30 } }),
  ).not.toThrow()
  expect(() => validate({ method: 'playlists', args: { uid: '123', offset: -1 } })).toThrow()
  expect(() => validate({ method: 'like', args: { id: '123', value: 'false' } })).toThrow()
  expect(() => validate({ method: 'search', args: { keywords: 'x', kind: 'script' } })).toThrow()
})

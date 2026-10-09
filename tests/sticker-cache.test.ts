import { expect, it, vi } from 'vitest'
import {
  StickerLibrary,
  stickerLibrary,
  stickersChanged,
  rememberSticker,
  isStickerSaved,
} from '../src/renderer/src/sticker-cache'
import type { SavedSticker } from '../src/shared/stickers'
const sticker = (id: string): SavedSticker => ({
  emojiId: id,
  emojiGroupId: '-2',
  emojiName: id,
  emojiImgUrl: `https://p1.music.126.net/${id}.png`,
  width: 1,
  height: 1,
  format: 'png',
  picId: id,
  restricted: false,
  restriction: '',
})
const page = (ids: string[], cursor = '') => ({
  data: { emojis: ids.map(sticker), page: { more: !!cursor, cursor } },
})
const groups = { data: { emojiGroups: [{ id: -2, name: '我的表情', edit: true }] } }

it('loads on demand and retains loaded pages, cursor and scroll when reopening', async () => {
  const api = vi.fn(async (method, args) =>
    method === 'stickerGroups'
      ? groups
      : args?.cursor === 'tail'
        ? page(['3'])
        : page(['1', '2'], 'tail'),
  )
  const library = new StickerLibrary('account', 'room')
  await library.ensure(api)
  expect([...library.page().items.keys()]).toEqual(['1', '2'])
  expect(api).toHaveBeenCalledTimes(2)
  library.page().scroll = 317
  await library.load(api)
  await library.ensure(api)
  expect(api).toHaveBeenCalledTimes(3)
  expect([...library.page().items.keys()]).toEqual(['1', '2', '3'])
  expect(library.page().scroll).toBe(317)
})
it('deletes locally without reloading and prevents an older pending page from restoring the deleted item', async () => {
  let resolve!: (value: any) => void
  const api = vi.fn(async (method, args) =>
    method === 'stickerGroups'
      ? groups
      : args?.cursor
        ? new Promise((done) => {
            resolve = done
          })
        : page(['1', '2'], 'tail'),
  )
  const library = new StickerLibrary('account', 'private')
  await library.ensure(api)
  const pending = library.load(api)
  library.remove(['2'])
  expect([...library.page().items.keys()]).toEqual(['1'])
  resolve(page(['2', '3'], 'next'))
  await pending
  expect([...library.page().items.keys()]).toEqual(['1', '3'])
  expect(library.page().cursor).toBe('next')
  expect(library.page().dirty).toBe(false)
  const calls = api.mock.calls.length
  await library.ensure(api)
  expect(api).toHaveBeenCalledTimes(calls)
})
it('refreshes only an unknown prefix and preserves an already loaded tail and opaque cursor', async () => {
  const library = new StickerLibrary('account', 'private')
  let refreshing = false
  const api = vi.fn(async (method, args) => {
    if (method === 'stickerGroups') return groups
    if (refreshing)
      return args?.cursor === 'unknown' ? page(['8', '1'], 'unused') : page(['9'], 'unknown')
    return args?.cursor === 'tail' ? page(['3'], 'last') : page(['1', '2'], 'tail')
  })
  await library.ensure(api)
  await library.load(api)
  library.page().scroll = 100
  refreshing = true
  await library.ensure(api, true)
  expect([...library.page().items.keys()]).toEqual(['9', '8', '1', '2', '3'])
  expect(library.page().cursor).toBe('last')
  expect(library.page().more).toBe(true)
  expect(library.page().scroll).toBe(100)
  expect(api.mock.calls.filter(([method]) => method === 'stickerPage')).toHaveLength(4)
})
it('shares confirmed mutations across room and private views and clears saved state on account change', () => {
  const room = stickerLibrary('account-1', 'room'),
    privateView = stickerLibrary('account-1', 'private')
  room.page('group').items.set('1', sticker('1'))
  privateView.page('group').items.set('1', sticker('1'))
  rememberSticker('account-1', sticker('1'))
  expect(isStickerSaved('account-1', sticker('1'))).toBe(true)
  stickersChanged('account-1', ['1'])
  expect(room.page('group').items.size).toBe(0)
  expect(privateView.page('group').items.size).toBe(0)
  expect(isStickerSaved('account-1', sticker('1'))).toBe(false)
  rememberSticker('account-1', sticker('2'))
  stickerLibrary('account-2', 'room')
  expect(isStickerSaved('account-1', sticker('2'))).toBe(false)
  expect(stickerLibrary('account-2', 'room').groupsLoaded).toBe(false)
})
it('preserves existing items on an invalid page and stops a repeating cursor', async () => {
  const library = new StickerLibrary('account', 'room')
  const api = vi.fn(async (method) => (method === 'stickerGroups' ? groups : page(['1'], 'same')))
  await library.ensure(api)
  await library.load(api)
  expect(library.error).toContain('继续前进')
  expect([...library.page().items.keys()]).toEqual(['1'])
})

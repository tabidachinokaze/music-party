import { afterEach, expect, it, vi } from 'vitest'
import { recentStickers, rememberRecentStickers } from '../src/renderer/src/recent-stickers'
import { composerEmojis } from '../src/renderer/src/composer-text'

const use = (id: string, time: number) => ({
  time,
  emoji: {
    emojiId: id,
    emojiGroupId: '-2',
    emojiName: `表情${id}`,
    emojiImgUrl: `https://p1.music.126.net/${id}.gif`,
    format: 'gif',
    width: 64,
    height: 64,
  },
})

afterEach(() => vi.unstubAllGlobals())

it('restores recently used images per account and keeps an older page from reordering them', () => {
  const profile = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => profile.get(key) ?? null,
    setItem: (key: string, value: string) => profile.set(key, value),
  })
  rememberRecentStickers('123', [use('1', 1), use('2', 2)])
  rememberRecentStickers('123', [use('1', 3)])
  rememberRecentStickers('123', [use('2', 2), use('1', 1)])
  expect(recentStickers('123')).toEqual([use('1', 3).emoji, use('2', 2).emoji])
  expect(recentStickers('456')).toEqual([])
  rememberRecentStickers('456', [use('3', 99)])
  expect(recentStickers('123')).toHaveLength(2)
  rememberRecentStickers(
    '123',
    Array.from({ length: 32 }, (_, n) => use(String(n + 10), n + 4)),
  )
  expect(recentStickers('123')).toHaveLength(32)
  expect(recentStickers('123').at(-1)).toEqual(use('10', 4).emoji)
})

it('offers the original and migrated text emoji once in the composer', () => {
  expect(new Set(composerEmojis).size).toBe(composerEmojis.length)
  expect(composerEmojis).toEqual(expect.arrayContaining(['💙', '🥹', '🎸', '💯', '👀']))
})

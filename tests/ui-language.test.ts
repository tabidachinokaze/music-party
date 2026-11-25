import { describe, expect, it } from 'vitest'
import {
  catalogs,
  isUiLanguage,
  resolveUiLanguage,
  translateIn,
  type MessageKey,
} from '../src/shared/ui-language'

describe('interface language', () => {
  it.each([
    [['fr', 'ja-JP', 'en'], 'ja'],
    [['fr', 'zh_HK.UTF-8'], 'zh-TW'],
    [['zh-Hant-CN'], 'zh-TW'],
    [['zh-Hans-TW'], 'zh-CN'],
    [['zh-MO'], 'zh-TW'],
    [['zh-SG'], 'zh-CN'],
    [['zh'], 'zh-CN'],
    [['bad locale', 'en-GB', 'ja'], 'en'],
    [['de', 'fr'], 'en'],
    [[], 'en'],
  ] as const)('matches system preferences %j to %s', (languages, expected) => {
    expect(resolveUiLanguage('system', languages)).toBe(expected)
  })

  it('honors each manual preference regardless of device language', () => {
    for (const locale of Object.keys(catalogs)) {
      expect(isUiLanguage(locale)).toBe(true)
      if (isUiLanguage(locale)) expect(resolveUiLanguage(locale, ['de'])).toBe(locale)
    }
    expect(isUiLanguage('system')).toBe(false)
    expect(isUiLanguage('constructor')).toBe(false)
  })

  it('keeps catalog keys and named parameters in sync in every plural form', () => {
    const keys = Object.keys(catalogs.en).sort() as MessageKey[]
    const names = (s: string) =>
      [...new Set(Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]))].sort()
    for (const [locale, messages] of Object.entries(catalogs)) {
      expect(Object.keys(messages).sort(), locale).toEqual(keys)
      for (const key of keys) {
        const base = catalogs.en[key]
        const expected = names(typeof base === 'string' ? base : base.other)
        const message = messages[key]
        for (const form of typeof message === 'string' ? [message] : Object.values(message)) {
          expect(form.trim().length, locale + ' ' + key).toBeGreaterThan(0)
          expect(names(form), locale + ' ' + key).toEqual(expected)
        }
      }
    }
  })

  it('handles English plurals and inserts user data verbatim', () => {
    expect([0, 1, 2].map((count) => translateIn('en', 'music.trackCount', { count }))).toEqual([
      '0 tracks',
      '1 track',
      '2 tracks',
    ])
    expect(translateIn('ja', 'music.trackCount', { count: 2 })).toBe('2曲')
    expect(translateIn('zh-TW', 'music.trackCount', { count: 1 })).toBe('1 首')
    expect(translateIn('en', 'chat.sharedAlbum', { name: '{count} $1 初音ミク' })).toBe(
      '[Shared album] {count} $1 初音ミク',
    )
  })
})

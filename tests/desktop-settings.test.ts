import { expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PLAYER_BACKGROUND,
  PLAYER_BACKGROUND_LIMITS,
  restoreWindow,
  validateMediaState,
  validatePreferences,
} from '../src/shared/desktop'
import { SettingsStore } from '../src/main/settings'
it('rejects unbounded settings, unknown preferences, and invalid media destinations', () => {
  expect(() => validatePreferences({ volume: Infinity })).toThrow()
  expect(() => validatePreferences({ volume: 1.1 })).toThrow()
  expect(() => validatePreferences({ theme: 'javascript' })).toThrow()
  expect(() => validatePreferences({ cookie: 'secret' })).toThrow()
  expect(() =>
    validateMediaState({
      title: '',
      artist: '',
      playing: false,
      canToggle: false,
      canNext: false,
      canPrevious: false,
      roomId: '../other',
    }),
  ).toThrow()
})
it('persists a self-contained player background, restores older defaults and supports reset', () => {
  const directory = mkdtempSync(join(tmpdir(), 'music-party-background-'))
  const file = join(directory, 'settings.json'),
    source = join(directory, 'source.png'),
    png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
      'base64',
    )
  try {
    writeFileSync(file, JSON.stringify({ preferences: { volume: 0.45 } }))
    const store = new SettingsStore(file)
    expect(store.preferences.playerBackground).toEqual(DEFAULT_PLAYER_BACKGROUND)
    writeFileSync(source, png)
    const image = `data:image/png;base64,${readFileSync(source).toString('base64')}`,
      background = { image, zoom: 180.5, opacity: 55, blur: 4.5, x: 40, y: 72 }
    store.update({ playerBackground: background })
    rmSync(source)
    expect(new SettingsStore(file).preferences.playerBackground).toEqual(background)
    expect(new SettingsStore(file).preferences.volume).toBe(0.45)
    store.update({ playerBackground: { ...background, image: null } })
    expect(new SettingsStore(file).preferences.playerBackground).toEqual({
      ...background,
      image: null,
    })
    store.update({ playerBackground: DEFAULT_PLAYER_BACKGROUND })
    expect(new SettingsStore(file).preferences.playerBackground).toEqual(DEFAULT_PLAYER_BACKGROUND)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
it('rejects unsafe background URIs, missing fields and values outside editor bounds', () => {
  for (const image of [
    '/tmp/private.png',
    'file:///C:/private.png',
    'https://example.com/image.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/jpeg;base64,/9j/2Q==',
    'data:image/png;base64,PG5vdC1hbi1pbWFnZT4=',
    `data:image/png;base64,${'A'.repeat(Math.ceil((PLAYER_BACKGROUND_LIMITS.storedBytes + 3) / 3) * 4)}`,
  ])
    expect(() =>
      validatePreferences({ playerBackground: { ...DEFAULT_PLAYER_BACKGROUND, image } }),
    ).toThrow()
  for (const [key, value] of [
    ['zoom', 99],
    ['zoom', 301],
    ['opacity', -1],
    ['opacity', 101],
    ['blur', -1],
    ['blur', 31],
    ['x', -1],
    ['x', 101],
    ['y', Infinity],
    ['y', NaN],
    ['y', '50'],
  ])
    expect(() =>
      validatePreferences({ playerBackground: { ...DEFAULT_PLAYER_BACKGROUND, [key]: value } }),
    ).toThrow()
  for (const playerBackground of [
    null,
    [],
    { image: null },
    { ...DEFAULT_PLAYER_BACKGROUND, path: '/tmp/private.png' },
  ])
    expect(() => validatePreferences({ playerBackground })).toThrow()
  expect(
    validatePreferences({
      playerBackground: { image: null, zoom: 300, opacity: 0, blur: 30, x: 0, y: 100 },
    }),
  ).toHaveProperty('playerBackground.zoom', 300)
})
it('leaves saved background unchanged after invalid updates and keeps defaults isolated', () => {
  const directory = mkdtempSync(join(tmpdir(), 'music-party-background-invalid-'))
  const file = join(directory, 'settings.json')
  try {
    const store = new SettingsStore(file),
      another = new SettingsStore(join(directory, 'another.json'))
    store.preferences.playerBackground.x = 20
    expect(another.preferences.playerBackground.x).toBe(50)
    expect(DEFAULT_PLAYER_BACKGROUND.x).toBe(50)
    store.update({ playerBackground: { ...DEFAULT_PLAYER_BACKGROUND, blur: 8 } })
    const saved = readFileSync(file, 'utf8')
    expect(() =>
      store.update({ playerBackground: { ...DEFAULT_PLAYER_BACKGROUND, zoom: Infinity } }),
    ).toThrow()
    expect(readFileSync(file, 'utf8')).toBe(saved)
    expect(new SettingsStore(file).preferences.playerBackground.blur).toBe(8)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
it('relocates a disconnected-monitor window inside an available display', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 }
  const result = restoreWindow({ x: 7000, y: 6000, width: 1280, height: 850, maximized: false }, [
    area,
  ])
  expect(result.x).toBeGreaterThanOrEqual(0)
  expect(result.y).toBeGreaterThanOrEqual(0)
  expect(result.x! + result.width).toBeLessThanOrEqual(area.width)
  expect(result.y! + result.height).toBeLessThanOrEqual(area.height)
})
it('keeps valid negative monitor coordinates and fits small displays', () => {
  expect(
    restoreWindow({ x: -1800, y: 50, width: 1100, height: 760, maximized: true }, [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: -1920, y: 0, width: 1920, height: 1080 },
    ]),
  ).toMatchObject({ x: -1800, y: 50, maximized: true })
  expect(restoreWindow(undefined, [{ x: 0, y: 0, width: 800, height: 600 }])).toMatchObject({
    width: 800,
    height: 600,
  })
})
it('persists preferences independently of window geometry and recovers a corrupted file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'music-party-settings-'))
  const file = join(directory, 'settings.json')
  try {
    const first = new SettingsStore(file)
    first.update({ volume: 0.23, theme: 'light', closeToTray: false, repeatMode: 'loop' })
    first.saveWindow({ x: 100, y: 80, width: 1200, height: 800, maximized: false })
    const second = new SettingsStore(file)
    expect(second.preferences).toEqual({
      ...DEFAULT_PREFERENCES,
      volume: 0.23,
      theme: 'light',
      closeToTray: false,
      repeatMode: 'loop',
    })
    expect(second.window?.width).toBe(1200)
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
    expect(() => second.update({ volume: -1 })).toThrow()
    expect(new SettingsStore(file).preferences.volume).toBe(0.23)
    writeFileSync(file, '{not-json')
    const repaired = new SettingsStore(file)
    expect(repaired.preferences).toEqual(DEFAULT_PREFERENCES)
    expect(repaired.error).toContain('默认设置')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
it('persists custom appearance while accepting older settings without appearance keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'music-party-appearance-'))
  const file = join(directory, 'settings.json')
  try {
    writeFileSync(file, JSON.stringify({ preferences: { volume: 0.3, theme: 'light' } }))
    const store = new SettingsStore(file)
    expect(store.preferences).toMatchObject({ fontScale: 100, accentColor: null, volume: 0.3 })
    store.update({ fontScale: 145, accentColor: '#448AFF' })
    expect(new SettingsStore(file).preferences).toMatchObject({
      fontScale: 145,
      accentColor: '#448aff',
    })
    for (const fontScale of [79, 151, 100.5, NaN, Infinity, '125'])
      expect(() => store.update({ fontScale })).toThrow()
    for (const accentColor of ['red', '#abc', '#gggggg', 'url(javascript:alert(1))', 3])
      expect(() => store.update({ accentColor })).toThrow()
    store.update({ fontScale: 100, accentColor: null })
    expect(new SettingsStore(file).preferences).toMatchObject({ fontScale: 100, accentColor: null })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

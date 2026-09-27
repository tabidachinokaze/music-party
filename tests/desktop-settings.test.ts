import { expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_PREFERENCES,
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

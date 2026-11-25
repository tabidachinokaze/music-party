import { t } from '../shared/ui-language'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PLAYER_BACKGROUND,
  validatePreferences,
  type Preferences,
  type WindowGeometry,
} from '../shared/desktop'

export class SettingsStore {
  preferences: Preferences = {
    ...DEFAULT_PREFERENCES,
    playerBackground: { ...DEFAULT_PLAYER_BACKGROUND },
  }
  window: WindowGeometry | undefined
  private errorReason: 'read' | 'write' | null = null
  get error() {
    if (this.errorReason === 'read')
      return t('settings.savedSettingsCouldntBeReadDefaultSettingsAre')
    if (this.errorReason === 'write')
      return t('settings.couldntSaveSettingsCheckPermissionsForTheApp')
    return ''
  }
  constructor(private file: string) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      this.preferences = { ...this.preferences, ...validatePreferences(saved.preferences || {}) }
      const window = saved.window
      if (window && Number.isFinite(window.width) && Number.isFinite(window.height))
        this.window = {
          x: Number.isFinite(window.x) ? window.x : undefined,
          y: Number.isFinite(window.y) ? window.y : undefined,
          width: window.width,
          height: window.height,
          maximized: window.maximized === true,
        }
    } catch (e: any) {
      if (e.code !== 'ENOENT') this.errorReason = 'read'
    }
  }
  update(value: unknown) {
    const next = {
      ...this.preferences,
      ...validatePreferences(value, this.preferences.playerBackground),
    }
    this.save(next, this.window)
    this.preferences = next
    return next
  }
  saveWindow(value: WindowGeometry) {
    this.save(this.preferences, value)
    this.window = value
  }
  private save(preferences: Preferences, window: WindowGeometry | undefined) {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const temporary = this.file + '.tmp'
      writeFileSync(temporary, JSON.stringify({ version: 1, preferences, window }, null, 2), {
        mode: 0o600,
      })
      renameSync(temporary, this.file)
      this.errorReason = null
    } catch {
      this.errorReason = 'write'
      throw new Error(this.error)
    }
  }
}

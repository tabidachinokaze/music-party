import {
  app,
  Menu,
  nativeImage,
  nativeTheme,
  Tray,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron'
import { join } from 'node:path'
import {
  getUiLanguage,
  resolveUiLanguage,
  setUiLanguage,
  t,
  type UiLanguage,
} from '../shared/ui-language'
import {
  validateMediaState,
  type DesktopInfo,
  type DesktopMediaState,
  type PlayerCommand,
} from '../shared/desktop'
import type { SettingsStore } from './settings'
import type { FullScreenController } from './fullscreen'

export function windowBackground(dark: boolean) {
  return dark ? '#121116' : '#f6f6f6'
}

export class DesktopController {
  fullscreen: FullScreenController | null = null
  private tray: Tray | null = null
  media: DesktopMediaState = {
    title: '',
    artist: '',
    playing: false,
    canToggle: false,
    canNext: false,
    canPrevious: false,
    roomId: null,
  }
  constructor(
    private store: SettingsStore,
    private window: () => BrowserWindow | null,
    private quit: () => void,
    private languageChanged: (language: UiLanguage) => void,
  ) {}
  private syncLanguage() {
    const { language } = this.store.preferences
    const resolved = resolveUiLanguage(
      language,
      language === 'system' ? app.getPreferredSystemLanguages() : [],
    )
    if (resolved === getUiLanguage()) return false
    setUiLanguage(resolved)
    this.languageChanged(resolved)
    return true
  }
  private refreshSystemLanguage = () => {
    if (this.store.preferences.language === 'system' && this.syncLanguage()) {
      this.refreshMenus()
      this.notify()
    }
  }
  setup() {
    this.syncLanguage()
    app.on('browser-window-focus', this.refreshSystemLanguage)
    nativeTheme.themeSource = this.store.preferences.theme
    try {
      const icon = nativeImage
        .createFromPath(join(app.getAppPath(), 'resources/tray.png'))
        .resize({ width: 22, height: 22 })
      if (icon.isEmpty()) throw new Error('Tray icon missing')
      if (process.platform === 'darwin') icon.setTemplateImage(true)
      this.tray = new Tray(icon)
      this.tray.setToolTip('Music Party')
      this.tray.on('click', () => this.show())
      this.tray.on('double-click', () => this.show())
    } catch {
      this.tray = null
    }
    this.refreshMenus()
    nativeTheme.on('updated', () => {
      const win = this.window()
      if (win && !win.isDestroyed())
        win.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors))
      this.notify()
    })
  }
  get trayAvailable() {
    return this.tray !== null && !this.tray.isDestroyed()
  }
  info(): DesktopInfo {
    return {
      preferences: { ...this.store.preferences },
      trayAvailable: this.trayAvailable,
      maximized: this.window()?.isMaximized() ?? false,
      fullScreen: this.fullscreen?.value ?? false,
      fullScreenRevision: this.fullscreen?.revision ?? 0,
      resolvedLanguage: getUiLanguage(),
      resolvedTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      platform: process.platform,
      persistenceError: this.store.error,
    }
  }
  notify() {
    this.window()?.webContents.send('desktop-info', this.info())
  }
  updatePreferences(value: unknown): DesktopInfo {
    const previousScale = this.store.preferences.fontScale
    this.store.update(value)
    this.syncLanguage()
    if (this.store.preferences.fontScale !== previousScale)
      this.window()?.webContents.setZoomFactor(this.store.preferences.fontScale / 100)
    nativeTheme.themeSource = this.store.preferences.theme
    this.refreshMenus()
    this.notify()
    return this.info()
  }
  stepDisplaySize(direction: 'in' | 'out') {
    const current = this.store.preferences.fontScale
    const next = Math.max(80, Math.min(150, current + (direction === 'in' ? 10 : -10)))
    if (next !== current) this.updatePreferences({ fontScale: next })
  }
  updateMedia(value: unknown) {
    this.media = validateMediaState(value)
    this.tray?.setToolTip(
      this.media.title
        ? `Music Party · ${this.media.title}${this.media.artist ? ` — ${this.media.artist}` : ''}`
        : 'Music Party',
    )
    this.refreshMenus()
  }
  show() {
    const win = this.window()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  command(command: PlayerCommand) {
    if (['show', 'settings', 'lyrics'].includes(command)) this.show()
    this.window()?.webContents.send('desktop-command', command)
  }
  private playbackItems(): MenuItemConstructorOptions[] {
    return [
      {
        id: 'desktop-toggle',
        label: this.media.playing
          ? this.media.roomId
            ? t('desktop.pauseOnThisDevice')
            : t('common.pause')
          : this.media.roomId
            ? t('desktop.resumeListeningTogether')
            : t('common.play'),
        enabled: this.media.canToggle,
        click: () => this.command('toggle'),
      },
      {
        id: 'desktop-previous',
        label: t('desktop.previousTrack'),
        enabled: this.media.canPrevious,
        click: () => this.command('previous'),
      },
      {
        id: 'desktop-next',
        label: this.media.roomId ? t('common.requestNextTrack') : t('desktop.nextTrack'),
        enabled: this.media.canNext,
        click: () => this.command('next'),
      },
    ]
  }
  private refreshMenus() {
    const controls = this.playbackItems()
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('desktop.showMusicParty'), click: () => this.show() },
        {
          label: this.media.title.slice(0, 80) || t('desktop.nothingIsPlaying'),
          enabled: false,
        },
        ...(this.media.roomId
          ? [
              {
                label: t('desktop.listenTogetherPausingAffectsOnlyThisDevice'),
                enabled: false,
              },
            ]
          : []),
        { type: 'separator' },
        ...controls,
        { type: 'separator' },
        { label: t('common.lyrics'), click: () => this.command('lyrics') },
        { label: t('common.settings'), click: () => this.command('settings') },
        { label: t('common.quitMusicParty'), click: () => this.quit() },
      ]),
    )
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Music Party',
          submenu: [
            { id: 'desktop-show', label: t('desktop.showWindow'), click: () => this.show() },
            {
              label: t('common.settings'),
              accelerator: 'CommandOrControl+,',
              click: () => this.command('settings'),
            },
            { type: 'separator' },
            {
              id: 'desktop-quit',
              label: t('common.quitMusicParty'),
              accelerator: 'CommandOrControl+Q',
              click: () => this.quit(),
            },
          ],
        },
        { label: t('desktop.playback'), submenu: controls },
        {
          label: t('desktop.edit'),
          submenu: [
            { label: t('desktop.undo'), role: 'undo' },
            { label: t('desktop.redo'), role: 'redo' },
            { type: 'separator' },
            { label: t('desktop.cut'), role: 'cut' },
            { label: t('desktop.copy'), role: 'copy' },
            { label: t('desktop.paste'), role: 'paste' },
            { label: t('desktop.selectAll'), role: 'selectAll' },
          ],
        },
        {
          label: t('desktop.window'),
          submenu: [
            { label: t('common.minimize'), role: 'minimize' },
            { label: t('desktop.toggleFullScreen'), role: 'togglefullscreen' },
            {
              label: t('desktop.zoomIn'),
              accelerator: 'CommandOrControl+Plus',
              enabled: this.store.preferences.fontScale < 150,
              click: () => this.stepDisplaySize('in'),
            },
            {
              label: t('desktop.zoomOut'),
              accelerator: 'CommandOrControl+-',
              enabled: this.store.preferences.fontScale > 80,
              click: () => this.stepDisplaySize('out'),
            },
            {
              label: t('desktop.resetZoom'),
              accelerator: 'CommandOrControl+0',
              click: () => this.updatePreferences({ fontScale: 100 }),
            },
            ...(app.isPackaged
              ? []
              : [
                  {
                    label: t('desktop.toggleDeveloperTools'),
                    role: 'toggleDevTools' as const,
                  },
                ]),
          ],
        },
      ]),
    )
  }
  destroy() {
    app.off('browser-window-focus', this.refreshSystemLanguage)
    this.tray?.destroy()
    this.tray = null
  }
}

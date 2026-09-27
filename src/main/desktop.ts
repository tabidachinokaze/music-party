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
  validateMediaState,
  type DesktopInfo,
  type DesktopMediaState,
  type PlayerCommand,
} from '../shared/desktop'
import type { SettingsStore } from './settings'

export class DesktopController {
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
  ) {}
  setup() {
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
      this.window()?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#111214' : '#edeeee')
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
      resolvedTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      platform: process.platform,
      persistenceError: this.store.error,
    }
  }
  notify() {
    this.window()?.webContents.send('desktop-info', this.info())
  }
  updatePreferences(value: unknown): DesktopInfo {
    this.store.update(value)
    nativeTheme.themeSource = this.store.preferences.theme
    this.refreshMenus()
    this.notify()
    return this.info()
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
            ? '暂停本机播放'
            : '暂停'
          : this.media.roomId
            ? '恢复同听'
            : '播放',
        enabled: this.media.canToggle,
        click: () => this.command('toggle'),
      },
      {
        id: 'desktop-previous',
        label: '上一首',
        enabled: this.media.canPrevious,
        click: () => this.command('previous'),
      },
      {
        id: 'desktop-next',
        label: this.media.roomId ? '请求房间下一首' : '下一首',
        enabled: this.media.canNext,
        click: () => this.command('next'),
      },
    ]
  }
  private refreshMenus() {
    const controls = this.playbackItems()
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示 Music Party', click: () => this.show() },
        { label: this.media.title.slice(0, 80) || '还没有正在播放的歌曲', enabled: false },
        ...(this.media.roomId ? [{ label: '官方多人房间 · 暂停仅影响本机', enabled: false }] : []),
        { type: 'separator' },
        ...controls,
        { type: 'separator' },
        { label: '歌词', click: () => this.command('lyrics') },
        { label: '设置', click: () => this.command('settings') },
        { label: '退出 Music Party', click: () => this.quit() },
      ]),
    )
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Music Party',
          submenu: [
            { id: 'desktop-show', label: '显示窗口', click: () => this.show() },
            {
              label: '设置',
              accelerator: 'CommandOrControl+,',
              click: () => this.command('settings'),
            },
            { type: 'separator' },
            {
              id: 'desktop-quit',
              label: '退出 Music Party',
              accelerator: 'CommandOrControl+Q',
              click: () => this.quit(),
            },
          ],
        },
        { label: '播放', submenu: controls },
        {
          label: '编辑',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: '窗口',
          submenu: [
            { role: 'minimize' },
            { role: 'togglefullscreen' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { role: 'resetZoom' },
            ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
          ],
        },
      ]),
    )
  }
  destroy() {
    this.tray?.destroy()
    this.tray = null
  }
}

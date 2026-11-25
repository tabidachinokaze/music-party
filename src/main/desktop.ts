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
import { setUiLanguage, ui } from '../shared/ui-language'
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
  ) {}
  setup() {
    setUiLanguage(this.store.preferences.language)
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
    setUiLanguage(this.store.preferences.language)
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
            ? ui('暂停本机播放', 'Pause on this device')
            : ui('暂停', 'Pause')
          : this.media.roomId
            ? ui('恢复同听', 'Resume listening together')
            : ui('播放', 'Play'),
        enabled: this.media.canToggle,
        click: () => this.command('toggle'),
      },
      {
        id: 'desktop-previous',
        label: ui('上一首', 'Previous track'),
        enabled: this.media.canPrevious,
        click: () => this.command('previous'),
      },
      {
        id: 'desktop-next',
        label: this.media.roomId
          ? ui('请求房间下一首', 'Request next track')
          : ui('下一首', 'Next track'),
        enabled: this.media.canNext,
        click: () => this.command('next'),
      },
    ]
  }
  private refreshMenus() {
    const controls = this.playbackItems()
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: ui('显示 Music Party', 'Show Music Party'), click: () => this.show() },
        {
          label: this.media.title.slice(0, 80) || ui('还没有正在播放的歌曲', 'Nothing is playing'),
          enabled: false,
        },
        ...(this.media.roomId
          ? [
              {
                label: ui(
                  '官方多人房间 · 暂停仅影响本机',
                  'Listen Together · Pausing affects only this device',
                ),
                enabled: false,
              },
            ]
          : []),
        { type: 'separator' },
        ...controls,
        { type: 'separator' },
        { label: ui('歌词', 'Lyrics'), click: () => this.command('lyrics') },
        { label: ui('设置', 'Settings'), click: () => this.command('settings') },
        { label: ui('退出 Music Party', 'Quit Music Party'), click: () => this.quit() },
      ]),
    )
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Music Party',
          submenu: [
            { id: 'desktop-show', label: ui('显示窗口', 'Show window'), click: () => this.show() },
            {
              label: ui('设置', 'Settings'),
              accelerator: 'CommandOrControl+,',
              click: () => this.command('settings'),
            },
            { type: 'separator' },
            {
              id: 'desktop-quit',
              label: ui('退出 Music Party', 'Quit Music Party'),
              accelerator: 'CommandOrControl+Q',
              click: () => this.quit(),
            },
          ],
        },
        { label: ui('播放', 'Playback'), submenu: controls },
        {
          label: ui('编辑', 'Edit'),
          submenu: [
            { label: ui('撤销', 'Undo'), role: 'undo' },
            { label: ui('重做', 'Redo'), role: 'redo' },
            { type: 'separator' },
            { label: ui('剪切', 'Cut'), role: 'cut' },
            { label: ui('复制', 'Copy'), role: 'copy' },
            { label: ui('粘贴', 'Paste'), role: 'paste' },
            { label: ui('全选', 'Select all'), role: 'selectAll' },
          ],
        },
        {
          label: ui('窗口', 'Window'),
          submenu: [
            { label: ui('最小化', 'Minimize'), role: 'minimize' },
            { label: ui('切换全屏', 'Toggle full screen'), role: 'togglefullscreen' },
            {
              label: ui('放大显示', 'Zoom in'),
              accelerator: 'CommandOrControl+Plus',
              enabled: this.store.preferences.fontScale < 150,
              click: () => this.stepDisplaySize('in'),
            },
            {
              label: ui('缩小显示', 'Zoom out'),
              accelerator: 'CommandOrControl+-',
              enabled: this.store.preferences.fontScale > 80,
              click: () => this.stepDisplaySize('out'),
            },
            {
              label: ui('恢复默认大小', 'Reset zoom'),
              accelerator: 'CommandOrControl+0',
              click: () => this.updatePreferences({ fontScale: 100 }),
            },
            ...(app.isPackaged
              ? []
              : [
                  {
                    label: ui('切换开发者工具', 'Toggle developer tools'),
                    role: 'toggleDevTools' as const,
                  },
                ]),
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

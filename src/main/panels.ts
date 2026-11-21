import { BrowserWindow, screen } from 'electron'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import {
  dockAt,
  dockBounds,
  edgeDistance,
  fitBox,
  fits,
  isPanelId,
  panelSize,
  placePanel,
  readablePlacement,
  snapDock,
  type Box,
  type Dock,
  type PanelAction,
  type PanelId,
  type Placement,
  type PrivateMode,
} from '../shared/panels'

interface Panel {
  id: PanelId
  win: BrowserWindow
  dock: Dock | null
  shown: boolean
  mode?: PrivateMode
  noticeRows?: number
  candidate: Dock | null
  last: Box
  drag?: { x: number; y: number; bounds: Box }
}

export class PanelWindows {
  private panels = new Map<PanelId, Panel>()
  private saved = new Map<string, Placement>()
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  constructor(
    private main: BrowserWindow,
    private file: string,
    private quitting: () => boolean,
  ) {
    try {
      for (const [key, value] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) {
        if ((isPanelId(key) || key === 'private:reply') && readablePlacement(value))
          this.saved.set(key, value)
      }
    } catch {}
    main.webContents.setWindowOpenHandler(({ frameName, url }) => {
      const id = frameName.slice(3)
      if (
        url !== 'about:blank' ||
        !frameName.startsWith('mp-') ||
        !isPanelId(id) ||
        this.panels.has(id)
      )
        return { action: 'deny' }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          frame: false,
          show: false,
          autoHideMenuBar: true,
          width: panelSize(id).width,
          height: panelSize(id).height,
          minWidth: 220,
          minHeight: 88,
          backgroundColor: '#fbf7f7',
          title: 'Music Party',
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      }
    })
    main.webContents.on('did-create-window', (win, { frameName }) => {
      const id = frameName.slice(3)
      if (!isPanelId(id)) {
        win.destroy()
        return
      }
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', (e) => e.preventDefault())
      win.setMenu(null)
      const panel: Panel = {
        id,
        win,
        shown: false,
        dock: null,
        candidate: null,
        last: win.getBounds(),
      }
      this.panels.set(id, panel)
      win.on('move', () => this.nativeMove(panel))
      win.on('resize', () => this.nativeResize(panel))
      win.on('close', (e) => {
        if (!this.quitting() && !this.disposed) {
          e.preventDefault()
          this.hide(panel)
        }
      })
      win.on('closed', () => this.panels.delete(id))
    })
    main.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        for (const panel of this.panels.values()) panel.win.destroy()
      }
    })
    main.on('move', this.follow)
    main.on('resize', this.follow)
    main.on('minimize', this.shelve).on('hide', this.shelve)
    main.on('maximize', this.shelve).on('enter-full-screen', this.shelve)
    main.on('restore', this.restore).on('show', this.restore)
    main.on('unmaximize', this.restore).on('leave-full-screen', this.restore)
    screen.on('display-removed', this.relocate)
    screen.on('display-metrics-changed', this.relocate)
    main.on('closed', () => this.destroy())
  }
  private areas() {
    const primary = screen.getDisplayMatching(this.main.getBounds())
    return [
      primary.workArea,
      ...screen
        .getAllDisplays()
        .filter((d) => d.id !== primary.id)
        .map((d) => d.workArea),
    ]
  }
  private occupied(except: Panel) {
    return [...this.panels.values()]
      .filter((p) => p !== except && p.win.isVisible())
      .map((p) => p.win.getBounds())
  }
  private send(p: Panel) {
    if (!this.main.isDestroyed())
      this.main.webContents.send('panel-status', p.id, {
        visible: p.win.isVisible(),
        dock: p.dock?.side ?? null,
        candidate: p.candidate?.side ?? null,
      })
  }
  private set(p: Panel, b: Box) {
    p.last = b
    const old = p.win.getBounds()
    if (old.x !== b.x || old.y !== b.y || old.width !== b.width || old.height !== b.height)
      p.win.setBounds(b)
  }
  private remember(p: Panel) {
    if (p.id === 'private' && p.mode === 'notice') return
    this.saved.set(p.id === 'private' && p.mode === 'reply' ? 'private:reply' : p.id, {
      bounds: p.win.getBounds(),
      dock: p.dock,
    })
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.save(), 300)
  }
  private save() {
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify(Object.fromEntries(this.saved)), {
        mode: 0o600,
      })
      renameSync(this.file + '.tmp', this.file)
    } catch {}
  }
  private position(p: Panel, mode?: PrivateMode, noticeRows = 1) {
    const main = this.main.getBounds(),
      areas = this.areas(),
      occupied = this.occupied(p)
    const savedMode = this.saved.get(
      p.id === 'private' && mode === 'reply' ? 'private:reply' : p.id,
    )
    const size = (mode !== 'notice' && savedMode?.bounds) || panelSize(p.id, mode, noticeRows)
    const saved =
      p.shown && mode !== p.mode
        ? { dock: p.dock, bounds: p.win.getBounds() }
        : (savedMode ?? this.saved.get(p.id))
    const shape = { width: size.width, height: size.height }
    if (saved) {
      const bounds = saved.dock
        ? dockBounds(main, shape, saved.dock)
        : { ...saved.bounds, ...shape }
      if (
        areas.some((a) => fits(bounds, a)) &&
        (!saved.dock || !occupied.some((b) => intersects(b, bounds)))
      )
        return { dock: saved.dock, bounds }
    }
    return placePanel(p.id, main, shape, areas, occupied)
  }
  private hide(p: Panel) {
    if (p.shown) this.remember(p)
    p.shown = false
    p.drag = undefined
    p.candidate = null
    p.win.hide()
    this.send(p)
  }
  private follow = () => {
    if (
      this.disposed ||
      this.main.isDestroyed() ||
      this.main.isMinimized() ||
      this.main.isMaximized() ||
      this.main.isFullScreen()
    )
      return
    for (const p of this.panels.values())
      if (p.dock && !p.drag)
        this.set(p, dockBounds(this.main.getBounds(), p.win.getBounds(), p.dock))
  }
  private shelve = () => {
    for (const p of this.panels.values())
      if (p.dock && p.shown) {
        p.win.hide()
        this.send(p)
      }
  }
  private restore = () => {
    if (
      !this.main.isVisible() ||
      this.main.isMinimized() ||
      this.main.isMaximized() ||
      this.main.isFullScreen()
    )
      return
    this.follow()
    for (const p of this.panels.values())
      if (p.dock && p.shown) {
        p.win.showInactive()
        this.send(p)
      }
  }
  private relocate = () => {
    if (this.main.isDestroyed()) return
    for (const p of this.panels.values()) {
      if (!this.areas().some((area) => fits(p.win.getBounds(), area))) {
        const { bounds, dock } = this.position(p, p.mode, p.noticeRows)
        p.dock = dock
        this.set(p, bounds)
        this.send(p)
      }
    }
  }
  private nativeMove(p: Panel) {
    const bounds = p.win.getBounds()
    if (p.drag || !p.shown || (bounds.x === p.last.x && bounds.y === p.last.y)) return
    // System window managers can move a window independently of our title-bar gesture.
    const main = this.main.getBounds()
    if (p.dock && Math.abs(edgeDistance(main, bounds, p.dock.side) - 8) >= 24) p.dock = null
    if (p.dock) p.dock = dockAt(main, bounds, p.dock.side)
    p.last = bounds
    this.remember(p)
    this.send(p)
  }
  private nativeResize(p: Panel) {
    if (!p.shown || p.drag) return
    if (p.dock) this.set(p, dockBounds(this.main.getBounds(), p.win.getBounds(), p.dock))
    this.remember(p)
  }
  action(id: unknown, action: PanelAction) {
    if (!isPanelId(id) || !action || typeof action !== 'object') throw new Error('窗口操作无效')
    const p = this.panels.get(id)
    if (!p || p.win.isDestroyed()) return
    const main = this.main.getBounds()
    switch (action.type) {
      case 'show': {
        const mode = id === 'private' ? (action.privateMode ?? 'full') : undefined
        const noticeRows =
          mode === 'notice' ? Math.max(1, Math.min(3, Number(action.noticeRows) || 1)) : undefined
        if (!p.win.isVisible() || mode !== p.mode || noticeRows !== p.noticeRows) {
          if (p.shown && mode !== p.mode) this.remember(p)
          const { dock, bounds } = this.position(p, mode, noticeRows)
          if (
            action.passive &&
            (this.main.isMinimized() || !this.main.isVisible() || intersects(bounds, main))
          )
            return this.send(p)
          p.noticeRows = noticeRows
          p.mode = mode
          p.dock = dock
          this.set(p, bounds)
        }
        p.shown = true
        if (p.win.isMinimized()) p.win.restore()
        if (action.passive) p.win.showInactive()
        else {
          p.win.show()
          p.win.focus()
        }
        this.send(p)
        break
      }
      case 'hide':
        this.hide(p)
        break
      case 'detach':
        p.dock = null
        p.candidate = null
        this.remember(p)
        this.send(p)
        break
      case 'dock': {
        const { dock, bounds } = placePanel(
          id,
          main,
          p.win.getBounds(),
          this.areas(),
          this.occupied(p),
        )
        if (dock) {
          p.dock = dock
          this.set(p, bounds)
          this.remember(p)
        }
        this.send(p)
        break
      }
      case 'drag-start':
      case 'drag-move':
      case 'drag-end': {
        if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return
        if (action.type === 'drag-start') {
          p.drag = { x: action.x, y: action.y, bounds: p.win.getBounds() }
          break
        }
        if (!p.drag) return
        const { x, y, bounds } = p.drag
        let next = {
          ...bounds,
          x: Math.round(bounds.x + action.x - x),
          y: Math.round(bounds.y + action.y - y),
        }
        const previous = p.candidate?.side,
          previousDock = p.dock?.side
        if (p.dock) {
          if (Math.abs(edgeDistance(main, next, p.dock.side) - 8) >= 24) p.dock = null
          else {
            p.dock = dockAt(main, next, p.dock.side)
            next = dockBounds(main, next, p.dock)
          }
        }
        p.candidate = p.dock ? null : snapDock(main, next, this.occupied(p))
        if (action.type === 'drag-end') {
          if (p.candidate) {
            p.dock = p.candidate
            next = dockBounds(main, next, p.dock)
          }
          p.candidate = null
          p.drag = undefined
        }
        this.set(p, next)
        if (action.type === 'drag-end') {
          this.remember(p)
          this.send(p)
        } else if (previous !== p.candidate?.side || previousDock !== p.dock?.side) this.send(p)
        break
      }
    }
  }
  destroy() {
    this.disposed = true
    clearTimeout(this.timer)
    this.save()
    screen.removeListener('display-removed', this.relocate)
    screen.removeListener('display-metrics-changed', this.relocate)
    for (const p of this.panels.values()) if (!p.win.isDestroyed()) p.win.destroy()
    this.panels.clear()
  }
}
function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

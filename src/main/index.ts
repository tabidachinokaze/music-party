import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  powerMonitor,
  safeStorage,
  screen,
  shell,
  utilityProcess,
} from 'electron'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Reply, Request, Trace } from '../shared/types'
import { SEND_METHODS } from '../shared/private-messages'
import { validate } from './service'
import { SettingsStore } from './settings'
import { DesktopController } from './desktop'
import { restoreWindow } from '../shared/desktop'
import { autoUpdater } from 'electron-updater'
import { UpdateController } from './updates'
import { PROJECT_LINKS, updateSupport, type ProjectLink } from '../shared/updates'

app.setName('Music Party')
if (process.env.MUSIC_PARTY_PROFILE) app.setPath('userData', process.env.MUSIC_PARTY_PROFILE)
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
let win: BrowserWindow | null = null
let store: SettingsStore
let desktop: DesktopController | null = null
let quitting = false
let quitPrepared = false
let exitPreparation: Promise<void> | null = null
let updates: UpdateController | null = null
let updateTimer: ReturnType<typeof setTimeout> | undefined
let boundsTimer: ReturnType<typeof setTimeout> | undefined
function saveBounds() {
  if (!win || win.isDestroyed() || win.isFullScreen() || !store) return
  try {
    store.saveWindow({ ...win.getNormalBounds(), maximized: win.isMaximized() })
  } catch {
    desktop?.notify()
  }
}
function scheduleBounds() {
  clearTimeout(boundsTimer)
  boundsTimer = setTimeout(saveBounds, 300)
}
app.on('second-instance', () => desktop?.show())
let child: Electron.UtilityProcess | null = null
let nextId = 0
let traces: Trace[] = []
let storageReason = ''
const pending = new Map<
  number,
  { resolve: (reply: Reply) => void; timer: ReturnType<typeof setTimeout> }
>()
function canPersist() {
  return (
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
}
function assertSender(event: Electron.IpcMainInvokeEvent) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
    throw new Error('拒绝非应用窗口请求')
}
function startWorker() {
  const temp = join(app.getPath('userData'), 'api-runtime')
  mkdirSync(temp, { recursive: true, mode: 0o700 })
  const sessionFile = join(app.getPath('userData'), 'session.enc')
  child = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
    serviceName: 'Music Party API',
    stdio: 'ignore',
    env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp, NETEASE_COOKIE: '' },
  })
  let cookie = ''
  if (canPersist()) {
    try {
      cookie = safeStorage.decryptString(readFileSync(sessionFile))
    } catch {}
  }
  child.postMessage({ type: 'restore', cookie })
  child.on('message', (message) => {
    if (message.type === 'cookie') {
      try {
        if (!message.cookie) rmSync(sessionFile, { force: true })
        else if (canPersist())
          writeFileSync(sessionFile, safeStorage.encryptString(message.cookie), { mode: 0o600 })
      } catch {
        storageReason = '保存登录态失败，本次登录仍可继续使用'
      }
    }
    if (message.type === 'reply') {
      const task = pending.get(message.id)
      if (!task) return
      clearTimeout(task.timer)
      pending.delete(message.id)
      const trace = message.reply.trace as Trace | undefined
      if (trace) {
        traces = [...traces.slice(-299), trace]
        win?.webContents.send('trace', trace)
      }
      task.resolve(message.reply)
    }
  })
  child.on('exit', () => {
    child = null
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.resolve({ ok: false, error: 'API 进程已退出，请重启应用' })
    }
    pending.clear()
  })
}

function callApi(request: Request): Promise<Reply> {
  if (!child) return Promise.resolve({ ok: false, error: 'API 进程不可用，请重启应用' })
  return new Promise<Reply>((resolve) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({
        ok: false,
        error: '请求超时，结果未知。请刷新房间状态后再操作',
        deliveryUnknown: SEND_METHODS.has(request.method),
      })
    }, 45000)
    pending.set(id, { resolve, timer })
    child!.postMessage({ type: 'call', id, request })
  })
}

async function prepareExit() {
  if (exitPreparation) return exitPreparation
  quitting = true
  clearTimeout(boundsTimer)
  saveBounds()
  const task = (async () => {
    const roomId = desktop?.media.roomId
    const leave = roomId ? callApi({ method: 'multiLeave', args: { roomId } }) : Promise.resolve()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        leave,
        new Promise((resolve) => {
          timeout = setTimeout(resolve, 3000)
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
    quitPrepared = true
  })()
  exitPreparation = task
  return task
}
function cancelExitPreparation() {
  quitting = false
  quitPrepared = false
  exitPreparation = null
  desktop?.show()
  win?.webContents.send('lifecycle', 'resume')
}

app.whenReady().then(() => {
  if (!primaryInstance) return
  store = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  desktop = new DesktopController(
    store,
    () => win,
    () => app.quit(),
  )
  desktop.setup()
  startWorker()
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = null
  autoUpdater.setFeedURL({ provider: 'github', owner: 'tabidachinokaze', repo: 'music-party' })
  const unsupported = updateSupport(app.isPackaged, process.platform, process.env.APPIMAGE)
  updates = new UpdateController(
    autoUpdater,
    app.getVersion(),
    unsupported,
    (state) => win?.webContents.send('update-state-changed', state),
    async () => {
      await prepareExit()
      app.releaseSingleInstanceLock()
    },
    () => {
      cancelExitPreparation()
      if (!app.requestSingleInstanceLock()) app.quit()
    },
  )
  if (!unsupported) {
    const check = () => {
      if (!quitting) updates?.check()
      updateTimer = setTimeout(check, 6 * 60 * 60 * 1000)
      updateTimer.unref()
    }
    updateTimer = setTimeout(check, 30000)
    updateTimer.unref()
  }
  ipcMain.handle('project-open', async (event, key: unknown) => {
    assertSender(event)
    if (typeof key !== 'string' || !Object.hasOwn(PROJECT_LINKS, key))
      throw new Error('不支持的项目链接')
    await shell.openExternal(PROJECT_LINKS[key as ProjectLink])
  })
  ipcMain.handle('update-state', (event) => {
    assertSender(event)
    return updates!.state
  })
  ipcMain.handle('update-action', (event, action: unknown) => {
    assertSender(event)
    if (action === 'check') return updates!.check()
    if (action === 'download') return updates!.download()
    if (action === 'install') return updates!.install()
    throw new Error('不支持的更新操作')
  })
  powerMonitor.on('suspend', () => win?.webContents.send('lifecycle', 'suspend'))
  powerMonitor.on('resume', () => win?.webContents.send('lifecycle', 'resume'))
  ipcMain.handle('api', (event, request: Request) => {
    assertSender(event)
    try {
      validate(request)
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
    return callApi(request)
  })
  ipcMain.handle('desktop-info', (event) => {
    assertSender(event)
    return desktop!.info()
  })
  ipcMain.handle('desktop-fullscreen', (event, value: unknown) => {
    assertSender(event)
    if (typeof value !== 'boolean') throw new Error('全屏状态无效')
    if (value) saveBounds()
    win!.setFullScreen(value)
  })
  ipcMain.handle('desktop-settings', (event, value: unknown) => {
    assertSender(event)
    return desktop!.updatePreferences(value)
  })
  ipcMain.handle('desktop-media', (event, value: unknown) => {
    assertSender(event)
    desktop!.updateMedia(value)
  })
  ipcMain.handle('desktop-quit', (event) => {
    assertSender(event)
    app.quit()
  })

  ipcMain.handle('session-info', (event) => {
    assertSender(event)
    return {
      version: app.getVersion(),
      persistent: canPersist() && !storageReason,
      reason:
        storageReason ||
        (canPersist() ? '登录态由系统密钥环加密保存' : '系统密钥环不可用，登录态仅保留到关闭应用'),
    }
  })
  ipcMain.handle('copy', (event, text: string) => {
    assertSender(event)
    if (typeof text === 'string' && text.length < 10000) clipboard.writeText(text)
  })
  ipcMain.handle('export-trace', async (event) => {
    assertSender(event)
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `music-party-probe-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(
      result.filePath,
      JSON.stringify(
        {
          app: 'music-party',
          stage: 'protocol-probe',
          exportedAt: new Date().toISOString(),
          note: '凭据和链接已隐藏；房间、用户及歌曲 ID 保留用于诊断。',
          traces,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    )
    return true
  })
  const createWindow = () => {
    const areas = [
      screen.getPrimaryDisplay().workArea,
      ...screen
        .getAllDisplays()
        .filter((display) => display.id !== screen.getPrimaryDisplay().id)
        .map((display) => display.workArea),
    ]
    const geometry = restoreWindow(store.window, areas)
    win = new BrowserWindow({
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      minWidth: Math.min(1000, geometry.width),
      minHeight: Math.min(720, geometry.height),
      title: 'Music Party',
      icon: join(app.getAppPath(), 'resources/icon.png'),
      backgroundColor: desktop!.info().resolvedTheme === 'dark' ? '#111214' : '#edeeee',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    if (geometry.maximized) win.maximize()
    win.on('resize', scheduleBounds)
    win.on('move', scheduleBounds)
    win.on('maximize', scheduleBounds)
    win.on('unmaximize', scheduleBounds)
    win.on('enter-full-screen', () => desktop?.notify())
    win.on('leave-full-screen', () => {
      desktop?.notify()
      scheduleBounds()
    })
    win.on('close', (event) => {
      saveBounds()
      if (!quitting && store.preferences.closeToTray && desktop?.trayAvailable) {
        event.preventDefault()
        win?.hide()
      } else if (!quitting) {
        event.preventDefault()
        app.quit()
      }
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    )
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else win.loadFile(join(__dirname, '../renderer/index.html'))
    win.on('closed', () => {
      win = null
    })
  }
  createWindow()
  app.on('activate', () => {
    if (!win) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})
app.on('before-quit', (event) => {
  if (!primaryInstance || quitPrepared) return
  event.preventDefault()
  if (quitting) return
  prepareExit().finally(() => app.quit())
})
app.on('will-quit', () => {
  clearTimeout(updateTimer)
  clearTimeout(boundsTimer)
  desktop?.destroy()
  child?.kill()
})

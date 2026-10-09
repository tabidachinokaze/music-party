import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  safeStorage,
  screen,
  shell,
  systemPreferences,
  utilityProcess,
} from 'electron'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Reply, Request, Trace } from '../shared/types'
import { SEND_METHODS } from '../shared/private-messages'
import { messageStickerSource } from '../shared/sticker-source'
import { FullScreenController } from './fullscreen'
import { musicMessageLink } from '../shared/message-content'
import {
  neteaseAssetUrl,
  validateMediaRequest,
  type MediaReply,
  type MediaRequest,
} from '../shared/media'
import { validate } from './service'
import { SettingsStore } from './settings'
import { DesktopController } from './desktop'
import { restoreWindow, validatePreferences } from '../shared/desktop'
import { normalizeStoredPlayerBackground, preparePlayerBackground } from './player-background-image'
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
let microphoneUntil = 0
const mediaPending = new Map<
  number,
  {
    resolve: (reply: MediaReply) => void
    timer: ReturnType<typeof setTimeout>
    requestId: string
    phase: string
    started: number
    meta: { kind: string; destination: string; size: number; mime: string }
  }
>()
function saveBounds() {
  if (!win || win.isDestroyed() || win.isFullScreen() || desktop?.fullscreen?.value || !store)
    return
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
    if (message.type === 'private-notifications')
      win?.webContents.send('private-notifications', message.batch)
    if (message.type === 'media-progress') {
      for (const task of mediaPending.values())
        if (task.requestId === message.progress.requestId) task.phase = message.progress.phase
      win?.webContents.send('media-progress', message.progress)
    }
    if (message.type === 'media-reply') {
      const task = mediaPending.get(message.id)
      if (task) {
        clearTimeout(task.timer)
        mediaPending.delete(message.id)
        const trace: Trace = {
          id: -message.id,
          time: new Date().toISOString(),
          method: 'mediaSend',
          duration: Date.now() - task.started,
          ok: message.reply.ok,
          request: task.meta,
          response: {
            ok: message.reply.ok,
            code: message.reply.code,
            phase: task.phase,
            deliveryUnknown: message.reply.deliveryUnknown === true,
          },
        }
        traces = [...traces.slice(-299), trace]
        win?.webContents.send('trace', trace)
        task.resolve(message.reply)
      }
    }
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
    for (const task of mediaPending.values()) {
      clearTimeout(task.timer)
      task.resolve({
        ok: false,
        error: 'API 进程已退出，请刷新会话确认附件状态',
        deliveryUnknown: task.phase === 'sending',
      })
    }
    mediaPending.clear()
    child = null
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.resolve({ ok: false, error: 'API 进程已退出，请重启应用' })
    }
    pending.clear()
  })
}

function callApi(request: Request): Promise<Reply> {
  return callWorker({ type: 'call', request }, SEND_METHODS.has(request.method))
}
function callWorker(message: Record<string, unknown>, deliveryUnknown = false): Promise<Reply> {
  if (!child) return Promise.resolve({ ok: false, error: 'API 进程不可用，请重启应用' })
  return new Promise<Reply>((resolve) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({
        ok: false,
        error: '请求超时，结果未知。请刷新房间状态后再操作',
        deliveryUnknown,
      })
    }, 45000)
    pending.set(id, { resolve, timer })
    child!.postMessage({ ...message, id })
  })
}
async function workerResult(message: Record<string, unknown>) {
  const reply = await callWorker(message)
  if (!reply.ok) throw new Error(reply.error || '通知连接暂不可用')
  return reply.data
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
  ipcMain.handle('message-link-open', async (event, value: unknown) => {
    assertSender(event)
    const url = musicMessageLink(value) || neteaseAssetUrl(value)
    if (!url) throw new Error('消息没有可用的网易云链接')
    await shell.openExternal(url)
  })
  ipcMain.handle('microphone-request', async (event) => {
    assertSender(event)
    if (process.platform === 'darwin' && !(await systemPreferences.askForMediaAccess('microphone')))
      throw new Error('请在系统设置中允许麦克风访问')
    microphoneUntil = Date.now() + 10000
  })
  ipcMain.handle('media-cancel', (event, requestId: unknown) => {
    assertSender(event)
    if (typeof requestId === 'string' && /^[0-9a-f-]{36}$/i.test(requestId))
      child?.postMessage({ type: 'media-cancel', requestId })
  })
  ipcMain.handle('media-send', (event, value: unknown) => {
    assertSender(event)
    let request: MediaRequest
    try {
      request = validateMediaRequest(value)
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
    if (!child) return { ok: false, error: 'API 进程不可用，请重启应用' }
    if (mediaPending.size) return { ok: false, error: '请等待当前附件完成' }
    return new Promise<MediaReply>((resolve) => {
      const id = ++nextId
      const requestId = request.requestId
      const timer = setTimeout(
        () => {
          const task = mediaPending.get(id)
          mediaPending.delete(id)
          child?.postMessage({ type: 'media-cancel', requestId })
          resolve({
            ok: false,
            error: '附件请求超时，请刷新会话确认结果',
            deliveryUnknown: task?.phase === 'sending',
          })
        },
        10 * 60 * 1000,
      )
      mediaPending.set(id, {
        resolve,
        timer,
        requestId,
        phase: 'uploading',
        started: Date.now(),
        meta: {
          kind: request.file.kind,
          destination: request.target.kind,
          size: request.file.data.byteLength,
          mime: request.file.mime,
        },
      })
      child!.postMessage({ type: 'media-send', id, request })
    })
  })
  ipcMain.handle('sticker-image', (event, value: any) => {
    assertSender(event)
    const image = value?.image
    if (
      typeof value?.requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(value.requestId) ||
      image?.kind !== 'image' ||
      !messageStickerSource(image)
    )
      return { ok: false, error: '图片信息无效' }
    if (!child) return { ok: false, error: 'API 进程不可用，请重启应用' }
    if (mediaPending.size) return { ok: false, error: '请等待当前附件完成' }
    return new Promise<MediaReply>((resolve) => {
      const id = ++nextId
      const requestId = value.requestId
      const timer = setTimeout(() => {
        mediaPending.delete(id)
        child?.postMessage({ type: 'media-cancel', requestId })
        resolve({ ok: false, error: '添加图片结果未确认，请刷新表情库', deliveryUnknown: true })
      }, 120000)
      mediaPending.set(id, {
        resolve,
        timer,
        requestId,
        phase: 'uploading',
        started: Date.now(),
        meta: { kind: 'image', destination: 'sticker', size: 0, mime: 'unknown' },
      })
      child!.postMessage({
        type: 'sticker-image',
        id,
        request: {
          requestId,
          image: { kind: 'image', url: image.url, width: image.width, height: image.height },
        },
      })
    })
  })
  ipcMain.handle('private-notifications', (event, cursor: unknown = 0, session?: unknown) => {
    assertSender(event)
    if (
      !Number.isSafeInteger(cursor) ||
      Number(cursor) < 0 ||
      (session !== undefined && (typeof session !== 'string' || session.length > 128))
    )
      throw new Error('通知游标无效')
    return workerResult({ type: 'notifications', cursor, session })
  })
  for (const type of ['match-open', 'match-poll', 'match-close'])
    ipcMain.handle(type, (event, attemptId?: unknown) => {
      assertSender(event)
      if (
        !(type === 'match-close' && attemptId === undefined) &&
        (typeof attemptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(attemptId))
      )
        throw new Error('匹配标识无效')
      return workerResult({ type, attemptId })
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
  ipcMain.handle('desktop-fullscreen', async (event, value: unknown) => {
    assertSender(event)
    if (typeof value !== 'boolean' && value !== 'toggle') throw new Error('全屏状态无效')
    saveBounds()
    await desktop!.fullscreen!.set(value)
    return desktop!.info()
  })
  ipcMain.handle('desktop-settings', (event, value: unknown) => {
    assertSender(event)
    const preferences = validatePreferences(value),
      background = preferences.playerBackground
    if (background?.image && background.image !== store.preferences.playerBackground.image)
      background.image = normalizeStoredPlayerBackground(background.image, (bytes) =>
        nativeImage.createFromBuffer(bytes),
      )
    return desktop!.updatePreferences(preferences)
  })
  ipcMain.handle('player-background-image', (event, bytes: unknown) => {
    assertSender(event)
    return preparePlayerBackground(bytes, (value) => nativeImage.createFromBuffer(value))
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
    desktop!.fullscreen = new FullScreenController(win, () => desktop?.notify())
    win.on('leave-full-screen', () => {
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
    win.webContents.session.setPermissionCheckHandler(
      (wc, permission, _origin, details) =>
        wc === win?.webContents &&
        permission === 'media' &&
        Date.now() < microphoneUntil &&
        details.mediaType === 'audio',
    )
    win.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
      const allowed =
        wc === win?.webContents &&
        permission === 'media' &&
        Date.now() < microphoneUntil &&
        'mediaTypes' in details &&
        details.mediaTypes?.length === 1 &&
        details.mediaTypes[0] === 'audio'
      callback(!!allowed)
    })
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

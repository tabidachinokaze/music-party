import { ui } from '../shared/ui-language'
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
import { DesktopController, windowBackground } from './desktop'
import {
  MIN_WINDOW_SIZE,
  restoreWindow,
  validatePreferences,
  type WindowGeometry,
} from '../shared/desktop'
import { normalizeStoredPlayerBackground, preparePlayerBackground } from './player-background-image'
import { autoUpdater } from 'electron-updater'
import { UpdateController } from './updates'
import { PROJECT_LINKS, updateSupport, type ProjectLink } from '../shared/updates'

app.setName('Music Party')
// Chromium's native overlay scrollbars retain platform scrolling and hit testing.
const enabledFeatures = app.commandLine.getSwitchValue('enable-features')
app.commandLine.appendSwitch(
  'enable-features',
  [enabledFeatures, 'OverlayScrollbar'].filter(Boolean).join(','),
)
if (process.env.MUSIC_PARTY_PROFILE) app.setPath('userData', process.env.MUSIC_PARTY_PROFILE)
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
let win: BrowserWindow | null = null
let normalGeometry: WindowGeometry | undefined
let store: SettingsStore
let desktop: DesktopController | null = null
let quitting = false
let updates: UpdateController | null = null
let updateTimer: ReturnType<typeof setTimeout> | undefined
let normalFrame = { width: 0, height: 0 }
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
function captureBounds() {
  if (
    !win ||
    win.isDestroyed() ||
    win.isMaximized() ||
    win.isMinimized() ||
    win.isFullScreen() ||
    desktop?.fullscreen?.value
  )
    return
  // Content size can still include the fullscreen surface during the restore event.
  const bounds = win.getNormalBounds()
  normalGeometry = {
    ...bounds,
    width: bounds.width - normalFrame.width,
    height: bounds.height - normalFrame.height,
    maximized: false,
  }
}
function saveBounds() {
  if (
    !win ||
    win.isDestroyed() ||
    win.isMinimized() ||
    win.isFullScreen() ||
    desktop?.fullscreen?.value ||
    !store
  )
    return
  try {
    captureBounds()
    if (normalGeometry) store.saveWindow({ ...normalGeometry, maximized: win.isMaximized() })
  } catch {
    desktop?.notify()
  }
}
function scheduleBounds() {
  captureBounds()
  clearTimeout(boundsTimer)
  boundsTimer = setTimeout(saveBounds, 300)
}
app.on('second-instance', () => desktop?.show())
let child: Electron.UtilityProcess | null = null
let nextId = 0
let traces: Trace[] = []
let sessionSaveFailed = false
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
    throw new Error(ui('拒绝非应用窗口请求', 'This request must come from the application window'))
}
function startWorker() {
  const temp = join(app.getPath('userData'), 'api-runtime')
  mkdirSync(temp, { recursive: true, mode: 0o700 })
  const sessionFile = join(app.getPath('userData'), 'session.enc')
  child = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
    serviceName: 'Music Party API',
    stdio: 'ignore',
    env: {
      ...process.env,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      NETEASE_COOKIE: '',
      MUSIC_PARTY_LANGUAGE: store.preferences.language,
      MUSIC_PARTY_IM_DEBUG: process.env.MUSIC_PARTY_IM_DEBUG ?? (app.isPackaged ? '0' : '1'),
    },
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
    if (message.type === 'room-members') win?.webContents.send('room-members', message.update)
    if (message.type === 'im-debug') {
      const raw =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      console.log(
        `[IM ${new Date(Number(message.timestamp) || Date.now()).toISOString()}] ${String(raw).slice(0, 20000)}`,
      )
    }
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
        sessionSaveFailed = true
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
        error: ui(
          'API 进程已退出，请刷新会话确认附件状态',
          'The API process stopped. Refresh the conversation to check the attachment.',
        ),
        deliveryUnknown: task.phase === 'sending',
      })
    }
    mediaPending.clear()
    child = null
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.resolve({
        ok: false,
        error: ui('API 进程已退出，请重启应用', 'The API process stopped. Restart Music Party.'),
      })
    }
    pending.clear()
  })
}

function callApi(request: Request): Promise<Reply> {
  return callWorker({ type: 'call', request }, SEND_METHODS.has(request.method))
}
function callWorker(message: Record<string, unknown>, deliveryUnknown = false): Promise<Reply> {
  if (!child)
    return Promise.resolve({
      ok: false,
      error: ui(
        'API 进程不可用，请重启应用',
        'The API process is unavailable. Restart Music Party.',
      ),
    })
  return new Promise<Reply>((resolve) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({
        ok: false,
        error: ui(
          '请求超时，结果未知。请刷新房间状态后再操作',
          'The request timed out. Check the room status before trying again.',
        ),
        deliveryUnknown,
      })
    }, 45000)
    pending.set(id, { resolve, timer })
    child!.postMessage({ ...message, id })
  })
}
async function workerResult(message: Record<string, unknown>) {
  const reply = await callWorker(message)
  if (!reply.ok)
    throw new Error(
      reply.error || ui('通知连接暂不可用', 'The notification service is temporarily unavailable'),
    )
  return reply.data
}

function prepareExit() {
  if (quitting) return
  quitting = true
  clearTimeout(boundsTimer)
  saveBounds()
}
function cancelExitPreparation() {
  quitting = false
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
      prepareExit()
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
      throw new Error(ui('不支持的项目链接', 'Unsupported project link'))
    await shell.openExternal(PROJECT_LINKS[key as ProjectLink])
  })
  ipcMain.handle('message-link-open', async (event, value: unknown) => {
    assertSender(event)
    const url = musicMessageLink(value) || neteaseAssetUrl(value)
    if (!url)
      throw new Error(
        ui('消息没有可用的网易云链接', "This message doesn't contain a NetEase Cloud Music link"),
      )
    await shell.openExternal(url)
  })
  ipcMain.handle('microphone-request', async (event) => {
    assertSender(event)
    if (process.platform === 'darwin' && !(await systemPreferences.askForMediaAccess('microphone')))
      throw new Error(
        ui('请在系统设置中允许麦克风访问', 'Allow microphone access in your system settings'),
      )
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
    if (!child)
      return {
        ok: false,
        error: ui(
          'API 进程不可用，请重启应用',
          'The API process is unavailable. Restart Music Party.',
        ),
      }
    if (mediaPending.size)
      return {
        ok: false,
        error: ui('请等待当前附件完成', 'Wait for the current attachment to finish'),
      }
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
            error: ui(
              '附件请求超时，请刷新会话确认结果',
              'The attachment request timed out. Refresh the conversation to check the result.',
            ),
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
      return { ok: false, error: ui('图片信息无效', 'Invalid image details') }
    if (!child)
      return {
        ok: false,
        error: ui(
          'API 进程不可用，请重启应用',
          'The API process is unavailable. Restart Music Party.',
        ),
      }
    if (mediaPending.size)
      return {
        ok: false,
        error: ui('请等待当前附件完成', 'Wait for the current attachment to finish'),
      }
    return new Promise<MediaReply>((resolve) => {
      const id = ++nextId
      const requestId = value.requestId
      const timer = setTimeout(() => {
        mediaPending.delete(id)
        child?.postMessage({ type: 'media-cancel', requestId })
        resolve({
          ok: false,
          error: ui(
            '添加图片结果未确认，请刷新表情库',
            "Couldn't confirm that the image was added. Refresh your sticker library.",
          ),
          deliveryUnknown: true,
        })
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
      throw new Error(ui('通知游标无效', 'Invalid notification cursor'))
    return workerResult({ type: 'notifications', cursor, session })
  })
  ipcMain.handle('join-im-chatroom', (event, chatroomId: unknown) => {
    assertSender(event)
    if (typeof chatroomId !== 'string' || !/^[1-9]\d{0,23}$/.test(chatroomId))
      throw new Error(ui('聊天室 ID 无效', 'Invalid chat room ID'))
    child?.postMessage({ type: 'join-chatroom', chatroomId })
  })
  ipcMain.handle('leave-im-chatroom', (event) => {
    assertSender(event)
    child?.postMessage({ type: 'leave-chatroom' })
  })
  for (const type of ['match-open', 'match-poll', 'match-close'])
    ipcMain.handle(type, (event, attemptId?: unknown) => {
      assertSender(event)
      if (
        !(type === 'match-close' && attemptId === undefined) &&
        (typeof attemptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(attemptId))
      )
        throw new Error(ui('匹配标识无效', 'Invalid match ID'))
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
    throw new Error(ui('不支持的更新操作', 'Unsupported update action'))
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
  ipcMain.handle('window-action', (event, action: unknown) => {
    assertSender(event)
    if (!win || win.isDestroyed()) return
    if (action === 'minimize') win.minimize()
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (action === 'close') win.close()
    else throw new Error(ui('窗口操作无效', 'Invalid window action'))
  })
  ipcMain.handle('desktop-fullscreen', async (event, value: unknown) => {
    assertSender(event)
    if (typeof value !== 'boolean' && value !== 'toggle')
      throw new Error(ui('全屏状态无效', 'Invalid full-screen state'))
    saveBounds()
    await desktop!.fullscreen!.set(value)
    return desktop!.info()
  })
  ipcMain.handle('desktop-settings', (event, value: unknown) => {
    assertSender(event)
    const preferences = validatePreferences(value, store.preferences.playerBackground),
      background = preferences.playerBackground
    if (background?.image && background.image !== store.preferences.playerBackground.image)
      background.image = normalizeStoredPlayerBackground(background.image, (bytes) =>
        nativeImage.createFromBuffer(bytes),
      )
    const info = desktop!.updatePreferences(preferences)
    if (preferences.language)
      child?.postMessage({ type: 'ui-language', language: info.preferences.language })
    return info
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
      persistent: canPersist() && !sessionSaveFailed,
      reason: sessionSaveFailed
        ? ui(
            '保存登录态失败，本次登录仍可继续使用',
            "Couldn't save sign-in details. You can stay signed in for this session.",
          )
        : canPersist()
          ? ui(
              '登录态由系统密钥环加密保存',
              'Sign-in details are encrypted with the system keychain.',
            )
          : ui(
              '系统密钥环不可用，登录态仅保留到关闭应用',
              "The system keychain is unavailable. You'll stay signed in until you quit.",
            ),
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
          note: ui(
            '凭据和链接已隐藏；房间、用户及歌曲 ID 保留用于诊断。',
            'Credentials and links are hidden. Room, user, and track IDs are included for diagnostics.',
          ),
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
    const initial = restoreWindow(store.window, areas)
    win = new BrowserWindow({
      show: false,
      x: initial.x,
      y: initial.y,
      width: initial.width,
      height: initial.height,
      useContentSize: true,
      title: 'Music Party',
      icon: join(app.getAppPath(), 'resources/icon.png'),
      backgroundColor: windowBackground(desktop!.info().resolvedTheme === 'dark'),
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        zoomMode: 'isolated',
        zoomFactor: store.preferences.fontScale / 100,
      },
    })
    win.setMenu(null)
    const outer = win.getBounds()
    const content = win.getContentBounds()
    normalFrame = {
      width: Math.max(0, outer.width - content.width),
      height: Math.max(0, outer.height - content.height),
    }
    const geometry = restoreWindow(store.window, areas, normalFrame)
    win.setBounds({
      x: geometry.x,
      y: geometry.y,
      width: geometry.width + normalFrame.width,
      height: geometry.height + normalFrame.height,
    })
    win.setMinimumSize(
      Math.min(MIN_WINDOW_SIZE.width, geometry.width) + normalFrame.width,
      Math.min(MIN_WINDOW_SIZE.height, geometry.height) + normalFrame.height,
    )
    normalGeometry = geometry
    if (geometry.maximized) win.maximize()
    win.show()
    win.on('resize', scheduleBounds)
    win.on('move', scheduleBounds)
    const onMaximizeChange = () => {
      scheduleBounds()
      desktop?.notify()
    }
    win.on('maximize', onMaximizeChange)
    win.on('unmaximize', onMaximizeChange)
    win.on('app-command', (event, command) => {
      if (command === 'browser-backward' || command === 'browser-forward') {
        event.preventDefault()
        win?.webContents.send('navigate', command === 'browser-backward' ? 'back' : 'forward')
      }
    })
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
        // Let the native close event unwind before Electron asks the window to close again.
        setImmediate(() => app.quit())
      }
    })
    win.webContents.on('zoom-changed', (_event, direction) => desktop?.stepDisplaySize(direction))
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
    else desktop?.show()
  })
})
app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})
app.on('before-quit', prepareExit)
app.on('will-quit', () => {
  clearTimeout(updateTimer)
  clearTimeout(boundsTimer)
  desktop?.destroy()
  child?.kill()
})

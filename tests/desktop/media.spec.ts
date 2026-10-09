import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('private attachment previews, upload retry, recording, video and fixed recipients', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
    'base64',
  )
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const args = JSON.parse(Buffer.concat(chunks).toString() || '{}'),
      path = new URL(req.url!, 'http://localhost').pathname
    let body: any = { code: 200 }
    if (path === '/login/status')
      body = {
        data: {
          code: 200,
          profile: String(args.cookie).includes('MUSIC_U=mock')
            ? { userId: 123, nickname: '测试账户' }
            : null,
        },
      }
    if (path === '/login/qr/key') body = { code: 200, data: { unikey: 'media-key' } }
    if (path === '/login/qr/create')
      body = { code: 200, data: { qrimg: `data:image/png;base64,${png.toString('base64')}` } }
    if (path === '/login/qr/check') body = { code: 803, cookie: 'MUSIC_U=mock; Path=/;' }
    if (path === '/user/playlist') body = { code: 200, playlist: [], more: false }
    if (path === '/album/sublist') body = { code: 200, data: [], hasMore: false }
    if (path === '/likelist') body = { code: 200, ids: [] }
    if (path === '/msg/private')
      body = {
        code: 200,
        more: false,
        msgs: [456, 789].map((uid) => ({
          fromUser: { userId: uid, nickname: uid === 456 ? 'Alice' : 'Bob' },
          toUser: { userId: 123 },
          lastMsg: '{"msg":"你好"}',
          lastMsgTime: 1,
          newMsgCount: 0,
        })),
      }
    if (path === '/msg/private/history') body = { code: 200, more: false, msgs: [] }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const profile = await mkdtemp(join(tmpdir(), 'music-party-media-'))
  const app = await electron.launch({
    args: [
      '.',
      `--ozone-platform=${process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'}`,
      '--password-store=basic',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    env: {
      ...process.env,
      MUSIC_PARTY_API_URL: `http://127.0.0.1:${(server.address() as any).port}`,
      MUSIC_PARTY_PROFILE: profile,
      ELECTRON_RENDERER_URL: '',
    },
  })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        calls: [] as any[],
        failNext: true,
        uncertainNext: false,
        block: false,
        pending: null as null | (() => void),
      }
      ;(globalThis as any).__media = state
      ipcMain.removeHandler('media-send')
      ipcMain.handle('media-send', async (_event, request) => {
        state.calls.push({
          kind: request.file.kind,
          name: request.file.name,
          target: request.target,
          size: request.file.data.length,
          duration: request.file.duration,
        })
        BrowserWindow.getAllWindows()[0].webContents.send('media-progress', {
          requestId: request.requestId,
          phase: 'uploading',
          percent: 25,
        })
        if (state.failNext) {
          state.failNext = false
          return { ok: false, error: '模拟上传失败', deliveryUnknown: false }
        }
        if (state.uncertainNext) {
          state.uncertainNext = false
          return { ok: false, error: '发送结果未确认', deliveryUnknown: true }
        }
        if (state.block)
          return await new Promise((resolve) => {
            state.pending = () => {
              state.block = false
              state.pending = null
              resolve({ ok: false, error: '上传已取消', deliveryUnknown: false })
            }
          })
        return {
          ok: true,
          receipt: {
            requestId: request.requestId,
            senderUid: '123',
            messageId: String(900 + state.calls.length),
            time: Date.now(),
            text: `已发送 ${request.file.name}`,
            attachments: [
              {
                kind: request.file.kind === 'voice' ? 'audio' : request.file.kind,
                title: request.file.name,
                url:
                  request.file.kind === 'image'
                    ? 'https://p1.music.126.net/media-test.png'
                    : undefined,
              },
            ],
          },
        }
      })
      ipcMain.removeHandler('media-cancel')
      ipcMain.handle('media-cancel', () => state.pending?.())
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://p1.music.126.net/media-test.png', (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    )
    await page.getByRole('button', { name: '扫码登录', exact: true }).click()
    await expect(page.getByText('测试账户', { exact: true })).toBeVisible()
    await page.locator('.sidebar').getByRole('button', { name: '私信', exact: true }).click()
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: '表情.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByRole('dialog', { name: '发送附件' })).toContainText('Alice')
    await expect(page.getByAltText('待发送图片')).toBeVisible()
    expect(await app.evaluate(() => (globalThis as any).__media.calls.length)).toBe(0)
    await page.getByRole('button', { name: '确认发送附件' }).click()
    await expect(page.getByRole('alert')).toContainText('模拟上传失败')
    await page.getByRole('button', { name: '重试发送附件' }).click()
    await expect(page.getByRole('dialog', { name: '发送附件' })).toHaveCount(0)
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText('表情.png')

    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      ;(window as any).__realGetMedia = original
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('denied', 'NotAllowedError')
      }
    })
    await page.getByRole('button', { name: '录制语音' }).click()
    await expect(page.getByRole('alert')).toContainText('麦克风权限未开启')
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await (window as any).__realGetMedia(...args)
        ;(window as any).__recordingStream = stream
        return stream
      }
    })
    await page.getByRole('button', { name: '录制语音' }).click()
    await expect(page.getByText('1 / 60 秒', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '停止录音并预览' }).click()
    await expect(page.getByLabel('录音预览')).toBeVisible()
    const previewAudio = await page.getByLabel('录音预览').elementHandle()
    await previewAudio!.evaluate((element: HTMLAudioElement) => element.play())
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '发送附件' })).toHaveCount(0)
    expect(await previewAudio!.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
    await page.getByRole('button', { name: '待发送附件' }).click()

    expect(
      await page.evaluate(() =>
        (window as any).__recordingStream
          .getTracks()
          .every((track: any) => track.readyState === 'ended'),
      ),
    ).toBe(true)
    await page.getByRole('button', { name: '确认发送附件' }).click()
    await expect(page.getByRole('dialog', { name: '发送附件' })).toHaveCount(0)

    const videoChooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '发送视频' }).click()
    await (await videoChooser).setFiles(join(process.cwd(), 'tests/fixtures/message-video.mp4'))
    await expect(page.getByLabel('视频预览')).toBeVisible()
    await page.getByRole('button', { name: '确认发送附件' }).click()
    await expect(page.getByRole('dialog', { name: '发送附件' })).toHaveCount(0)

    const fileChooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '发送本地文件' }).click()
    await (
      await fileChooser
    ).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') })
    await expect(page.getByRole('dialog', { name: '发送附件' })).toContainText('下载链接')
    await page.mouse.click(5, 5)
    await expect(page.getByRole('button', { name: '待发送附件' })).toBeVisible()
    await page.locator('.conversation-list').getByRole('button', { name: /^Bob/ }).click()
    await expect(page.getByRole('button', { name: '待发送附件' })).toHaveCount(0)
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await page.getByRole('button', { name: '待发送附件' }).click()
    await expect(page.getByRole('dialog', { name: '发送附件' })).toContainText('Alice')
    await expect(page.getByRole('dialog', { name: '发送附件' })).toContainText('notes.txt')
    await page.getByRole('button', { name: '稍后发送', exact: true }).click()
    await page.locator('.sidebar').getByRole('button', { name: '设置', exact: true }).click()
    await page.locator('.sidebar').getByRole('button', { name: '私信', exact: true }).click()
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await page.getByRole('button', { name: '待发送附件' }).click()
    await expect(page.getByRole('dialog', { name: '发送附件' })).toContainText('notes.txt')
    await page.getByRole('button', { name: '稍后发送', exact: true }).click()
    await page.locator('.conversation-list').getByRole('button', { name: /^Bob/ }).click()
    await expect(page.getByRole('button', { name: '待发送附件' })).toHaveCount(0)
    const nextChooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '发送本地文件' }).click()
    await (
      await nextChooser
    ).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') })
    await expect(page.getByRole('dialog', { name: '发送附件' })).toContainText('Bob')
    await app.evaluate(() => {
      ;(globalThis as any).__media.block = true
    })
    await page.getByRole('button', { name: '确认发送附件' }).click()
    await page.getByRole('button', { name: '取消上传' }).click()
    await expect(page.getByRole('alert')).toContainText('上传已取消')
    await page.getByRole('button', { name: '重试发送附件' }).click()
    await expect(page.getByRole('dialog', { name: '发送附件' })).toHaveCount(0)
    const uncertainChooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '发送本地文件' }).click()
    await (
      await uncertainChooser
    ).setFiles({
      name: 'uncertain.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('uncertain'),
    })
    await app.evaluate(() => {
      ;(globalThis as any).__media.uncertainNext = true
    })
    await page.getByRole('button', { name: '确认发送附件' }).click()
    await expect(page.getByRole('alert')).toContainText('请先刷新会话')
    await page.getByRole('button', { name: '稍后发送', exact: true }).click()
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await page.locator('.conversation-list').getByRole('button', { name: /^Bob/ }).click()
    await page.getByRole('button', { name: '待发送附件' }).click()
    await expect(
      page.getByRole('button', { name: '已确认未收到，重新发送', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('dialog', { name: '发送附件' })).toContainText('uncertain.txt')
    await page.getByRole('button', { name: '移除附件', exact: true }).click()
    await expect(page.getByRole('button', { name: '待发送附件' })).toHaveCount(0)
    const calls = await app.evaluate(() => (globalThis as any).__media.calls)
    expect(calls.map((item: any) => item.kind)).toEqual([
      'image',
      'image',
      'voice',
      'video',
      'file',
      'file',
      'file',
    ])
    expect(calls.at(-1).target).toEqual({ kind: 'private', uid: '789' })
    expect(calls[2].duration).toBeGreaterThan(300)
    await page.getByRole('button', { name: '退出账号', exact: true }).click()
    await page.locator('.account').getByRole('button', { name: '扫码登录', exact: true }).click()
    await expect(page.getByText('测试账户', { exact: true })).toBeVisible()
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await expect(page.getByRole('button', { name: '待发送附件' })).toHaveCount(0)
    expect(errors).toEqual([])
    await page.screenshot({ path: 'test-results/music-party-media.png', animations: 'disabled' })
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

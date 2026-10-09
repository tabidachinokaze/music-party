import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('official custom stickers load every page, upload to the library and send directly in private chat', async () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  const thumbnail = await readFile(join(process.cwd(), 'resources/icon.png'))
  const self = { userId: 123, nickname: '测试账户' },
    peer = { userId: 456, nickname: 'Alice' }
  const items = Array.from({ length: 23 }, (_, i) => ({
    emojiId: String(1000 + i),
    picId: '109951166199016466',
    emojiGroupId: '-2',
    emojiName: `收藏表情${i + 1}`,
    format: 'gif',
    width: 120,
    height: 100,
  }))
  const history: any[] = [],
    calls: { route: string; args: any }[] = []
  let failList = true,
    failTail = true,
    uploads = 0,
    deferInitialPage = true,
    deferTailPage = true
  let releaseInitialPage!: () => void, releaseTailPage!: () => void
  const initialPageGate = new Promise<void>((resolve) => (releaseInitialPage = resolve)),
    tailPageGate = new Promise<void>((resolve) => (releaseTailPage = resolve))
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const args = JSON.parse(Buffer.concat(chunks).toString() || '{}'),
      path = new URL(req.url!, 'http://localhost').pathname
    const route = path === '/api' ? args.uri : path
    calls.push({ route, args })
    let body: any = { code: 200 }
    if (route === '/login/status')
      body = {
        data: { code: 200, profile: String(args.cookie).includes('MUSIC_U=mock') ? self : null },
      }
    if (route === '/login/qr/key') body = { code: 200, data: { unikey: 'sticker-key' } }
    if (route === '/login/qr/create')
      body = { code: 200, data: { qrimg: `data:image/gif;base64,${gif.toString('base64')}` } }
    if (route === '/login/qr/check') body = { code: 803, cookie: 'MUSIC_U=mock; Path=/;' }
    if (route === '/user/playlist') body = { code: 200, playlist: [], more: false }
    if (route === '/album/sublist') body = { code: 200, data: [], hasMore: false }
    if (route === '/likelist') body = { code: 200, ids: [] }
    if (route === '/register/checktoken/v3') body = { code: 200, token: 'mock-check' }
    if (route === '/msg/private')
      body = {
        code: 200,
        more: false,
        msgs: [
          {
            fromUser: peer,
            toUser: self,
            lastMsg: '{"msg":"你好"}',
            lastMsgTime: 1,
            newMsgCount: 0,
          },
        ],
      }
    if (route === '/msg/private/history') body = { code: 200, more: false, msgs: history }
    if (route === '/api/social/emoji/groups')
      body = {
        code: 200,
        data: {
          emojiGroups: [
            { id: -2, name: '自定义表情', edit: true },
            { id: 22, name: '官方表情包', edit: false },
          ],
        },
      }
    if (route === '/api/social/emoji/groups/detail/page') {
      if (failList) {
        failList = false
        body = { code: 503, message: '请重试表情列表' }
      } else {
        const offset = Number(args.data.cursor || 0)
        if (offset === 20 && failTail) {
          failTail = false
          body = { code: 503, message: '请重试下一页表情' }
        } else {
          if (offset === 0 && deferInitialPage) {
            deferInitialPage = false
            await initialPageGate
          }
          if (offset === 20 && deferTailPage) {
            deferTailPage = false
            await tailPageGate
          }
          body = {
            code: 200,
            data: {
              emojis: items.slice(offset, offset + 10),
              page: {
                more: offset + 10 < items.length,
                cursor: offset + 10 < items.length ? String(offset + 10) : '',
              },
            },
          }
        }
      }
    }
    if (route === '/api/social/emoji/cancel') {
      const ids = new Set(JSON.parse(args.data.emojiIds))
      for (let i = items.length - 1; i >= 0; i--)
        if (ids.has(Number(items[i].emojiId))) items.splice(i, 1)
      body = { code: 200, data: { result: true } }
    }
    if (route === '/__save_sticker') {
      uploads++
      const emoji = { ...items[0], emojiId: '5000', emojiName: args.name }
      items.unshift(emoji)
      body = { code: 200, emoji }
    }
    if (route === '/api/communication/send/msg') {
      const message = JSON.parse(args.data.sendMsgBody)
      history.push({
        id: 7001,
        fromUser: self,
        toUser: peer,
        time: Date.now(),
        msg: JSON.stringify(message.msgBody),
      })
      body = { code: 200, data: { msgBody: { msgId: '7001', status: 0 } } }
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body).replace(/"picId":"(\d+)"/g, '"picId":$1'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port,
    profile = await mkdtemp(join(tmpdir(), 'music-party-stickers-'))
  const app = await electron.launch({
    args: [
      '.',
      `--ozone-platform=${process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'}`,
      '--password-store=basic',
    ],
    env: {
      ...process.env,
      MUSIC_PARTY_API_URL: `http://127.0.0.1:${port}`,
      MUSIC_PARTY_PROFILE: profile,
      ELECTRON_RENDERER_URL: '',
    },
  })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain }, port) => {
      ipcMain.removeHandler('media-send')
      ipcMain.handle('media-send', async (_event, request) => {
        if (request.target.kind !== 'sticker') throw new Error('Unexpected chat send')
        const result = (await fetch(`http://127.0.0.1:${port}/__save_sticker`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: request.file.name }),
        }).then((response) => response.json())) as any
        return {
          ok: true,
          receipt: {
            requestId: request.requestId,
            senderUid: '123',
            time: Date.now(),
            text: '已保存',
            attachments: [],
            emoji: result.emoji,
          },
        }
      })
    }, port)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://p1.music.126.net/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: thumbnail }),
    )
    await page.getByRole('button', { name: '扫码登录', exact: true }).click()
    await expect(page.getByText('测试账户', { exact: true })).toBeVisible()
    await page.locator('.sidebar').getByRole('button', { name: '私信', exact: true }).click()
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await page.getByLabel('私信内容').fill('保留输入的文字')
    await page.getByRole('button', { name: '表情包', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('请重试表情列表')
    await page.getByRole('button', { name: '重试', exact: true }).click()
    const loading = page.locator('.cloud-sticker-loading')
    const expectCompactLoading = async (text: string) => {
      await expect(loading).toHaveText(text)
      const layout = await loading.evaluate((node) => {
        const bounds = node.getBoundingClientRect(),
          modal = node.closest('[role="dialog"]')!,
          popup = modal.getBoundingClientRect()
        return {
          loadingHeight: bounds.height,
          bottomSpace: popup.bottom - bounds.bottom,
          overflows: modal.scrollWidth > modal.clientWidth,
        }
      })
      expect(layout.loadingHeight).toBeLessThanOrEqual(36)
      expect(layout.bottomSpace).toBeLessThanOrEqual(32)
      expect(layout.overflows).toBe(false)
    }
    await expectCompactLoading('正在读取表情…')
    releaseInitialPage()
    // The first page is shorter than the viewport, so another page fills it automatically.
    await expect(page.locator('.cloud-sticker-grid button')).toHaveCount(20)
    await expect(page.getByRole('button', { name: '加载更多表情', exact: true })).toHaveCount(0)
    expect(
      calls.filter(
        (call) => call.route.endsWith('/groups/detail/page') && call.args.data.cursor === '20',
      ),
    ).toHaveLength(0)
    const stickerGrid = page.locator('.cloud-sticker-grid')
    await stickerGrid.evaluate((node) => {
      node.scrollTop = node.scrollHeight
      node.dispatchEvent(new Event('scroll'))
    })
    await expect(page.getByRole('alert')).toContainText('请重试下一页表情')
    await expect(stickerGrid.locator('button')).toHaveCount(20)
    const firstPageCalls = calls.filter(
      (call) => call.route.endsWith('/groups/detail/page') && !call.args.data.cursor,
    ).length
    await stickerGrid.evaluate((node) => {
      for (let i = 0; i < 5; i++) node.dispatchEvent(new Event('scroll'))
    })
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await expectCompactLoading('正在读取更多表情…')
    await expect(stickerGrid.locator('button')).toHaveCount(20)
    releaseTailPage()
    await expect(page.getByText('23 个表情', { exact: true })).toBeVisible()
    await expect(page.locator('.cloud-sticker-grid button')).toHaveCount(23)
    expect(
      calls.filter((call) => call.route.endsWith('/groups/detail/page') && !call.args.data.cursor),
    ).toHaveLength(firstPageCalls)
    expect(
      calls.filter(
        (call) => call.route.endsWith('/groups/detail/page') && call.args.data.cursor === '20',
      ),
    ).toHaveLength(2)
    await expect
      .poll(() =>
        page
          .locator('.cloud-sticker-grid img')
          .first()
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true)
    await expect(page.locator('.cloud-sticker-grid img').first()).toHaveAttribute(
      'src',
      'https://p1.music.126.net/5rgzlgx3yofdin1Rnf8iQw==/109951166199016466.jpg',
    )
    expect(
      calls
        .filter((call) => call.route.endsWith('/groups/detail/page'))
        .map((call) => call.args.data.cursor),
    ).toEqual(expect.arrayContaining(['10', '20']))
    expect(calls.find((call) => call.route.endsWith('/emoji/groups'))!.args.data.resourceType).toBe(
      2,
    )
    const pagesBeforeReopen = calls.filter((call) =>
      call.route.endsWith('/groups/detail/page'),
    ).length
    const cachedScroll = await stickerGrid.evaluate((node) => node.scrollTop)
    await page.getByRole('button', { name: '关闭表情', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '表情', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '表情包', exact: true }).click()
    await expect(stickerGrid.locator('button')).toHaveCount(23)
    expect(
      Math.abs((await stickerGrid.evaluate((node) => node.scrollTop)) - cachedScroll),
    ).toBeLessThanOrEqual(1)
    expect(calls.filter((call) => call.route.endsWith('/groups/detail/page'))).toHaveLength(
      pagesBeforeReopen,
    )
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '上传自定义表情', exact: true }).click()
    await (await chooser).setFiles({ name: '新增.gif', mimeType: 'image/gif', buffer: gif })
    await expect(page.getByRole('dialog', { name: '上传自定义表情', exact: true })).toBeVisible()
    expect(uploads).toBe(0)
    await page.mouse.click(5, 5)
    await expect(page.getByRole('dialog', { name: '上传自定义表情', exact: true })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '表情', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '待上传表情', exact: true }).click()
    await page.getByRole('button', { name: '确认上传表情', exact: true }).click()
    await expect(page.getByText('24 个表情', { exact: true })).toBeVisible()
    expect(uploads).toBe(1)
    expect(calls.filter((call) => call.route === '/api/communication/send/msg')).toHaveLength(0)
    const pagesBeforeDelete = calls.filter((call) =>
      call.route.endsWith('/groups/detail/page'),
    ).length
    const retained = page.getByRole('button', { name: '发送自定义表情 收藏表情23', exact: true })
    await retained.scrollIntoViewIfNeeded()
    const scrollBefore = await page
      .locator('.cloud-sticker-grid')
      .evaluate((node) => node.scrollTop)
    await page.getByRole('button', { name: '整理表情', exact: true }).click()
    await page.getByRole('button', { name: '选择删除 收藏表情23', exact: true }).click()
    await page.getByRole('button', { name: '删除所选 (1)', exact: true }).click()
    await expect(page.getByText('23 个表情', { exact: true })).toBeVisible()
    await expect(page.locator('.cloud-sticker-grid button')).toHaveCount(23)
    expect(calls.filter((call) => call.route.endsWith('/groups/detail/page')).length).toBe(
      pagesBeforeDelete,
    )
    expect(
      await page.locator('.cloud-sticker-grid').evaluate((node) => node.scrollTop),
    ).toBeGreaterThan(0)
    expect(scrollBefore).toBeGreaterThan(0)
    await expect(
      page.getByRole('button', { name: '发送自定义表情 收藏表情22', exact: true }),
    ).toBeAttached()
    await page.screenshot({
      path: 'test-results/music-party-custom-stickers.png',
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '发送自定义表情 新增.gif', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '表情', exact: true })).toHaveCount(0)
    await expect(page.getByRole('log', { name: '私信消息' }).locator('.message-image')).toHaveCount(
      1,
    )
    await expect(page.getByLabel('私信内容')).toHaveValue('保留输入的文字')
    const sent = JSON.parse(
      calls.find((call) => call.route === '/api/communication/send/msg')!.args.data.sendMsgBody,
    )
    expect(sent.receiverUserIds).toBe('456')
    expect(JSON.parse(sent.msgBody.body)).toMatchObject({
      emojiId: '5000',
      emojiGroupId: '-2',
      format: 'gif',
    })
    expect(uploads).toBe(1)
    expect(errors).toEqual([])
  } finally {
    releaseInitialPage()
    releaseTailPage()
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

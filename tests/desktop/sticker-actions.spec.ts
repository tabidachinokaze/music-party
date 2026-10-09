import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('self and peer pictures can be collected and clipboard pictures are previewed before sending', async () => {
  const png = await readFile(join(process.cwd(), 'resources/icon.png'))
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  const self = { userId: 123, nickname: '图片测试账户' },
    peer = { userId: 456, nickname: 'Alice' }
  const calls: { route: string; args: any }[] = []
  const ownUrl = 'https://p1.music.126.net/own-picture.jpg',
    peerUrl = 'https://p1.music.126.net/peer-picture.jpg',
    emojiUrl = 'https://p1.music.126.net/peer-sticker.jpg'
  const history = [
    [self, peer, ownUrl, '自己图片'],
    [peer, self, peerUrl, '别人图片'],
    [peer, self, emojiUrl, '官方表情'],
  ].map(([fromUser, toUser, url, name], index) => ({
    id: 8000 + index,
    fromUser,
    toUser,
    time: Date.now() - 10000 + index,
    msg: JSON.stringify({
      msgType: 1,
      body: JSON.stringify({
        url,
        name,
        width: 128,
        height: 128,
        emojiId: index === 2 ? '991' : '0',
        emojiGroupId: index === 2 ? '-2' : '0',
        format: 'png',
      }),
      text: { textBody: '（升级App到最新版本即可查看该消息）' },
    }),
  }))
  let saves = 0
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
    if (route === '/login/qr/key') body = { code: 200, data: { unikey: 'picture-key' } }
    if (route === '/login/qr/create')
      body = { code: 200, data: { qrimg: `data:image/gif;base64,${gif.toString('base64')}` } }
    if (route === '/login/qr/check') body = { code: 803, cookie: 'MUSIC_U=mock; Path=/;' }
    if (route === '/user/playlist') body = { code: 200, playlist: [], more: false }
    if (route === '/album/sublist') body = { code: 200, data: [], hasMore: false }
    if (route === '/likelist') body = { code: 200, ids: [] }
    if (route === '/api/communication/msg/setting/get')
      body = { code: 200, data: { online: false } }
    if (route === '/msg/private')
      body = {
        code: 200,
        more: false,
        msgs: [
          {
            fromUser: peer,
            toUser: self,
            lastMsg: JSON.stringify({ msg: '图片测试' }),
            lastMsgTime: Date.now(),
            newMsgCount: 0,
          },
        ],
      }
    if (route === '/msg/private/history') body = { code: 200, more: false, msgs: history }
    if (route === '/api/social/emoji/collect') body = { code: 200, data: { result: true } }
    if (route === '/__save_image') {
      saves++
      body = {
        code: 200,
        emoji: {
          emojiId: String(2000 + saves),
          emojiGroupId: '-2',
          emojiName: '收藏图片',
          emojiImgUrl: args.image.url,
          width: args.image.width,
          height: args.image.height,
          format: 'png',
        },
      }
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port,
    profile = await mkdtemp(join(tmpdir(), 'music-party-sticker-actions-'))
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
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ ipcMain }, port) => {
      ipcMain.removeHandler('sticker-image')
      ipcMain.handle('sticker-image', async (_event, request) => {
        const result = (await fetch(`http://127.0.0.1:${port}/__save_image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
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
    await page.route('https://p1.music.126.net/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    )
    await page.getByRole('button', { name: '扫码登录', exact: true }).click()
    await expect(page.getByText('图片测试账户', { exact: true })).toBeVisible()
    await page.locator('.sidebar').getByRole('button', { name: '私信', exact: true }).click()
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    const log = page.getByRole('log', { name: '私信消息' })
    await expect(log.locator('.message-image')).toHaveCount(3)
    await expect(log.getByText('（升级App到最新版本即可查看该消息）', { exact: true })).toHaveCount(
      0,
    )
    for (const name of ['自己图片', '别人图片']) {
      const button = log.getByRole('button', { name: `查看图片：${name}`, exact: true })
      await expect
        .poll(() =>
          button
            .locator('img')
            .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true)
      await button.click({ button: 'right' })
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      const menuBounds = await menu.boundingBox()
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0)
      expect(menuBounds!.y).toBeGreaterThanOrEqual(0)
      await menu.getByRole('menuitem', { name: '添加到我的表情包', exact: true }).click()
      await expect(menu).toHaveCount(0)
    }
    await expect.poll(() => saves).toBe(2)
    const official = log.getByRole('button', { name: '查看图片：官方表情', exact: true })
    await official.click({ button: 'right' })
    await page.getByRole('menuitem', { name: '添加到我的表情包', exact: true }).click()
    await expect
      .poll(() => calls.filter((call) => call.route === '/api/social/emoji/collect').length)
      .toBe(1)
    expect(calls.find((call) => call.route === '/api/social/emoji/collect')!.args.data).toEqual({
      emojiId: '991',
      emojiGroupId: '-2',
    })
    expect(saves).toBe(2)
    await page.getByLabel('私信内容').fill('保留草稿')
    // Dispatch the browser paste event produced by Ctrl+V with an isolated image
    // clipboard, so this test never reads or replaces the user's OS clipboard.
    await page.getByLabel('私信内容').evaluate((textarea, base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }))
      textarea.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      )
    }, png.toString('base64'))
    await expect(page.getByRole('dialog', { name: '发送附件', exact: true })).toBeVisible()
    await expect(page.locator('.attachment-preview img')).toBeVisible()
    expect(saves).toBe(2)
    expect(
      calls.some((call) =>
        ['/api/communication/send/msg', '/send/text', '/api/nos/token/alloc'].includes(call.route),
      ),
    ).toBe(false)
    await page.getByRole('button', { name: '稍后发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送附件', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('私信内容')).toHaveValue('保留草稿')
    expect(errors).toEqual([])
    await page.screenshot({
      path: 'test-results/music-party-sticker-actions.png',
      animations: 'disabled',
    })
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

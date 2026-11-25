import { createChineseProfile, openTool, loginFixture, widenPanel, serveArtwork } from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, rm } from 'node:fs/promises'
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
            ...Array.from({ length: 30 }, (_, index) => ({
              id: 100 + index,
              name: `我的分组 ${index + 1}`,
              edit: true,
            })),
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
    profile = await createChineseProfile('music-party-stickers-')
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
    const player = await app.firstWindow()
    let page = player.locator('body')
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
    player.on('pageerror', (error) => errors.push(error.message))
    await serveArtwork(app, thumbnail, 'image/png')
    await loginFixture(app, player)
    page = await openTool(app, player, 'private')
    await widenPanel(app, page)
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await page.getByLabel('私信内容').fill('保留输入的文字')
    await page.getByRole('button', { name: '表情包', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('请重试表情列表')
    await page.getByRole('button', { name: '重试', exact: true }).click()
    const firstLoad = page.locator('.cloud-sticker-grid').getByRole('status')
    await expect(firstLoad).toHaveText('正在读取表情…')
    await expect(page.getByRole('button', { name: '常用表情', exact: true })).toHaveCount(0)
    await expect(page.locator('.sticker-tabs')).toHaveCount(0)
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
    const picker = page.getByRole('dialog', { name: '表情', exact: true })
    const geometry = () =>
      stickerGrid.evaluate((grid) => {
        const modal = grid.closest('[role="dialog"]')!.getBoundingClientRect()
        const bounds = grid.getBoundingClientRect()
        const firstVisible = [
          ...grid.querySelectorAll<HTMLButtonElement>('button[data-sticker-key]'),
        ].find((button) => button.getBoundingClientRect().bottom > bounds.top + 1)
        return {
          top: modal.top,
          bottom: modal.bottom,
          gridTop: bounds.top,
          gridHeight: bounds.height,
          anchor: firstVisible?.dataset.stickerKey,
          anchorTop: firstVisible?.getBoundingClientRect().top,
        }
      })
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
    const beforeTail = await geometry()
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await expect(
      picker.locator('.cloud-sticker-toolbar').getByRole('status', { name: '正在读取更多表情…' }),
    ).toBeVisible()
    expect(await geometry()).toEqual(beforeTail)
    await expect(stickerGrid.locator('button')).toHaveCount(20)
    releaseTailPage()
    await expect(page.getByText('23 个表情', { exact: true })).toBeVisible()
    await expect(page.locator('.cloud-sticker-grid button')).toHaveCount(23)
    expect(await geometry()).toEqual(beforeTail)
    const groupPicker = page.getByRole('combobox', { name: '表情分组' })
    await groupPicker.click()
    await expect(page.locator('select:open')).toBeVisible()
    const firstOption = groupPicker.locator('option').first()
    const originalWidth = (await firstOption.boundingBox())!.width
    await player.keyboard.press('Escape')
    const classic = await player.addStyleTag({
      content: `
        :is(.scrollbar-probe, [data-list-viewport])::-webkit-scrollbar,
        select::picker(select)::-webkit-scrollbar { width: 15px }
      `,
    })
    await groupPicker.click()
    const groupList = groupPicker.locator('.sticker-group-options')
    await expect(groupList).toHaveAttribute('data-overlayscrollbars', '')
    const row = (await firstOption.boundingBox())!
    const trigger = (await groupPicker.boundingBox())!
    expect(row.width).toBeCloseTo(originalWidth, 0)
    expect(row.x - trigger.x).toBeCloseTo(trigger.x + trigger.width - row.x - row.width, 0)
    const thumb = groupList.locator(
      '.os-scrollbar-vertical.os-scrollbar-visible .os-scrollbar-handle',
    )
    await expect(thumb).toBeVisible()
    const bounds = (await thumb.boundingBox())!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await player.mouse.move(x, y)
    await player.mouse.down()
    await player.mouse.move(x, y + 48, { steps: 6 })
    await player.mouse.up()
    await expect.poll(() => groupList.evaluate((node) => node.scrollTop)).toBeGreaterThan(20)
    await player.keyboard.press('End')
    await expect(groupPicker.locator('option').last()).toBeInViewport({ ratio: 1 })
    await expect(groupPicker.locator('option').first()).not.toBeInViewport()
    await player.keyboard.press('Escape')
    await expect(page.locator('select:open')).toHaveCount(0)
    await expect(groupPicker).toBeFocused()
    await expect(groupPicker).toHaveValue('-2')
    await classic.evaluate((el) => el.parentNode!.removeChild(el))
    await groupPicker.click()
    await page.getByRole('dialog', { name: '表情', exact: true }).getByRole('heading').click()
    await expect(page.locator('select:open')).toHaveCount(0)
    await expect(groupPicker).toBeVisible()
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
    const uploadButton = page.getByRole('button', { name: '上传自定义表情', exact: true })
    const uploadBounds = (await uploadButton.boundingBox())!
    const uploadText = (await uploadButton.locator('span').boundingBox())!
    expect(uploadText.y).toBeGreaterThanOrEqual(uploadBounds.y)
    expect(uploadText.y + uploadText.height).toBeLessThanOrEqual(
      uploadBounds.y + uploadBounds.height,
    )
    const chooser = player.waitForEvent('filechooser')
    await page.getByRole('button', { name: '上传自定义表情', exact: true }).click()
    await (await chooser).setFiles({ name: '新增.gif', mimeType: 'image/gif', buffer: gif })
    await expect(page.getByRole('dialog', { name: '上传自定义表情', exact: true })).toBeVisible()
    expect(uploads).toBe(0)
    await player.mouse.click(5, 5)
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
    await expect(groupPicker).toBeDisabled()
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
    await player.screenshot({
      path: 'test-results/music-party-custom-stickers.png',
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '发送自定义表情 新增.gif', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '表情', exact: true })).toHaveCount(0)
    const sentSticker = page.getByRole('log', { name: '私信消息' }).locator('.chat-bubble')
    await expect(sentSticker).toHaveCount(1)
    await expect(sentSticker.locator('.message-caption')).toHaveCount(0)
    await expect(
      sentSticker.getByRole('button', { name: '查看图片：新增.gif', exact: true }),
    ).toBeVisible()
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
    await test.step('chat tools share one panel and preserve the editor across layouts', async () => {
      const editor = page.getByLabel('私信内容')
      for (const [width, theme, fontScale] of [
        [1159, 'light', 100],
        [432, 'dark', 150],
      ] as const) {
        await player.evaluate((settings) => window.together.updatePreferences(settings), {
          theme,
          fontScale,
        })
        await widenPanel(app, player, width, 680)
        await page.getByRole('button', { name: 'Emoji', exact: true }).click()
        const picker = player.getByRole('dialog', { name: 'Emoji', exact: true })
        const footer = player.locator('.adaptive-player-bar')
        const checkPosition = async () => {
          const panel = (await picker.boundingBox())!
          const bar = (await footer.boundingBox())!
          if (width === 432) return Math.abs(panel.y + panel.height - bar.y) <= 1
          const thread = (await page.locator('.private-thread').boundingBox())!
          return panel.x + panel.width <= thread.x && panel.y + panel.height <= bar.y
        }
        await expect.poll(checkPosition).toBe(true)
        await expect(picker.getByRole('button', { name: '🎸', exact: true })).toHaveCount(1)
        if (width === 1159) {
          await page.getByRole('button', { name: '颜文字', exact: true }).click()
          await expect(picker).toHaveCount(0)
          const next = player.getByRole('dialog', { name: '颜文字', exact: true })
          await expect(next).toBeVisible()
          await next.getByRole('button', { name: '关闭颜文字' }).click()
        } else {
          await player.keyboard.press('Escape')
          await expect(picker).toHaveCount(0)
          await page.getByRole('button', { name: '表情包', exact: true }).click()
          const stickers = player.getByRole('dialog', { name: '表情', exact: true })
          const heading = stickers.locator('.overlay-heading')
          await stickers.getByRole('button', { name: '更多表情操作' }).click()
          await stickers.getByRole('button', { name: '整理表情', exact: true }).click()
          const before = await heading.boundingBox()
          const content = stickers.locator('.composer-panel-content')
          await content.evaluate((node) => (node.scrollTop = node.scrollHeight))
          expect(await heading.boundingBox()).toEqual(before)
          await expect(
            stickers.getByRole('button', { name: '删除所选 (0)', exact: true }),
          ).toBeInViewport()
          await stickers.getByRole('button', { name: '关闭表情' }).click()
        }
        await expect(editor).toBeFocused()
        await expect(editor).toHaveValue('保留输入的文字')
      }
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

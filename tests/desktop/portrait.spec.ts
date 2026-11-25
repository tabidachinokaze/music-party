import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { rm } from 'node:fs/promises'
import { createChineseProfile, widenPanel } from './windows'

test('one window preserves browsing and playback across compact, split and desktop layouts', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 200, data: { code: 200, profile: null } }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const dir = await createChineseProfile('music-party-portrait-')
  const app = await electron.launch({
    args: ['.', '--ozone-platform=x11', '--password-store=basic'],
    env: {
      ...process.env,
      MUSIC_PARTY_PROFILE: dir,
      MUSIC_PARTY_API_URL: 'http://127.0.0.1:' + (server.address() as { port: number }).port,
      ELECTRON_RENDERER_URL: '',
    },
  })
  try {
    const player = await app.firstWindow()
    const shell = player.locator('.adaptive-shell')
    const audio = await player.locator('audio').elementHandle()
    await widenPanel(app, player, 288, 512)
    await expect(shell).toHaveAttribute('data-layout', 'compact')
    await expect(player.locator('[data-panel="library"]')).toBeVisible()
    await expect(player.locator('[data-panel="queue"]')).toBeHidden()
    for (const width of [288, 321, 385, 519, 520, 740, 1159]) {
      await widenPanel(app, player, width, 682)
      const bar = player.locator('.adaptive-player-bar')
      const primary = (await bar.locator('.primary-play').boundingBox())!
      if (width < 520) {
        const room = (await bar.getByRole('button', { name: '一起听', exact: true }).boundingBox())!
        const identity = (await bar.locator('.footer-identity').boundingBox())!
        expect(room.x - primary.x - primary.width).toBeCloseTo(6, 0)
        expect(primary.x - identity.x - identity.width).toBeCloseTo(6, 0)
        expect(primary.x).toBeGreaterThan(width / 2)
      } else {
        expect(primary.x + primary.width / 2).toBeCloseTo(width / 2, 0)
      }
    }
    await widenPanel(app, player, 288, 512)
    await player.getByRole('button', { name: '展开正在播放', exact: true }).click()
    await expect(player.locator('.mp-window-chrome')).toHaveCount(0)
    await expect(player.getByRole('button', { name: '返回浏览' })).toBeVisible()
    await player.mouse.move(280, 8)
    await expect(player.getByRole('group', { name: '窗口控制' })).toHaveCount(0)
    await expect(player.getByRole('button', { name: '全部功能', exact: true })).toHaveCount(0)
    const nowBounds = (await player.locator('.surface-immersive').boundingBox())!
    expect(nowBounds.y).toBe(0)
    const cover = player.locator('.sleeve:visible')
    const progress = player.getByRole('slider', { name: '播放进度' })
    await expect(cover).toBeVisible()
    await expect(progress).toBeInViewport()
    const coverRect = (await cover.boundingBox())!
    expect(coverRect.width).toBeCloseTo(coverRect.height, 0)
    expect(coverRect.y + coverRect.height).toBeLessThan((await progress.boundingBox())!.y)
    await expect(player.locator('.main-sidebar')).toBeHidden()
    await player.screenshot({ path: test.info().outputPath('compact.png'), animations: 'disabled' })

    for (const width of [520, 740, 1159]) {
      await widenPanel(app, player, width, 682)
      const transport = player.locator('.footer-transport')
      await expect(transport.locator('.playback-mode')).toBeVisible()
      const play = (await transport.locator('.primary-play').boundingBox())!
      expect(play.x + play.width / 2).toBeCloseTo(width / 2, 0)
    }
    await widenPanel(app, player, 288, 512)
    await player.getByRole('button', { name: '返回浏览', exact: true }).click()
    const shortcut = player
      .locator('.mp-chrome-actions')
      .getByRole('button', { name: '全站搜索', exact: true })
    await expect(shortcut).toBeHidden()
    await player.getByRole('button', { name: '全部功能', exact: true }).click()
    const sheet = player.locator('.surface-dialog')
    const options = sheet.locator('.window-directory > button')
    await expect(options.nth(1)).toBeVisible()
    await expect
      .poll(async () => Math.round(await sheet.evaluate((el) => el.getBoundingClientRect().bottom)))
      .toBe(512)
    expect((await options.nth(1).boundingBox())!.x).toBe((await options.nth(0).boundingBox())!.x)
    await player.screenshot({
      path: test.info().outputPath('bottom-sheet.png'),
      animations: 'disabled',
    })
    await player.keyboard.press('Escape')

    await widenPanel(app, player, 385, 682)
    await shortcut.click()
    const search = player.locator('.surface-page[data-panel=search]')
    await expect(search.getByRole('searchbox')).toBeFocused()
    await expect(shortcut).toHaveCount(0)
    const topSearch = search.locator('.panel-header-slot:has(.header-search)')
    for (const fontScale of [100, 150]) {
      await player.evaluate(
        (fontScale) => window.together.updatePreferences({ fontScale }),
        fontScale,
      )
      await search.getByLabel('搜索音乐库').fill('保留搜索内容')
      const margins = await topSearch.evaluate((slot) => {
        const outer = slot.getBoundingClientRect(),
          field = slot.querySelector('form')!.getBoundingClientRect()
        return [field.top - outer.top, outer.bottom - field.bottom]
      })
      expect(Math.abs(margins[0] - margins[1])).toBeLessThanOrEqual(1)
    }
    await player.evaluate(() => window.together.updatePreferences({ fontScale: 100 }))
    await widenPanel(app, player, 740, 590)
    await expect(shell).toHaveAttribute('data-layout', 'medium')
    await expect(search.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    await expect(progress).toBeInViewport()
    const rail = player.locator('.main-sidebar')
    const navigation = ['音乐库', '搜索', '我喜欢的音乐', '最近播放', '私信', '设置']
    expect(
      await rail
        .getByRole('button')
        .evaluateAll((elements) => elements.map((el) => el.getAttribute('aria-label'))),
    ).toEqual(navigation)
    await expect(rail.getByRole('button', { name: '私信' }).locator('svg')).toHaveClass(/mail/)
    expect((await rail.getByRole('button', { name: '私信' }).boundingBox())!.y).toBeGreaterThan(400)
    await expect(rail.getByRole('button', { name: '搜索' })).toBeVisible()
    await expect(rail.getByRole('button', { name: '搜索' }).locator('span')).toBeHidden()
    await expect(rail.getByRole('button', { name: '一起听' })).toHaveCount(0)
    await expect(cover).toBeHidden()
    await player.screenshot({ path: test.info().outputPath('medium.png'), animations: 'disabled' })

    await player.getByRole('button', { name: '全部功能', exact: true }).click()
    await expect(sheet).toBeVisible()
    await widenPanel(app, player, 1120, 720)
    await expect(shell).toHaveAttribute('data-layout', 'wide')
    await expect(sheet).toBeHidden()
    await expect(player.locator('.main-sidebar')).toBeVisible()
    await expect(
      player.locator('.main-sidebar').getByRole('button', { name: /歌词|播放队列/ }),
    ).toHaveCount(0)
    await expect(search.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    await expect(player.getByRole('button', { name: '全部功能' })).toHaveCount(0)
    await expect(rail.getByRole('button', { name: '搜索' }).locator('span')).toBeVisible()
    await rail.getByRole('button', { name: '设置' }).click()
    const native = await app.browserWindow(player)
    const side = (direction: 'browser-backward' | 'browser-forward') =>
      native.evaluate(
        (win, command) => win.emit('app-command', { preventDefault() {} }, command),
        direction,
      )
    const settings = player.locator('.surface-page[data-panel=settings]')
    const category = settings.locator('.page-navigation [aria-current=page]')
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '外观' })
      .click()
    await expect(category).toHaveText('外观')
    // A single hardware gesture may arrive over IPC on either side of its DOM event.
    await side('browser-backward')
    await settings.dispatchEvent('mousedown', { button: 3 })
    await expect(category).toHaveText('设置')
    await settings.dispatchEvent('mousedown', { button: 4 })
    await side('browser-forward')
    await expect(category).toHaveText('外观')
    await side('browser-backward')
    await expect(category).toHaveText('设置')
    await side('browser-backward')
    await expect(search.getByLabel('搜索音乐库')).toBeVisible()
    await side('browser-forward')
    await expect(player.locator('.surface-page[data-panel=settings]')).toBeVisible()
    await side('browser-backward')
    await rail.getByRole('button', { name: '最近播放' }).click()
    await side('browser-forward')
    await expect(player.locator('.surface-page[data-panel=recent]')).toBeVisible()
    await side('browser-backward')
    await expect(search.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    const footer = player.locator('.adaptive-player-bar')
    await expect(footer.getByRole('button', { name: '一起听' })).toBeVisible()
    await footer.getByRole('button', { name: '展开正在播放', exact: true }).click()
    const nowPlaying = player.locator('[data-panel="lyrics"]')
    await footer.getByRole('button', { name: '歌词', exact: true }).click()
    await expect(nowPlaying.getByLabel('当前歌曲歌词')).toBeVisible()
    await footer.getByRole('button', { name: /播放队列/ }).click()
    const queue = player.locator('[data-panel="queue"]')
    await expect(queue).toBeInViewport()
    const rect = (await queue.boundingBox())!
    expect(rect.x).toBeGreaterThan(400)
    await player.keyboard.press('Escape')
    await expect(queue).toBeHidden()
    await expect(nowPlaying.getByLabel('当前歌曲歌词')).toBeVisible()
    await expect(nowPlaying).toHaveCSS('opacity', '1')
    await player.screenshot({
      path: test.info().outputPath('now-playing.png'),
      animations: 'disabled',
    })
    await player.getByRole('button', { name: '返回浏览' }).click()
    await expect(search.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    await expect(search.getByLabel('搜索音乐库')).toBeVisible()
    await player.screenshot({ path: test.info().outputPath('wide.png'), animations: 'disabled' })
    expect(app.windows()).toHaveLength(1)
    await expect(player.locator('audio')).toHaveCount(1)
    expect(await audio!.evaluate((element) => element.isConnected)).toBe(true)
  } finally {
    await app.close()
    await new Promise<void>((r) => server.close(() => r()))
    await rm(dir, { recursive: true, force: true })
  }
})

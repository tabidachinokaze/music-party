import { createChineseProfile, mouseSide, openTool, settingsGroup, widenPanel } from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import packageInfo from '../../package.json'

test('desktop settings survive restart and close-to-tray retains the same renderer', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: { code: 200, profile: null } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  const profile = await createChineseProfile('music-party-desktop-')
  const launch = () =>
    electron.launch({
      args: [
        '.',
        `--ozone-platform=${process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'}`,
        '--password-store=basic',
      ],
      env: {
        ...process.env,
        MUSIC_PARTY_PROFILE: profile,
        MUSIC_PARTY_API_URL: `http://127.0.0.1:${port}`,
        ELECTRON_RENDERER_URL: '',
      },
    })
  let app = await launch()
  try {
    let player = await app.firstWindow()
    let page = player.locator('body')
    page = await openTool(app, player, 'settings')
    await settingsGroup(page, '外观')
    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Interface language' })).toBeVisible()
    const showWindowLabel = () =>
      app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('desktop-show')?.label)
    await expect.poll(showWindowLabel).toBe('Show window')
    await page.getByRole('button', { name: '简体中文', exact: true }).click()
    await expect.poll(showWindowLabel).toBe('显示窗口')
    await page.getByRole('button', { name: '浅色', exact: true }).click()
    await expect(player.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(player.locator('html')).toHaveCSS('--mp-bg', '#f6f6f6')
    await expect(player.locator('html')).toHaveCSS('--wp-component-base', '#ffffff')
    const original = await player.evaluate(() => [innerWidth, innerHeight])
    await widenPanel(app, player, 313, 725)
    const crumbs = page.getByRole('navigation', { name: '页面导航' })
    await expect(crumbs.getByRole('button', { name: '设置', exact: true })).toBeVisible()
    await expect(crumbs.getByRole('heading', { name: '外观' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^返回/ })).toHaveCount(1)
    await expect(page.locator('.panel-titlebar')).toHaveCSS('height', '40px')
    for (const scale of [100, 150]) {
      await page.getByLabel('显示大小', { exact: true }).fill(String(scale))
      const bounds = await page
        .locator('.settings-section:not([hidden]) .setting-body')
        .evaluateAll((rows) =>
          rows.map((row) => {
            const text = row.querySelector('.setting-label')!.getBoundingClientRect()
            const control = row.lastElementChild!.getBoundingClientRect()
            return {
              left: control.x - text.x,
              below: control.top >= text.bottom - 1,
              clipped: row.scrollWidth > row.clientWidth + 1,
            }
          }),
        )
      expect(bounds).toHaveLength(5)
      for (const row of bounds) {
        expect(Math.abs(row.left)).toBeLessThanOrEqual(1)
        expect(row.below).toBe(true)
        expect(row.clipped).toBe(false)
      }
      if (scale === 100)
        await player.screenshot({
          path: test.info().outputPath('compact-appearance.png'),
          animations: 'disabled',
        })
    }
    await page.getByLabel('显示大小', { exact: true }).fill('100')
    await mouseSide(player, 'back', 110, 180)
    await expect(page.getByRole('navigation', { name: '设置分类' })).toBeVisible()
    await mouseSide(player, 'forward', 110, 180)
    await expect(crumbs.getByRole('heading', { name: '外观' })).toBeVisible()
    await widenPanel(app, player, original[0], original[1])
    const primary = () =>
      player.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--mp-primary').trim(),
      )
    await page.getByRole('button', { name: '主题色：翡翠', exact: true }).click()
    await expect.poll(primary).toBe('#1f7a61')
    await page.getByRole('button', { name: '深色', exact: true }).click()
    await expect.poll(primary).toBe('#6fd4b5')
    await page.getByRole('button', { name: '默认主题色', exact: true }).click()
    await page.getByRole('button', { name: '浅色', exact: true }).click()
    await expect.poll(primary).toBe('#6351b8')
    const win = await app.browserWindow(player)
    const physicalWidth = await win.evaluate((w) => w.getContentSize()[0])
    const originalRatio = await player.evaluate(() => devicePixelRatio)
    const scaleRange = page.getByLabel('显示大小', { exact: true })
    await scaleRange.scrollIntoViewIfNeeded()
    const track = (await scaleRange.boundingBox())!
    const y = track.y + track.height / 2
    await player.mouse.move(track.x + track.width / 2, y)
    await player.mouse.down()
    await player.mouse.move(track.x + track.width - 1, y, { steps: 5 })
    await expect(scaleRange).toHaveValue('150')
    expect(await win.evaluate((w) => w.webContents.getZoomFactor())).toBe(1)
    await player.mouse.up()
    await expect.poll(() => win.evaluate((w) => w.webContents.getZoomFactor())).toBeCloseTo(1.5)
    await page.getByRole('button', { name: '恢复默认大小', exact: true }).click()
    await expect.poll(() => player.evaluate(() => devicePixelRatio)).toBe(originalRatio)
    // Zoom affects icon hit areas as well as text. Their CSS dimensions stay stable.
    const icon = page.locator('.settings-section:visible .setting-icon svg').first()
    const iconPixels = () =>
      icon.evaluate((el) => el.getBoundingClientRect().width * devicePixelRatio)
    const originalIcon = await iconPixels()
    expect(originalIcon).toBeGreaterThan(0)
    for (const scale of [80, 150]) {
      await page.getByLabel('显示大小', { exact: true }).fill(String(scale))
      await expect
        .poll(() => win.evaluate((w) => w.webContents.getZoomFactor()))
        .toBeCloseTo(scale / 100)
      await expect
        .poll(() => player.evaluate(() => devicePixelRatio))
        .toBeCloseTo((originalRatio * scale) / 100)
      expect(await iconPixels()).toBeCloseTo((originalIcon * scale) / 100, 0)
      expect(await win.evaluate((w) => w.getContentSize()[0])).toBe(physicalWidth)
    }
    expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    expect(
      await page
        .locator('.panel-titlebar')
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    await page.getByLabel('显示大小', { exact: true }).fill('130')
    await page.getByLabel('主题颜色', { exact: true }).fill('#448aff')
    await expect(page.getByLabel('当前主题色')).toHaveText('#448aff')
    await expect(player.locator('html')).toHaveAttribute('data-custom-accent', 'true')
    const lightAccent = await player
      .locator('html')
      .evaluate((node) => getComputedStyle(node).getPropertyValue('--pink'))
    await settingsGroup(page, '播放与桌面')
    await expect(page.getByLabel('默认音量')).toHaveCount(0)
    await expect(page.getByLabel('默认播放模式')).toHaveCount(0)
    const controls = await openTool(app, player, 'controls')
    const volume = controls.getByLabel('音量', { exact: true })
    await volume.fill('0.23')
    await volume.hover()
    await player.mouse.wheel(0, -100)
    await expect(volume).toHaveValue('0.28')
    await expect(controls.getByRole('status')).toHaveText('28%')
    await player.mouse.wheel(0, 100)
    await expect(volume).toHaveValue('0.23')
    const playbackMode = controls.getByRole('combobox', { name: '播放方式' })
    await playbackMode.selectOption('single')
    await controls.getByRole('button', { name: '关闭播放调节' }).click()
    const queue = await openTool(app, player, 'queue')
    const mode = queue.getByRole('combobox', { name: '播放模式' })
    await expect(mode).toHaveValue('single')
    await mode.click()
    await expect(queue.locator('select:open')).toBeVisible()
    expect(await mode.evaluate((el) => getComputedStyle(el, '::picker(select)').appearance)).toBe(
      'base-select',
    )
    await player.keyboard.press('Escape')
    await expect(mode).toBeFocused()
    await mode.press('Enter')
    await expect(queue.locator('select:open')).toBeVisible()
    await player.keyboard.press('ArrowUp')
    await player.keyboard.press('Enter')
    await expect(mode).toHaveValue('loop')
    await queue.getByRole('button', { name: '关闭个人播放队列' }).click()
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).preferences.volume,
      )
      .toBe(0.23)
    await player.screenshot({ path: 'test-results/music-party-settings-light.png' })
    const info = await player.evaluate(() => window.together.desktopInfo())
    expect(info.trayAvailable).toBe(true)
    const rendererPid = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() !== 'about:blank')!
        .webContents.getOSProcessId(),
    )
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() !== 'about:blank')!
        .close(),
    )
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL() !== 'about:blank')!
            .isVisible(),
        ),
      )
      .toBe(false)
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() !== 'about:blank')!
          .webContents.getOSProcessId(),
      ),
    ).toBe(rendererPid)
    const second = spawn(
      app.process().spawnfile,
      [
        '.',
        `--ozone-platform=${process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'}`,
        '--password-store=basic',
        '--no-sandbox', // Match Playwright's test launcher on Ubuntu runners.
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MUSIC_PARTY_PROFILE: profile,
          MUSIC_PARTY_API_URL: `http://127.0.0.1:${port}`,
          ELECTRON_RENDERER_URL: '',
        },
        stdio: 'ignore',
      },
    )
    try {
      await expect.poll(() => second.exitCode).toBe(0)
    } finally {
      if (second.exitCode === null) second.kill()
    }
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL() !== 'about:blank')
            .length,
      ),
    ).toBe(1)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL() !== 'about:blank')!
            .isVisible(),
        ),
      )
      .toBe(true)
    await page.getByLabel('关闭窗口后继续运行').uncheck()
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).preferences
            .closeToTray,
      )
      .toBe(false)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() !== 'about:blank')!
        .setBounds({ width: 405, height: 720 }),
    )
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((w) => w.webContents.getURL() !== 'about:blank')!
              .getNormalBounds().width,
        ),
      )
      .toBe(405)
    await player.evaluate(() => window.together.updatePreferences({ language: 'en' }))
    await app.close()
    app = await launch()
    player = await app.firstWindow()
    page = player.locator('body')
    await expect(player).toHaveTitle(`Music Party ${packageInfo.version} · Listen Together`)
    await expect(player.locator('html')).toHaveAttribute('lang', 'en')
    await expect.poll(showWindowLabel).toBe('Show window')
    await player.evaluate(() => window.together.updatePreferences({ language: 'zh-CN' }))
    await expect(player).toHaveTitle(`Music Party ${packageInfo.version} · 官方多人一起听`)
    page = await openTool(app, player, 'settings')
    await expect(player.locator('html')).toHaveAttribute('data-theme', 'light')
    await settingsGroup(page, '播放与桌面')
    const restored = await openTool(app, player, 'controls')
    await expect(restored.getByLabel('音量', { exact: true })).toHaveValue('0.23')
    await expect(restored.getByRole('combobox', { name: '播放方式' })).toHaveValue('loop')
    await restored.getByRole('button', { name: '关闭播放调节' }).click()
    await settingsGroup(page, '外观')
    await expect(page.getByLabel('显示大小', { exact: true })).toHaveValue('130')
    expect(
      await (await app.browserWindow(player)).evaluate((w) => w.webContents.getZoomFactor()),
    ).toBeCloseTo(1.3)
    await expect(page.getByLabel('主题颜色', { exact: true })).toHaveValue('#448aff')
    await expect(page.getByLabel('当前主题色')).toHaveText('#448aff')
    await settingsGroup(page, '播放与桌面')
    await expect(page.getByLabel('关闭窗口后继续运行')).not.toBeChecked()
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL() !== 'about:blank')!
            .getNormalBounds().width,
      ),
    ).toBe(405)
    await settingsGroup(page, '外观')
    await page.getByRole('button', { name: '深色', exact: true }).click()
    await expect(player.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect
      .poll(() =>
        player
          .locator('html')
          .evaluate((node) => getComputedStyle(node).getPropertyValue('--pink')),
      )
      .not.toBe(lightAccent)
    await expect(page.getByRole('button', { name: '深色', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const themeChoice = page.getByRole('group', { name: '界面主题' }).locator('.selected')
    const selectedTint = await themeChoice.evaluate((button) => {
      const expected = document.createElement('i')
      expected.style.backgroundColor = '--skin-tint(var(--accent-container))'
      button.append(expected)
      const color = getComputedStyle(expected).backgroundColor
      expected.remove()
      return color
    })
    await expect(themeChoice).toHaveCSS('background-color', selectedTint)
    await page.locator('.settings-group h2').first().scrollIntoViewIfNeeded()
    await player.screenshot({ path: 'test-results/music-party-settings-dark.png' })
    await page.getByRole('button', { name: '恢复默认大小', exact: true }).click()
    await page.getByRole('button', { name: '默认主题色', exact: true }).click()
    await expect(page.getByLabel('显示大小', { exact: true })).toHaveValue('100')
    await expect(player.locator('html')).not.toHaveAttribute('data-custom-accent', 'true')
    const exited = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => {
      setTimeout(
        () =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL() !== 'about:blank')!
            .close(),
        20,
      )
    })
    await exited
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

import { createChineseProfile, openTool } from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

test('immersive playback and native fullscreen preserve navigation, focus and normal window size', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: { code: 200, profile: null } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const profile = await createChineseProfile('music-party-fullscreen-')
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
    const native = await app.browserWindow(player)
    const search = await openTool(app, player, 'search')
    await native.evaluate((w) => w.setContentSize(1062, 641))
    await expect(player.locator('.adaptive-shell')).toHaveAttribute('data-layout', 'wide')
    const searchbox = search.getByLabel('搜索音乐库')
    await player.keyboard.press('Control+k')
    await expect(searchbox).toBeFocused()
    await searchbox.click()
    await expect(searchbox).toBeFocused()
    // The contextual search shares the app title bar with the avatar and window controls.
    const field = await searchbox.boundingBox()
    const account = await player.getByRole('button', { name: '登录账号' }).boundingBox()
    const chrome = await player.locator('.mp-window-chrome').boundingBox()
    expect(field!.x + field!.width).toBeLessThan(account!.x)
    expect(field!.y + field!.height).toBeLessThanOrEqual(chrome!.y + chrome!.height)
    await searchbox.fill('保留搜索内容')
    for (const width of [288, 360, 405]) {
      await native.evaluate(
        (w, width) => w.setContentSize(width, Math.round((width * 16) / 9)),
        width,
      )
      await expect.poll(() => player.evaluate(() => innerWidth)).toBe(width)
      await expect(player.locator('.adaptive-shell')).toHaveAttribute('data-layout', 'compact')
      await expect(search.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    }
    const controls = await openTool(app, player, 'controls')
    await controls.getByRole('button', { name: '进入系统全屏' }).click()
    await expect.poll(() => native.evaluate((w) => w.isFullScreen())).toBe(true)
    await expect
      .poll(() =>
        player.evaluate(() => {
          const expected = matchMedia('(min-width: 1040px)').matches
            ? 'wide'
            : matchMedia('(min-width: 520px)').matches
              ? 'medium'
              : 'compact'
          return document.querySelector('.adaptive-shell')?.getAttribute('data-layout') === expected
        }),
      )
      .toBe(true)
    expect(app.windows()).toHaveLength(1)
    await player.screenshot({ path: test.info().outputPath('fullscreen.png') })
    await controls.getByRole('button', { name: '退出系统全屏' }).click()
    await expect.poll(() => native.evaluate((w) => w.isFullScreen())).toBe(false)
    await openTool(app, player, 'search')
    await expect(search.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    await expect(
      player.evaluate(() => window.together.setFullScreen('true' as any)),
    ).rejects.toThrow()
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).window?.width,
      )
      .toBe(405)
    await app.close()
    app = await launch()
    player = await app.firstWindow()
    await expect.poll(() => player.evaluate(() => innerWidth)).toBe(405)
    await expect(player.getByLabel('播放进度')).toBeVisible()
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

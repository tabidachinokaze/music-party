import { openTool } from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('immersive playback and native fullscreen preserve navigation, focus and normal window size', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: { code: 200, profile: null } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const profile = await mkdtemp(join(tmpdir(), 'music-party-fullscreen-'))
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
    await search.getByLabel('搜索音乐库').fill('保留搜索内容')
    for (const width of [288, 360, 405]) {
      await native.evaluate(
        (w, width) => w.setContentSize(width, Math.round((width * 16) / 9)),
        width,
      )
      await expect.poll(() => player.evaluate(() => innerWidth)).toBe(width)
      const bounds = await player.locator('.sleeve').boundingBox()
      expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThan(1)
      await expect(player.getByLabel('播放进度')).toBeVisible()
    }
    const controls = await openTool(app, player, 'controls')
    await controls.getByRole('button', { name: '进入系统全屏' }).click()
    await expect.poll(() => native.evaluate((w) => w.isFullScreen())).toBe(true)
    await expect
      .poll(() =>
        player
          .locator('.portrait-player')
          .evaluate((n) => Math.round((100 * n.clientWidth) / n.clientHeight)),
      )
      .toBe(56)
    await player.screenshot({ path: test.info().outputPath('fullscreen.png') })
    await player.bringToFront()
    await player.keyboard.press('Escape')
    await expect.poll(() => native.evaluate((w) => w.isFullScreen())).toBe(false)
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

import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openTool } from './windows'

test('portrait player keeps its transport and playhead while real satellites follow, detach and reattach', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 200, data: { code: 200, profile: null } }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const dir = await mkdtemp(join(tmpdir(), 'music-party-portrait-'))
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
    const playhead = player.getByRole('slider', { name: '播放进度' })
    await expect(playhead).toBeVisible()
    await expect(player.locator('button')).toHaveCount(7)
    const geometry = () =>
      player.evaluate(() => {
        const bounds = (selector: string) => {
          const b = document.querySelector(selector)!.getBoundingClientRect()
          return [b.x, b.y, b.width, b.height, b.bottom]
        }
        return {
          stage: bounds('.portrait-player'),
          cover: bounds('.sleeve'),
          progress: bounds('.playhead'),
          buttons: bounds('.portrait-transport'),
          overflow:
            document.documentElement.scrollWidth > innerWidth ||
            document.documentElement.scrollHeight > innerHeight,
        }
      })
    const initial = await geometry()
    expect(initial.stage[2] / initial.stage[3]).toBeCloseTo(9 / 16, 2)
    expect(initial.cover[4]).toBeLessThan(initial.progress[1])
    expect(initial.progress[4]).toBeLessThan(initial.buttons[1])
    expect(initial.overflow).toBe(false)
    const lyrics = await openTool(app, player, 'lyrics')
    await expect(lyrics.getByLabel('当前歌曲歌词')).toBeVisible()
    const controls = await openTool(app, player, 'controls')
    await expect(controls.getByRole('slider', { name: '音量' })).toBeVisible()
    await expect(player.locator('.desktop-panel,.lyrics-surface,.private-layout')).toHaveCount(0)
    const positions = () =>
      app.evaluate(({ BrowserWindow }) =>
        Object.fromEntries(
          BrowserWindow.getAllWindows().map((w) => [w.getTitle().split(' · ')[0], w.getBounds()]),
        ),
      )
    const home = await app.browserWindow(player)
    const before = await positions()
    await home.evaluate((w) => {
      const [x, y] = w.getPosition()
      w.setPosition(x + 50, y + 35)
    })
    await expect.poll(async () => (await positions())['歌词'].x).toBe(before['歌词'].x + 50)
    expect((await positions())['播放调节'].y).toBe(before['播放调节'].y + 35)
    const header = await controls.locator('.panel-titlebar h1').boundingBox()
    const x = header!.x + 20,
      y = header!.y + 8
    await controls.mouse.move(x, y)
    await controls.mouse.down()
    await controls.mouse.move(x + 80, y + 10)
    await controls.mouse.up()
    await expect(controls.getByRole('button', { name: '贴靠到播放器' })).toBeVisible()
    const detached = (await positions())['播放调节']
    await home.evaluate((w) => {
      const [x, y] = w.getPosition()
      w.setPosition(x - 38, y + 9)
    })
    await expect.poll(async () => (await positions())['歌词'].x).toBe(before['歌词'].x + 12)
    expect((await positions())['播放调节']).toEqual(detached)
    await controls.getByRole('button', { name: '贴靠到播放器' }).click()
    await expect(controls.getByRole('button', { name: '解除贴靠' })).toBeVisible()
    const after = await geometry()
    expect(after).toEqual(initial)
    await player.screenshot({
      path: test.info().outputPath('portrait.png'),
      animations: 'disabled',
    })
    await lyrics.screenshot({ path: test.info().outputPath('lyrics.png'), animations: 'disabled' })
    await controls.getByRole('button', { name: '关闭播放调节' }).click()
    expect(await openTool(app, player, 'controls')).toBe(controls)
    await expect(player.locator('audio')).toHaveCount(1)
    await expect(controls.locator('audio')).toHaveCount(0)
  } finally {
    await app.close()
    await new Promise<void>((r) => server.close(() => r()))
    await rm(dir, { recursive: true, force: true })
  }
})

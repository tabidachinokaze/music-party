import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openTool, widenPanel } from './windows'

test('one window preserves browsing and playback across compact, split and desktop layouts', async () => {
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
    const shell = player.locator('.adaptive-shell')
    const audio = await player.locator('audio').elementHandle()
    await widenPanel(app, player, 288, 512)
    await expect(shell).toHaveAttribute('data-layout', 'compact')
    const cover = player.locator('.sleeve:visible')
    const progress = player.getByRole('slider', { name: '播放进度' })
    await expect(cover).toBeVisible()
    await expect(progress).toBeInViewport()
    const coverRect = (await cover.boundingBox())!
    expect(coverRect.width).toBeCloseTo(coverRect.height, 0)
    expect(coverRect.y + coverRect.height).toBeLessThan((await progress.boundingBox())!.y)
    await expect(player.locator('.main-sidebar')).toBeHidden()
    await player.screenshot({ path: test.info().outputPath('compact.png'), animations: 'disabled' })

    const search = await openTool(app, player, 'search')
    await search.getByLabel('搜索音乐库').fill('保留搜索内容')
    await widenPanel(app, player, 740, 590)
    await expect(shell).toHaveAttribute('data-layout', 'medium')
    await expect(search.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    await expect(progress).toBeInViewport()
    await expect(cover).toBeInViewport()
    await player.screenshot({ path: test.info().outputPath('medium.png'), animations: 'disabled' })

    await widenPanel(app, player, 1120, 720)
    await expect(shell).toHaveAttribute('data-layout', 'wide')
    await expect(player.locator('.main-sidebar')).toBeVisible()
    await expect(
      player.locator('.main-sidebar').getByRole('button', { name: /歌词|播放队列/ }),
    ).toHaveCount(0)
    await expect(search.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    const footer = player.locator('.adaptive-player-bar')
    await footer.getByRole('button', { name: '展开正在播放', exact: true }).click()
    const nowPlaying = player.locator('[data-panel="lyrics"]')
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
    await nowPlaying.getByRole('button', { name: '返回浏览' }).click()
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

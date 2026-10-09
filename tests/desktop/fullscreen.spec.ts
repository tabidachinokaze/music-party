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
    let page = await app.firstWindow()
    const nativeFullScreen = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
    await page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByLabel('搜索音乐库').fill('保留搜索内容')
    await page.getByRole('button', { name: '打开播放界面' }).click()
    await expect(page.getByRole('button', { name: '收起播放界面' })).toBeFocused()
    await expect(page.locator('.sidebar')).toBeHidden()
    expect(await nativeFullScreen()).toBe(false)
    // Resizing through former cover-size breakpoints must keep a square cover
    // without a sudden change in its width.
    const resizeCover = async (width: number, height: number) => {
      await app.evaluate(
        ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds),
        { width, height },
      )
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => {
            const { width, height } = BrowserWindow.getAllWindows()[0].getBounds()
            return { width, height }
          }),
        )
        .toEqual({ width, height })
      await expect
        .poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
        .toEqual({ width, height })
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      // Container units can settle after the native resize. Wait for the cover
      // to fit the new slot before comparing sizes across the breakpoint.
      await expect
        .poll(() =>
          page.locator('.album-artwork').evaluate((node) => {
            const cover = node.getBoundingClientRect()
            const slot = node.parentElement!.getBoundingClientRect()
            return cover.width <= slot.width + 1 && cover.height <= slot.height + 1
          }),
        )
        .toBe(true)
      const cover = await page.locator('.album-artwork').evaluate((node) => {
        const { width, height } = node.getBoundingClientRect()
        return { width, height }
      })
      expect(cover.width).toBeGreaterThan(0)
      expect(Math.abs(cover.width - cover.height)).toBeLessThanOrEqual(1)
      return cover.width
    }
    for (const [first, second] of [
      [
        [1099, 900],
        [1101, 900],
      ],
      [
        [1449, 900],
        [1451, 900],
      ],
      [
        [1200, 779],
        [1200, 781],
      ],
    ]) {
      const before = await resizeCover(first[0], first[1])
      const after = await resizeCover(second[0], second[1])
      expect(
        Math.abs(after - before),
        `cover width between ${first.join('×')} and ${second.join('×')}`,
      ).toBeLessThanOrEqual(4)
    }
    await page.getByRole('button', { name: '进入系统全屏' }).click()
    await expect.poll(nativeFullScreen).toBe(true)
    await expect(page.getByRole('button', { name: '退出系统全屏' })).toBeVisible()
    await page.getByRole('button', { name: '播放队列', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '播放队列', exact: true })).toHaveCount(0)
    expect(await nativeFullScreen()).toBe(true)
    await page.screenshot({ path: 'test-results/music-party-native-fullscreen.png' })
    await page.keyboard.press('Escape')
    await expect.poll(nativeFullScreen).toBe(false)
    // Native transitions notify the renderer asynchronously; wait before the next Escape.
    await expect(page.getByRole('button', { name: '进入系统全屏' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('搜索音乐库')).toBeVisible()
    await expect(page.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    await expect(page.getByRole('button', { name: '打开播放界面' })).toBeFocused()

    // Each direction must complete on a single click, across repeated transitions.
    await page.getByRole('button', { name: '打开播放界面' }).click()
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '进入系统全屏' }).click()
      await expect.poll(nativeFullScreen).toBe(true)
      await page.getByRole('button', { name: '退出系统全屏' }).click()
      await expect.poll(nativeFullScreen).toBe(false)
    }
    await page.getByRole('button', { name: '收起播放页' }).click()
    await expect(page.getByLabel('搜索音乐库')).toBeVisible()

    // Native menu/window-manager changes must also update the player and its fullscreen button.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true))
    await expect(page.getByRole('button', { name: '退出系统全屏' })).toBeVisible()
    await expect(page.locator('.music-header')).toBeHidden()
    await page.getByRole('button', { name: '收起播放界面' }).click()
    await expect.poll(nativeFullScreen).toBe(false)
    await expect(page.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    await page.getByRole('button', { name: '打开播放界面' }).click()
    await page.getByRole('button', { name: '进入系统全屏' }).click()
    await expect(page.getByRole('button', { name: '退出系统全屏' })).toBeVisible()
    await page.keyboard.press('Control+f')
    await expect.poll(nativeFullScreen).toBe(false)
    await expect(page.getByLabel('搜索音乐库')).toHaveValue('保留搜索内容')
    await expect(page.evaluate(() => window.together.setFullScreen('true' as any))).rejects.toThrow(
      '全屏状态无效',
    )

    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1150, height: 780 }),
    )
    const savedWindow = async () =>
      JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).window
    await expect.poll(async () => (await savedWindow()).width).toBe(1150)
    const normal = await savedWindow()
    await page.getByRole('button', { name: '打开播放界面' }).click()
    await page.getByRole('button', { name: '进入系统全屏' }).click()
    await expect(page.getByRole('button', { name: '退出系统全屏' })).toBeVisible()
    await app.close()
    expect(await savedWindow()).toEqual(normal)
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '展开播放界面' })).toBeVisible()
    expect(await nativeFullScreen()).toBe(false)
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds().width,
      ),
    ).toBe(1150)
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

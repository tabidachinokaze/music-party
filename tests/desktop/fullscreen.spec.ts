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

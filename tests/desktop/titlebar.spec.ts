import { expect, test, _electron as electron, type Locator } from '@playwright/test'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { widenPanel } from './windows'

// Chromium's DevTools mouse events bypass the operating system's caption hit test.
// Send the click through XTEST on a private virtual display, never the user's desktop.
const x11Click = `
import ctypes as c, sys
x11, xtst = c.CDLL("libX11.so.6"), c.CDLL("libXtst.so.6")
x11.XOpenDisplay.restype = c.c_void_p
display = c.c_void_p(x11.XOpenDisplay(None))
assert display.value
assert xtst.XTestFakeMotionEvent(display, 0, int(sys.argv[1]), int(sys.argv[2]), 0)
assert xtst.XTestFakeButtonEvent(display, 1, 1, 0)
assert xtst.XTestFakeButtonEvent(display, 1, 0, 20)
x11.XSync(display, 0)
x11.XCloseDisplay(display)
`

test('native pointer reaches title bar buttons and search with and without a drawer', async () => {
  test.skip(process.platform !== 'linux' || !!spawnSync('Xvfb', ['-help']).error, 'requires Xvfb')
  const profile = await mkdtemp(join(tmpdir(), 'music-party-titlebar-'))
  const display = spawn('Xvfb', [
    '-displayfd',
    '1',
    '-screen',
    '0',
    '1280x800x24',
    '-nolisten',
    'tcp',
  ])
  const displayNumber = createInterface({ input: display.stdout })
  const api = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    const path = new URL(req.url!, 'http://localhost').pathname
    if (path === '/login/qr/key')
      res.end(JSON.stringify({ code: 200, data: { unikey: 'titlebar' } }))
    else if (path === '/login/qr/create')
      res.end(
        JSON.stringify({
          code: 200,
          data: {
            qrimg: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          },
        }),
      )
    else res.end(JSON.stringify({ code: 200, data: { code: 200, profile: null } }))
  })
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const [number] = await Promise.race([
      once(displayNumber, 'line'),
      once(display, 'exit').then(() => {
        throw new Error('Xvfb exited before publishing its display')
      }),
    ])
    expect(number).toMatch(/^\d+$/)
    const env = { ...process.env, DISPLAY: ':' + number, WAYLAND_DISPLAY: '' }
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
    app = await electron.launch({
      args: [
        '.',
        '--ozone-platform=x11',
        '--force-device-scale-factor=1',
        '--password-store=basic',
      ],
      env: {
        ...env,
        MUSIC_PARTY_PROFILE: profile,
        MUSIC_PARTY_API_URL: 'http://127.0.0.1:' + (api.address() as { port: number }).port,
        ELECTRON_RENDERER_URL: '',
      },
    })
    const player = await app.firstWindow()
    const native = await app.browserWindow(player)
    await widenPanel(app, player, 643, 560)
    await native.evaluate((w) => {
      w.setPosition(32, 32)
      w.focus()
    })
    await player.emulateMedia({ reducedMotion: 'reduce' })
    const click = async (node: Locator) => {
      await expect(node).toBeVisible()
      const box = (await node.boundingBox())!
      const origin = await native.evaluate((w) => w.getContentBounds())
      const x = Math.floor(origin.x + box.x + box.width / 2)
      const y = Math.floor(origin.y + box.y + box.height / 2)
      execFileSync('python3', ['-c', x11Click, String(x), String(y)], { env })
    }
    const library = player.locator('.surface-page[data-panel=library]')
    const albums = player.locator('.surface-page[data-panel=albums]')
    const tab = library.getByRole('button', { name: '收藏的专辑', exact: true })
    await click(tab)
    const search = albums.getByRole('searchbox')
    const searchForm = albums.locator('.header-search')
    const restingBorder = await searchForm.evaluate((node) => getComputedStyle(node).borderTopColor)
    await click(search)
    await expect(search).toBeFocused()
    await expect(search).toHaveCSS('border-radius', '0px')
    await expect(search).toHaveCSS('user-select', 'text')
    await expect(searchForm).not.toHaveCSS('border-top-color', restingBorder)
    await expect(searchForm).toHaveCSS('border-top-width', '1px')
    await expect(searchForm).toHaveCSS('outline-style', 'none')
    await expect(search).toHaveCSS('outline-style', 'none')
    await player.keyboard.type('album')
    await click(albums.getByRole('button', { name: '清空列表搜索' }))
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    await click(albums.locator('.page-crumbs button'))
    await expect(library).toBeVisible()
    await click(tab)
    await click(albums.locator('.surface-back'))
    await expect(library).toBeVisible()

    const actions = player.locator('.mp-chrome-actions')
    await click(actions.getByRole('button', { name: '全部功能' }))
    const menu = player.locator('.surface-dialog[data-panel=windows]')
    await click(menu.locator('.surface-close'))
    await expect(menu).toBeHidden()
    await click(actions.getByRole('button', { name: '登录账号' }))
    const login = player.locator('.surface-dialog[data-panel=login]')
    await expect(login.getByRole('status')).toHaveText('等待扫码')
    await click(login.locator('.surface-close'))
    await expect(login).toBeHidden()

    // Xvfb has no window manager. Observe that actual pointer clicks reach the
    // main-process window actions without hiding or destroying the test window.
    const calls = await native.evaluateHandle((w) => {
      const received: string[] = []
      for (const key of ['minimize', 'maximize', 'close'] as const)
        w[key] = () => {
          received.push(key)
        }
      return received
    })
    const controls = player.getByRole('group', { name: '窗口控制' })
    const queue = player.locator('.surface-drawer[data-panel=queue]')
    const points = []
    for (const name of ['最小化', '最大化', '关闭窗口']) {
      const button = controls.getByRole('button', { name, exact: true })
      const box = (await button.boundingBox())!
      points.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
      await click(button)
    }
    const expected = ['minimize', 'maximize', 'close']
    await expect.poll(() => calls.evaluate((list) => [...list])).toEqual(expected)
    await click(player.locator('.adaptive-player-bar').getByRole('button', { name: /播放队列/ }))
    await expect(queue).toBeVisible()
    await expect(controls).toHaveCount(0)
    const origin = await native.evaluate((w) => w.getContentBounds())
    for (const { x, y } of points) {
      expect(
        await queue.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), { x, y }),
      ).toBe(true)
      execFileSync(
        'python3',
        ['-c', x11Click, String(Math.floor(origin.x + x)), String(Math.floor(origin.y + y))],
        { env },
      )
    }
    await expect(queue).toBeVisible()
    await click(queue.locator('.drawer-collapse'))
    await expect(queue).toBeHidden()
    await click(controls.getByRole('button', { name: '最小化', exact: true }))
    await expect.poll(() => calls.evaluate((list) => [...list])).toEqual([...expected, 'minimize'])
    await widenPanel(app, player, 385, 650)
    await click(actions.getByRole('button', { name: '全站搜索' }))
    const globalSearch = player.locator('.surface-page[data-panel=search] .header-search')
    await expect(globalSearch.getByRole('searchbox')).toBeFocused()
    await globalSearch.getByRole('searchbox').blur()
    await click(globalSearch.locator('svg').first())
    await expect(globalSearch.getByRole('searchbox')).toBeFocused()
  } finally {
    await app?.close()
    if (api.listening) await new Promise<void>((resolve) => api.close(() => resolve()))
    displayNumber.close()
    display.kill()
    await rm(profile, { recursive: true, force: true })
  }
})

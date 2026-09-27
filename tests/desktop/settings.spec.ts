import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
  const profile = await mkdtemp(join(tmpdir(), 'music-party-desktop-'))
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
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '浅色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByLabel('默认音量').fill('0.23')
    await page.getByLabel('默认播放模式').selectOption('loop')
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).preferences.volume,
      )
      .toBe(0.23)
    await page.screenshot({ path: 'test-results/music-party-settings-light.png' })
    const info = await page.evaluate(() => window.together.desktopInfo())
    expect(info.trayAvailable).toBe(true)
    const rendererPid = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
    )
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
      .toBe(false)
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(),
      ),
    ).toBe(rendererPid)
    const second = spawn(
      app.process().spawnfile,
      [
        '.',
        `--ozone-platform=${process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'}`,
        '--password-store=basic',
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
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
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
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1150, height: 780 }),
    )
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds().width,
        ),
      )
      .toBe(1150)
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page).toHaveTitle(`Music Party ${packageInfo.version} · 官方多人一起听`)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByLabel('默认音量')).toHaveValue('0.23')
    await expect(page.getByLabel('默认播放模式')).toHaveValue('loop')
    await expect(page.getByLabel('关闭窗口后继续运行')).not.toBeChecked()
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds().width,
      ),
    ).toBe(1150)
    await page.getByRole('button', { name: '深色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: 'test-results/music-party-settings-dark.png' })
    const exited = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 20)
    })
    await exited
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

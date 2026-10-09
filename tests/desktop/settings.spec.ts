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
    const defaultFont = await page
      .locator('.settings-group h2')
      .first()
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
    await page.getByLabel('界面字体大小', { exact: true }).fill('150')
    await expect
      .poll(() =>
        page
          .locator('.settings-group h2')
          .first()
          .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
      )
      .toBeCloseTo(defaultFont * 1.5, 2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      await page.locator('.brand > div').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    await page.getByLabel('界面字体大小', { exact: true }).fill('130')
    await page.getByLabel('主题颜色', { exact: true }).fill('#448aff')
    await expect(page.getByLabel('当前主题色')).toHaveText('#448aff')
    await expect(page.locator('html')).toHaveAttribute('data-custom-accent', 'true')
    const lightAccent = await page
      .locator('html')
      .evaluate((node) => getComputedStyle(node).getPropertyValue('--pink'))
    await page.getByLabel('默认音量').fill('0.23')
    await expect(page.getByLabel('当前音量', { exact: true })).toHaveText('23%')
    await page.getByLabel('默认音量').hover()
    await page.mouse.wheel(0, -100)
    await expect(page.getByLabel('默认音量')).toHaveValue('0.28')
    await expect(page.getByLabel('当前音量', { exact: true })).toHaveText('28%')
    await page.getByLabel('音量', { exact: true }).hover()
    await page.mouse.wheel(0, 100)
    await expect(page.getByLabel('默认音量')).toHaveValue('0.23')
    await expect(page.getByLabel('音量', { exact: true })).toHaveAttribute('aria-valuetext', '23%')
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
    await expect(page.getByLabel('界面字体大小', { exact: true })).toHaveValue('130')
    await expect(page.getByLabel('主题颜色', { exact: true })).toHaveValue('#448aff')
    await expect(page.getByLabel('当前主题色')).toHaveText('#448aff')
    await expect(page.getByLabel('关闭窗口后继续运行')).not.toBeChecked()
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds().width,
      ),
    ).toBe(1150)
    await page.getByRole('button', { name: '深色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect
      .poll(() =>
        page.locator('html').evaluate((node) => getComputedStyle(node).getPropertyValue('--pink')),
      )
      .not.toBe(lightAccent)
    await expect(page.getByRole('button', { name: '深色', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const darkContainer = await page.locator('html').evaluate((node) => {
      const hex = getComputedStyle(node).getPropertyValue('--accent-container').trim()
      return `rgb(${hex
        .slice(1)
        .match(/../g)!
        .map((channel) => parseInt(channel, 16))
        .join(', ')})`
    })
    await expect
      .poll(() =>
        page
          .locator('.theme-options .selected')
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .toBe(darkContainer)
    await page.locator('.settings-group h2').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/music-party-settings-dark.png' })
    await page.getByRole('button', { name: '默认字号', exact: true }).click()
    await page.getByRole('button', { name: '默认主题色', exact: true }).click()
    await expect(page.getByLabel('界面字体大小', { exact: true })).toHaveValue('100')
    await expect(page.locator('html')).not.toHaveAttribute('data-custom-accent', 'true')
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

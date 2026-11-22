import { settingsGroup, openTool, widenPanel } from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('application skin previews and saves images, covers the whole window and survives restart', async () => {
  test.setTimeout(60000)
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: { code: 200, profile: null } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  const profile = await mkdtemp(join(tmpdir(), 'music-party-player-background-'))
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
    let page = await openTool(app, player, 'settings')
    await settingsGroup(page, '外观')
    const errors: string[] = []
    player.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    let popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    const fixture = await player.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 800
      const context = canvas.getContext('2d')!
      context.fillStyle = '#4888dd'
      context.fillRect(0, 0, 1200, 800)
      context.fillStyle = '#e5c95c'
      context.fillRect(0, 0, 600, 400)
      context.fillStyle = '#965cbc'
      context.fillRect(600, 400, 600, 400)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const file = {
      name: 'background.png',
      mimeType: 'image/png',
      buffer: Buffer.from(fixture, 'base64'),
    }
    const codecs = await player.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 80
      canvas.height = 40
      const context = canvas.getContext('2d')!
      context.fillStyle = '#4888dd'
      context.fillRect(0, 0, 80, 40)
      context.fillStyle = '#e5c95c'
      context.fillRect(0, 0, 40, 40)
      return [
        {
          format: 'JPEG',
          mime: 'image/jpeg',
          extension: 'jpg',
          source: canvas.toDataURL('image/jpeg').split(',')[1],
          width: 80,
          height: 40,
        },
        {
          format: 'WebP',
          mime: 'image/webp',
          extension: 'webp',
          source: canvas.toDataURL('image/webp').split(',')[1],
          width: 80,
          height: 40,
        },
      ]
    })
    codecs.push({
      format: 'GIF',
      mime: 'image/gif',
      extension: 'gif',
      source: Buffer.from(
        '47494638396101000100800000000000ffffff2c00000000010001000002024401003b',
        'hex',
      ).toString('base64'),
      width: 1,
      height: 1,
    })
    for (const codec of codecs) {
      await test.step(`import ${codec.format} through the image picker and save a PNG`, async () => {
        await popup.getByRole('button', { name: '恢复默认背景', exact: true }).click()
        await expect(popup.locator('.player-background-layer')).toHaveCount(0)
        await popup.getByLabel('选择播放器背景图片').setInputFiles({
          name: `background.${codec.extension}`,
          mimeType: codec.mime,
          buffer: Buffer.from(codec.source, 'base64'),
        })
        const image = popup.locator('.background-preview .player-background-layer img')
        await expect(image).toBeVisible()
        await expect(popup.getByRole('alert')).toHaveCount(0)
        await expect
          .poll(() =>
            image.evaluate((node: HTMLImageElement) => ({
              width: node.naturalWidth,
              height: node.naturalHeight,
            })),
          )
          .toEqual({ width: codec.width, height: codec.height })
        await popup.getByRole('button', { name: '保存背景', exact: true }).click()
        await expect(popup).toHaveCount(0)
        expect(
          (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground
            .image,
        ).toMatch(/^data:image\/png;base64,/)
        await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
        popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
      })
    }
    await popup.getByRole('button', { name: '恢复默认背景', exact: true }).click()
    await popup.getByRole('button', { name: '保存背景', exact: true }).click()
    await expect(popup).toHaveCount(0)
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByLabel('选择播放器背景图片').setInputFiles(file)
    await expect(popup.locator('.background-preview .player-background-layer img')).toBeVisible()
    await popup.getByLabel('背景缩放', { exact: true }).fill('180')
    await popup.getByRole('button', { name: '取消', exact: true }).click()
    await expect(popup).toHaveCount(0)
    expect(
      (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground
        .image,
    ).toBeNull()
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByLabel('选择播放器背景图片').setInputFiles({
      name: 'invalid.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image'),
    })
    await expect(popup.getByRole('alert')).toBeVisible()
    await expect(popup.locator('.player-background-layer')).toHaveCount(0)
    await popup.getByLabel('选择播放器背景图片').setInputFiles(file)
    await expect(popup.locator('.background-preview .player-background-layer img')).toBeVisible()
    await expect(popup.getByRole('alert')).toHaveCount(0)
    await popup.getByLabel('背景缩放', { exact: true }).fill('180')
    await popup.getByLabel('背景透明度', { exact: true }).fill('25')
    await popup.getByLabel('背景模糊', { exact: true }).fill('6')
    const preview = popup.getByRole('group', { name: '背景位置预览', exact: true })
    // The editor uses the exact crop of the main window, including when resized while open.
    for (const [width, height] of [
      [288, 512],
      [800, 610],
      [1100, 720],
    ]) {
      await widenPanel(app, player, width, height)
      await expect
        .poll(async () => {
          const rect = await preview.boundingBox()
          return rect ? rect.width / rect.height : 0
        })
        .toBeCloseTo(width / height, 1)
      const fits = await popup.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight &&
          node.scrollWidth <= node.clientWidth
        )
      })
      expect(fits).toBe(true)
    }
    await preview.scrollIntoViewIfNeeded()
    const bounds = (await preview.boundingBox())!
    await player.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await player.mouse.down()
    await player.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2 + 25, {
      steps: 5,
    })
    await player.mouse.up()
    const coordinates = await popup.getByLabel('背景水平位置', { exact: true }).inputValue()
    const vertical = await popup.getByLabel('背景垂直位置', { exact: true }).inputValue()
    expect(Number(coordinates)).toBeLessThan(50)
    expect(Number(vertical)).toBeLessThan(50)
    await player.screenshot({
      path: 'test-results/music-party-background-editor.png',
      animations: 'disabled',
    })
    expect(
      (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground
        .image,
    ).toBeNull()
    const settingsFile = join(profile, 'settings.json'),
      backup = settingsFile + '.good'
    await expect.poll(async () => (await readFile(settingsFile, 'utf8')).length).toBeGreaterThan(0)
    await rename(settingsFile, backup)
    await mkdir(settingsFile)
    await popup.getByRole('button', { name: '保存背景', exact: true }).click()
    await expect(popup.getByRole('alert')).toContainText('设置保存失败')
    await expect(popup.getByLabel('背景缩放', { exact: true })).toHaveValue('180')
    await expect(popup).not.toHaveAttribute('inert')
    expect(
      (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground
        .image,
    ).toBeNull()
    await rm(settingsFile, { recursive: true })
    await rename(backup, settingsFile)
    await popup.getByRole('button', { name: '保存背景', exact: true }).click()
    await expect(popup).toHaveCount(0)
    const saved = (await player.evaluate(() => window.together.desktopInfo())).preferences
      .playerBackground
    expect(saved).toMatchObject({ zoom: 180, opacity: 75, blur: 6 })
    expect(saved.x).toBeLessThan(50)
    expect(saved.y).toBeLessThan(50)
    expect(saved.image).toMatch(/^data:image\/png;base64,/)
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).preferences
            .playerBackground,
      )
      .toEqual(saved)
    await expect(player.locator('.adaptive-shell > .player-background-layer img')).toBeVisible()
    for (const [label, theme] of [
      ['深色', 'dark'],
      ['浅色', 'light'],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect(player.locator('html')).toHaveAttribute('data-theme', theme)
      const layer = await player.locator('.adaptive-shell > .player-background-layer').boundingBox()
      const shell = await player.locator('.adaptive-shell').boundingBox()
      expect(layer!.width).toBeCloseTo(shell!.width, 0)
      expect(layer!.height).toBeCloseTo(shell!.height, 0)
      await expect(player.getByRole('slider', { name: '播放进度' })).toBeVisible()
    }
    await app.close()
    app = await launch()
    player = await app.firstWindow()
    await expect(player.locator('.adaptive-shell > .player-background-layer img')).toBeVisible()
    page = await openTool(app, player, 'settings')
    await settingsGroup(page, '外观')
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await expect(popup.getByLabel('背景缩放', { exact: true })).toHaveValue('180')
    await expect(popup.getByLabel('背景透明度', { exact: true })).toHaveValue('25')
    await expect(popup.getByLabel('背景模糊', { exact: true })).toHaveValue('6')
    expect(
      (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground,
    ).toEqual(saved)
    await popup.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByRole('button', { name: '重置位置', exact: true }).click()
    await expect(popup.getByLabel('背景水平位置', { exact: true })).toHaveValue('50')
    await expect(popup.getByLabel('背景垂直位置', { exact: true })).toHaveValue('50')
    await popup.getByRole('button', { name: '恢复默认背景', exact: true }).click()
    await expect(popup.locator('.player-background-layer')).toHaveCount(0)
    await popup.getByRole('button', { name: '取消', exact: true }).click()
    expect(
      (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground,
    ).toEqual(saved)
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByRole('button', { name: '恢复默认背景', exact: true }).click()
    await popup.getByRole('button', { name: '保存背景', exact: true }).click()
    await expect(popup).toHaveCount(0)
    expect(
      (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground,
    ).toEqual({ image: null, zoom: 100, opacity: 35, blur: 0, x: 50, y: 50 })
    await expect(player.locator('.adaptive-shell > .player-background-layer')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

import { DEFAULT_PLAYER_BACKGROUND } from '../../src/shared/desktop'
import { createChineseProfile, settingsGroup, openTool, widenPanel } from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

test('application skin previews and saves images, covers the whole window and survives restart', async () => {
  test.setTimeout(60000)
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: { code: 200, profile: null } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  const profile = await createChineseProfile('music-party-player-background-')
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
    for (const slider of await page.getByRole('slider').all()) {
      await expect(slider).toHaveCSS('border-top-width', '0px')
      expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(20)
    }
    const layoutSlider = page.getByLabel('布局背景透明度', { exact: true })
    await layoutSlider.focus()
    await layoutSlider.press('ArrowLeft')
    await expect(layoutSlider).toHaveCSS('outline-style', 'solid')
    await layoutSlider.press('ArrowRight')
    await page.getByRole('button', { name: '编辑背景', exact: true }).click()
    let popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await expect(popup.getByRole('slider', { name: '组件底色透明度' })).toHaveCount(0)
    for (const slider of await popup.getByRole('slider').all()) {
      await expect(slider).toHaveCSS('border-top-width', '0px')
    }
    await expect(popup.locator('.player-background-layer')).toHaveCount(0)
    await expect(popup.getByRole('button', { name: /猫耳少女|东京雨夜/ })).toHaveCount(0)
    await expect(player.locator('.adaptive-shell > .player-background-layer')).toHaveCount(0)
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
      name: '猫耳少女.png',
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
        await page.getByRole('button', { name: '编辑背景', exact: true }).click()
        popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
      })
    }
    await popup.getByRole('button', { name: '恢复默认背景', exact: true }).click()
    await popup.getByRole('button', { name: '保存背景', exact: true }).click()
    await expect(popup).toHaveCount(0)
    await page.getByRole('button', { name: '编辑背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByLabel('选择播放器背景图片').setInputFiles(file)
    await expect(popup.locator('.background-preview .player-background-layer img')).toBeVisible()
    await popup.getByRole('button', { name: '显示焦点' }).click()
    await expect(popup.locator('.background-focus')).toBeVisible()
    await popup.getByLabel('背景缩放', { exact: true }).fill('180')
    await popup.getByRole('button', { name: '取消', exact: true }).click()
    await expect(popup).toHaveCount(0)
    expect(
      (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground
        .image,
    ).toBeNull()
    await page.getByRole('button', { name: '编辑背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByLabel('布局背景透明度', { exact: true }).fill('70')
    await page.getByLabel('组件底色透明度', { exact: true }).fill('40')
    await page.getByLabel('弹窗底色透明度', { exact: true }).fill('57')
    await page.getByRole('button', { name: '编辑背景', exact: true }).click()
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
    const photoSlider = popup.getByLabel('图片透明度', { exact: true })
    const layer = player.locator('.adaptive-shell > .player-background-layer')
    await expect(photoSlider).toHaveValue('52')
    for (const value of [0, 50, 100, 25]) {
      await photoSlider.fill(String(value))
      await expect(layer.locator('img')).toHaveCSS('opacity', String(1 - value / 100))
      await expect
        .poll(() => layer.evaluate((node) => getComputedStyle(node, '::after').opacity))
        .toBe('0.3')
    }
    await popup.getByLabel('背景模糊', { exact: true }).fill('6')
    const preview = popup.getByRole('group', { name: '背景位置预览', exact: true })
    const live = player.locator('.adaptive-shell > .player-background-layer img')
    await expect(live).toHaveCSS('opacity', '0.75')
    await expect(live).toHaveCSS('filter', 'blur(6px)')
    const crop = popup.getByRole('group', { name: '预览画幅' })
    for (const [name, frameWidth, frameHeight] of [
      ['竖屏', 321, 682],
      ['中窗 740', 740, 590],
      ['中窗 900', 900, 722],
      ['宽窗', 1159, 750],
    ] as const) {
      await crop.getByRole('button', { name, exact: true }).click()
      const rect = (await preview.boundingBox())!
      expect(rect.width / rect.height).toBeCloseTo(frameWidth / frameHeight, 1)
      const blur = await preview
        .locator('.player-background-layer img')
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).filter.slice('blur('.length)))
      expect(blur).toBeCloseTo((6 * (rect.width - 2)) / frameWidth, 1)
      await expect(popup.getByLabel('背景水平位置')).toHaveValue('50')
      await expect(popup.getByLabel('背景缩放')).toHaveValue('180')
    }
    await crop.getByRole('button', { name: '当前窗口' }).click()
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
      for (const group of [
        '.background-image-sources > *',
        '.background-editor-actions > button',
      ]) {
        const heights = await popup
          .locator(group)
          .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height))
        expect(Math.min(...heights)).toBeGreaterThanOrEqual(38)
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
      }
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
    expect(saved).toMatchObject({
      zoom: 180,
      opacity: 75,
      layoutTransparency: 70,
      componentTransparency: 40,
      blur: 6,
    })
    expect(saved.x).toBeLessThan(50)
    expect(saved.y).toBeLessThan(50)
    const [focusX, focusY] = await live.evaluate((el) =>
      getComputedStyle(el).objectPosition.split(' ').map(parseFloat),
    )
    expect(focusX).toBeCloseTo(saved.x, 2)
    expect(focusY).toBeCloseTo(saved.y, 2)
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
    await expect(player.locator('[data-panel="settings"]')).toBeVisible()
    await expect(player.locator('.adaptive-shell > .player-background-layer img')).toBeVisible()
    page = await openTool(app, player, 'settings')
    await settingsGroup(page, '外观')
    await page.getByRole('button', { name: '编辑背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await expect(popup.getByLabel('背景缩放', { exact: true })).toHaveValue('180')
    await expect(page.getByLabel('布局背景透明度', { exact: true })).toHaveValue('70')
    await expect(page.getByLabel('组件底色透明度', { exact: true })).toHaveValue('40')
    await expect(page.getByLabel('弹窗底色透明度', { exact: true })).toHaveValue('57')
    await expect(popup.getByLabel('图片透明度', { exact: true })).toHaveValue('25')
    await expect(popup.getByLabel('背景模糊', { exact: true })).toHaveValue('6')
    expect(
      (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground,
    ).toEqual(saved)
    await popup.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '编辑背景', exact: true }).click()
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
    await page.getByRole('button', { name: '编辑背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByRole('button', { name: '恢复默认背景', exact: true }).click()
    await popup.getByRole('button', { name: '保存背景', exact: true }).click()
    await expect(popup).toHaveCount(0)
    expect(
      (await player.evaluate(() => window.together.desktopInfo())).preferences.playerBackground,
    ).toEqual({
      ...DEFAULT_PLAYER_BACKGROUND,
      layoutTransparency: 70,
      componentTransparency: 40,
      popupTransparency: 57,
    })
    await expect(player.locator('.adaptive-shell > .player-background-layer')).toHaveCount(0)
    // Read the compositor output so an extra tint on a child cannot pass unnoticed.
    await widenPanel(app, player, 1159, 750)
    await page.getByLabel('布局背景透明度', { exact: true }).fill('100')
    await page.getByLabel('组件底色透明度', { exact: true }).fill('50')
    await page.getByRole('button', { name: '编辑背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByLabel('选择播放器背景图片').setInputFiles(file)
    await expect(popup.locator('.player-background-layer img')).toBeVisible()
    await popup.getByLabel('图片透明度', { exact: true }).fill('0')
    await popup.getByRole('button', { name: '保存背景', exact: true }).click()
    await expect(popup).toHaveCount(0)
    const win = await app.browserWindow(player)
    for (const route of ['library', 'search'] as const) {
      await openTool(app, player, route)
      await expect
        .poll(() =>
          win.evaluate(async (window) => {
            const frame = await window.webContents.capturePage()
            // Sample blank spaces in the title bar, navigation rail, body and transport bar.
            return [
              [375, 22],
              [120, 500],
              [480, 500],
              [350, 700],
            ].map(([x, y]) => {
              const [blue, green, red] = frame.crop({ x, y, width: 1, height: 1 }).toBitmap()
              return [red, green, blue]
            })
          }),
        )
        .toEqual([
          [229, 201, 92],
          [72, 136, 221],
          [72, 136, 221],
          [72, 136, 221],
        ])
    }
    await openTool(app, player, 'queue')
    const queue = player.locator('.surface-drawer[data-panel=queue]')
    const queueBounds = (await queue.boundingBox())!
    const samples = [
      {
        x: Math.floor(queueBounds.x + queueBounds.width / 2),
        y: Math.floor(queueBounds.y + queueBounds.height * 0.39),
      },
      {
        x: Math.floor(queueBounds.x + queueBounds.width / 2),
        y: Math.floor(queueBounds.y + queueBounds.height * 0.76),
      },
    ]
    const samplePixels = (points: { x: number; y: number }[]) =>
      win.evaluate(async (window, points) => {
        const frame = await window.webContents.capturePage()
        return points.map(({ x, y }) =>
          [...frame.crop({ x, y, width: 1, height: 1 }).toBitmap()].slice(0, 3).reverse(),
        )
      }, points)
    const alpha = (value: number) =>
      player.evaluate(async (popupTransparency) => {
        const { preferences } = await window.together.desktopInfo()
        await window.together.updatePreferences({
          playerBackground: { ...preferences.playerBackground, popupTransparency },
        })
      }, value)
    // Paint two distinct colors as actual page content behind the drawer. The scrim
    // stays visible during the reference capture, including at nonzero layout alpha.
    const markers = await player.addStyleTag({
      content: `.surface-page::after { content: ""; position: absolute; inset: 0;
        z-index: 3; background: linear-gradient(#00ff00 0 50%, #ff00ff 50%); }`,
    })
    await player.evaluate(async () => {
      const { preferences } = await window.together.desktopInfo()
      await window.together.updatePreferences({
        playerBackground: { ...preferences.playerBackground, layoutTransparency: 40 },
      })
    })
    for (const theme of ['dark', 'light'] as const) {
      await player.evaluate(async (theme) => {
        await window.together.updatePreferences({ theme })
      }, theme)
      await expect(player.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(player.locator('.adaptive-shell > .player-background-layer')).toHaveCount(1)
      await expect(queue).toHaveCSS('background-image', 'none')
      await queue.evaluate((el) => {
        el.style.visibility = 'hidden'
      })
      await expect
        .poll(async () => {
          const [upper, lower] = await samplePixels(samples)
          return upper[1] > 200 && upper[0] === 0 && lower[0] > 200 && lower[1] === 0
        })
        .toBe(true)
      const underlying = await samplePixels(samples)
      await queue.evaluate((el) => el.style.removeProperty('visibility'))
      const tint = await queue.evaluate((el) => {
        const ctx = document.createElement('canvas').getContext('2d')!
        ctx.fillStyle = getComputedStyle(el).getPropertyValue('--mp-surface-drawer').trim()
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
      })
      for (const transparency of [0, 50, 100]) {
        await alpha(transparency)
        const fill = 1 - transparency / 100
        await expect
          .poll(async () => {
            const pixels = await samplePixels(samples)
            return Math.max(
              ...pixels.flatMap((rgb, n) =>
                rgb.map((value, c) =>
                  Math.abs(value - (fill * tint[c] + (1 - fill) * underlying[n][c])),
                ),
              ),
            )
          })
          .toBeLessThanOrEqual(2)
      }
    }
    await markers.evaluate((el) => el.parentNode?.removeChild(el))
    // Compare the pane and bar on a continuous patch of wallpaper across their seam.
    await widenPanel(app, player, 385, 752)
    const footer = player.locator('.adaptive-player-bar')
    const clearAreas = await player.addStyleTag({
      content: `.surface-page > *, .surface-drawer > *, .adaptive-player-bar > *,
        .surface-immersive .immersive-body > * { visibility: hidden !important }`,
    })
    async function checkSeam() {
      const bounds = (await footer.boundingBox())!
      const seam = [
        { x: 140, y: Math.floor(bounds.y - 9) },
        { x: 140, y: Math.floor(bounds.y + 9) },
      ]
      for (const transparency of [0, 50, 100]) {
        await alpha(transparency)
        await expect
          .poll(() =>
            queue.evaluate((el) => {
              const color = getComputedStyle(el).backgroundColor
              return [
                Number(getComputedStyle(el).getPropertyValue('--skin-popup-alpha')),
                color ===
                  getComputedStyle(document.querySelector('.adaptive-player-bar')!).backgroundColor,
              ]
            }),
          )
          .toEqual([1 - transparency / 100, true])
        await expect
          .poll(async () => {
            const [above, below] = await samplePixels(seam)
            return Math.max(...above.map((v, i) => Math.abs(v - below[i])))
          })
          .toBeLessThanOrEqual(1)
      }
    }
    await checkSeam()
    await player.keyboard.press('Escape')
    await expect(queue).toBeHidden()
    await expect(footer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await clearAreas.evaluate((el) => el.parentNode?.removeChild(el))
    await footer.getByRole('button', { name: '展开正在播放', exact: true }).click()
    await footer.getByRole('button', { name: '播放队列', exact: true }).click()
    const immersiveClear = await player.addStyleTag({
      content: `.surface-drawer > *, .adaptive-player-bar > *, .immersive-body > * {visibility:hidden !important}`,
    })
    await checkSeam()
    await player.evaluate(async () => {
      const { preferences } = await window.together.desktopInfo()
      await window.together.updatePreferences({
        playerBackground: { ...preferences.playerBackground, image: null },
      })
    })
    await expect(player.locator('.adaptive-shell > .player-background-layer')).toHaveCount(0)
    await checkSeam()
    await immersiveClear.evaluate((el) => el.parentNode?.removeChild(el))
    await widenPanel(app, player, 740, 590)
    await expect(footer).not.toHaveCSS(
      'background-color',
      await queue.evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

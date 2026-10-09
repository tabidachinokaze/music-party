import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('application background previews drafts, covers every page, and survives restart', async () => {
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
    let page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    let popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    const fixture = await page.evaluate(() => {
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
    const codecs = await page.evaluate(() => {
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
          (await page.evaluate(() => window.together.desktopInfo())).preferences.playerBackground
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
      (await page.evaluate(() => window.together.desktopInfo())).preferences.playerBackground.image,
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
    const bounds = (await preview.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2 + 25, {
      steps: 5,
    })
    await page.mouse.up()
    const coordinates = await popup.getByLabel('背景水平位置', { exact: true }).inputValue()
    const vertical = await popup.getByLabel('背景垂直位置', { exact: true }).inputValue()
    expect(Number(coordinates)).toBeLessThan(50)
    expect(Number(vertical)).toBeLessThan(50)
    await page.screenshot({
      path: 'test-results/music-party-background-editor.png',
      animations: 'disabled',
    })
    expect(
      (await page.evaluate(() => window.together.desktopInfo())).preferences.playerBackground.image,
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
      (await page.evaluate(() => window.together.desktopInfo())).preferences.playerBackground.image,
    ).toBeNull()
    await rm(settingsFile, { recursive: true })
    await rename(backup, settingsFile)
    await popup.getByRole('button', { name: '保存背景', exact: true }).click()
    await expect(popup).toHaveCount(0)
    const saved = (await page.evaluate(() => window.together.desktopInfo())).preferences
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
    const layer = page.locator('.app-shell > .player-background-layer')
    const layerHandle = await layer.elementHandle()
    const assertGlobalLayer = async () => {
      await expect(layer).toHaveCount(1)
      await expect(layer).toBeVisible()
      await expect(page.locator('.app-shell')).toHaveClass(/has-custom-background/)
      await expect(layer.locator('img')).toHaveAttribute('src', saved.image!)
      expect(
        await layerHandle!.evaluate(
          (node) => node === document.querySelector('.app-shell > .player-background-layer'),
        ),
      ).toBe(true)
    }
    await page.getByRole('button', { name: '浅色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await assertGlobalLayer()
    await expect(layer.locator('img')).toHaveAttribute('src', saved.image!)
    expect(await layer.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none')
    expect(await layer.locator('img').evaluate((node) => getComputedStyle(node).opacity)).toBe(
      '0.75',
    )
    expect(await layer.locator('img').evaluate((node) => getComputedStyle(node).filter)).toBe(
      'blur(6px)',
    )
    for (const selector of ['.sidebar', '.music-header', '.player']) {
      const surface = await page.locator(selector).evaluate((node) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!
        context.fillStyle = getComputedStyle(node).backgroundColor
        context.fillRect(0, 0, 1, 1)
        return {
          alpha: context.getImageData(0, 0, 1, 1).data[3],
          opacity: getComputedStyle(node).opacity,
        }
      })
      expect(
        surface.alpha,
        `${selector} lets the application background show through`,
      ).toBeLessThan(255)
      expect(surface.opacity, `${selector} keeps its controls opaque`).toBe('1')
    }
    await page.locator('.sidebar').getByRole('button', { name: '我的歌单', exact: true }).click()
    await expect(page.getByText('登录后查看你的音乐库', { exact: true })).toBeVisible()
    await assertGlobalLayer()
    await page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true }).click()
    await page.locator('.music-header').getByLabel('搜索音乐库').fill('背景控件测试')
    await page.locator('.music-header').getByLabel('搜索音乐库').press('Enter')
    await expect(page.getByText('没有找到匹配内容', { exact: true })).toBeVisible()
    await assertGlobalLayer()
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.music-header')).toBeVisible()
    await expect(page.getByLabel('底部播放栏', { exact: true })).toBeVisible()
    await expect(page.locator('.app-shell')).not.toHaveClass(/player-expanded/)
    await page.screenshot({
      path: 'test-results/music-party-background-light.png',
      animations: 'disabled',
    })
    await page.locator('.sidebar').getByRole('button', { name: '私信', exact: true }).click()
    await expect(page.getByText('登录后查看网易云私信', { exact: true })).toBeVisible()
    await assertGlobalLayer()
    await page.locator('.sidebar').getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '外观', exact: true })).toBeVisible()
    await assertGlobalLayer()
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1000, height: 720 }),
    )
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1000)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const extent = await layer.evaluate((node) => {
      const bounds = node.getBoundingClientRect()
      return {
        left: bounds.left,
        right: bounds.right,
        width: bounds.width,
        top: bounds.top,
        bottom: bounds.bottom,
      }
    })
    expect(extent).toEqual({
      left: 0,
      right: 1000,
      width: 1000,
      top: 0,
      bottom: await page.evaluate(() => innerHeight),
    })
    await page.getByRole('button', { name: '深色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await assertGlobalLayer()
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.music-header')).toBeVisible()
    await expect(page.getByLabel('底部播放栏', { exact: true })).toBeVisible()
    await expect(page.locator('.app-shell')).not.toHaveClass(/player-expanded/)
    await page.screenshot({
      path: 'test-results/music-party-background-dark.png',
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '打开播放界面', exact: true }).click()
    await expect(page.locator('.app-shell')).toHaveClass(/player-expanded/)
    await assertGlobalLayer()
    await expect(page.getByRole('button', { name: '一起听', exact: true })).toBeEnabled()
    await page.screenshot({
      path: 'test-results/music-party-background-expanded.png',
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '收起播放界面', exact: true }).click()
    await assertGlobalLayer()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.locator('.app-shell > .player-background-layer')).toBeVisible()
    await expect(page.locator('.app-shell')).not.toHaveClass(/player-expanded/)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await expect(popup.getByLabel('背景缩放', { exact: true })).toHaveValue('180')
    await expect(popup.getByLabel('背景透明度', { exact: true })).toHaveValue('25')
    await expect(popup.getByLabel('背景模糊', { exact: true })).toHaveValue('6')
    expect(
      (await page.evaluate(() => window.together.desktopInfo())).preferences.playerBackground,
    ).toEqual(saved)
    await popup.getByRole('button', { name: '取消', exact: true }).click()
    const assertReadable = async (selectors: string[], source: string, opacity: number) => {
      for (const selector of selectors) {
        const text = page.locator(selector).first()
        await expect(text).toBeVisible()
        const colors = await text.evaluate(
          async (node, { source, opacity }) => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const context = canvas.getContext('2d')!
            const paint = (color: string) => {
              context.fillStyle = color
              context.fillRect(0, 0, 1, 1)
            }
            const shell = document.querySelector('.app-shell')!
            const backgroundLayer = shell.querySelector(':scope > .player-background-layer')!
            const ancestors: Element[] = [backgroundLayer]
            for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement)
              ancestors.push(ancestor)
            // Navigation and theme changes keep their real transitions enabled.
            // Wait only for finite animations that affect these painted surfaces;
            // an unrelated looping equalizer must not hold up the measurement.
            for (const ancestor of ancestors) getComputedStyle(ancestor).backgroundColor
            const animations = new Set(ancestors.flatMap((ancestor) => ancestor.getAnimations()))
            await Promise.all(
              [...animations]
                .filter(
                  (animation) =>
                    animation.playState === 'running' &&
                    Number.isFinite(animation.effect?.getComputedTiming().endTime),
                )
                .map((animation) => animation.finished.catch(() => {})),
            )
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            paint(getComputedStyle(backgroundLayer).backgroundColor)
            if (opacity) paint(source)
            paint(getComputedStyle(backgroundLayer, '::after').backgroundColor)
            // The image is below the entire application. Composite every actual
            // surface between it and this text, rather than assuming a page backdrop.
            const surfaces: Element[] = []
            for (let surface: Element | null = node; surface && surface !== shell;) {
              surfaces.unshift(surface)
              surface = surface.parentElement
            }
            for (const surface of surfaces) paint(getComputedStyle(surface).backgroundColor)
            const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
            paint(getComputedStyle(node).color)
            const foreground = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
            const luminance = (rgb: number[]) =>
              rgb
                .map((value) => {
                  const channel = value / 255
                  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
                })
                .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
            const first = luminance(background),
              second = luminance(foreground)
            return {
              contrast: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
              background,
              foreground: getComputedStyle(node).color,
              surfaces: surfaces.map((surface) => getComputedStyle(surface).backgroundColor),
            }
          },
          { source, opacity },
        )
        expect(
          colors.contrast,
          `${selector} with ${source} at opacity ${opacity}: ${JSON.stringify(colors)}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
    const chromeText = [
      '.music-header .page-title',
      '.sidebar .account small',
      '.sidebar .nav:not(.active)',
      '.sidebar .nav-caption',
      '.player .now-playing small',
    ]
    // A white image in dark mode and a black image in light mode are the contrast extremes.
    for (const [theme, source] of [
      ['dark', '#ffffff'],
      ['light', '#000000'],
    ] as const) {
      const image = await page.evaluate(async (fill) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 20
        const context = canvas.getContext('2d')!
        context.fillStyle = fill
        context.fillRect(0, 0, 20, 20)
        const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (letter) =>
          letter.charCodeAt(0),
        )
        return (await window.together.preparePlayerBackground(bytes)).image
      }, source)
      for (const opacity of [100, 0]) {
        await page.evaluate(
          ({ theme, image, opacity }) =>
            window.together.updatePreferences({
              theme,
              playerBackground: { image, zoom: 100, opacity, blur: 0, x: 50, y: 50 },
            }),
          { theme, image, opacity },
        )
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const imageNode = page.locator('.app-shell > .player-background-layer img')
        await expect
          .poll(() => imageNode.evaluate((node) => getComputedStyle(node).opacity))
          .toBe(String(opacity / 100))
        for (const [name, selectors] of [
          ['我的歌单', ['.browser-page .empty strong', '.browser-page .empty span']],
          ['搜索', ['.music-browser .empty strong']],
          ['私信', ['.private-main .empty strong', '.private-main .empty span']],
          ['设置', ['.settings-group > p', '.settings-row small']],
        ] as const) {
          await page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
          await expect(imageNode).toBeVisible()
          await expect(page.locator('.app-shell > .player-background-layer')).toHaveCount(1)
          await assertReadable([...chromeText, ...selectors], source, opacity)
        }
        await page.getByRole('button', { name: '打开播放界面', exact: true }).click()
        await expect
          .poll(() =>
            page.locator('.listening-view').evaluate((node) => getComputedStyle(node).opacity),
          )
          .toBe('1')
        await assertReadable(['.lyric-placeholder p'], source, opacity)
        await expect(page.locator('.app-shell > .player-background-layer')).toHaveCount(1)
        await page.getByRole('button', { name: '收起播放界面', exact: true }).click()
      }
    }
    await page.evaluate(
      (playerBackground) => window.together.updatePreferences({ theme: 'dark', playerBackground }),
      saved,
    )
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByRole('button', { name: '重置位置', exact: true }).click()
    await expect(popup.getByLabel('背景水平位置', { exact: true })).toHaveValue('50')
    await expect(popup.getByLabel('背景垂直位置', { exact: true })).toHaveValue('50')
    await popup.getByRole('button', { name: '恢复默认背景', exact: true }).click()
    await expect(popup.locator('.player-background-layer')).toHaveCount(0)
    await popup.getByRole('button', { name: '取消', exact: true }).click()
    expect(
      (await page.evaluate(() => window.together.desktopInfo())).preferences.playerBackground,
    ).toEqual(saved)
    await page.getByRole('button', { name: '自定义播放器背景', exact: true }).click()
    popup = page.getByRole('dialog', { name: '自定义播放器背景', exact: true })
    await popup.getByRole('button', { name: '恢复默认背景', exact: true }).click()
    await popup.getByRole('button', { name: '保存背景', exact: true }).click()
    await expect(popup).toHaveCount(0)
    expect(
      (await page.evaluate(() => window.together.desktopInfo())).preferences.playerBackground,
    ).toEqual({ image: null, zoom: 100, opacity: 35, blur: 0, x: 50, y: 50 })
    await page.getByRole('button', { name: '返回播放界面', exact: true }).click()
    await expect(page.locator('.app-shell > .player-background-layer')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

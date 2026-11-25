import { expect, test, _electron as electron } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { createChineseProfile, openTool, widenPanel } from './windows'

test('button hover uses one native hint on disabled, icon and changing controls', async () => {
  const profile = await createChineseProfile('music-party-button-hints-')
  const app = await electron.launch({
    args: ['.', `--ozone-platform=${process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'}`],
    env: {
      ...process.env,
      MUSIC_PARTY_PROFILE: profile,
      MUSIC_PARTY_API_URL: 'http://127.0.0.1:9',
      ELECTRON_RENDERER_URL: '',
    },
  })
  try {
    const page = await app.firstWindow()
    const queue = await openTool(app, page, 'queue')
    const clear = queue.locator('.queue-toolbar .text-btn')
    for (const width of [360, 760, 1160]) {
      await widenPanel(app, page, width, 640)
      await expect(clear).toBeDisabled()
      const before = await clear.boundingBox()
      await clear.locator('svg').hover()
      await expect(clear).toHaveAttribute('title', '清空队列')
      expect(await clear.boundingBox()).toEqual(before)
    }

    // Exercise a rerender while the pointer stays on the same DOM button.
    await clear.evaluate((el) => el.setAttribute('aria-label', '清空房间队列'))
    await expect(clear).toHaveAttribute('title', '清空房间队列')
    await clear.evaluate((el) => el.setAttribute('title', '队列为空'))
    await expect(clear).toHaveAttribute('title', '队列为空')
    await page.locator('.queue-empty').hover()
    await clear.hover()
    await expect(clear).toHaveAttribute('title', '队列为空')
    await clear.evaluate((el) => el.removeAttribute('title'))
    await expect(clear).toHaveAttribute('title', '清空房间队列')

    const search = await openTool(app, page, 'search')
    await page.getByRole('searchbox').fill('r-906')
    const reset = page.getByRole('button', { name: '清空搜索', exact: true })
    await reset.locator('svg').hover()
    await expect(reset).toHaveAttribute('title', '清空搜索')
    await reset.click()
    await expect(reset).toHaveCount(0)
    await expect(search).toBeVisible()
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})

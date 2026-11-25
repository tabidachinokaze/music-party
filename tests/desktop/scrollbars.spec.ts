import { test, expect, _electron as electron } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { createChineseProfile, openTool, widenPanel } from './windows'

test('list overflow keeps its width and the native scroll target, including with classic scrollbars', async () => {
  const profile = await createChineseProfile('music-party-scrollbars-')
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
    await openTool(app, page, 'queue')
    const list = page.locator('.queue-drawer-list')
    const marker = list.locator('.queue-empty')
    // A sized CSS scrollbar exercises Chromium's classic-gutter branch on any desktop.
    const classic = await page.addStyleTag({
      content: `
      :is(.scrollbar-probe, [data-list-viewport])::-webkit-scrollbar { width: 15px }
    `,
    })
    await expect(list).toHaveAttribute('data-overlayscrollbars', '')
    for (const width of [360, 760, 1160]) {
      await widenPanel(app, page, width, 640)
      const before = await marker.boundingBox()
      expect(before).not.toBeNull()
      await list.evaluate((el) => {
        const filler = document.createElement('div')
        filler.className = 'test-scroll-content'
        filler.style.height = `${el.clientHeight * 2}px`
        el.append(filler)
      })
      const handle = list.locator(
        ':scope > .os-scrollbar-vertical.os-scrollbar-visible .os-scrollbar-handle',
      )
      await expect(handle).toBeVisible()
      expect(await marker.boundingBox()).toEqual(before)
      const bar = (await handle.boundingBox())!
      const x = bar.x + bar.width / 2
      const y = bar.y + bar.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x, y + 40, { steps: 6 })
      await page.mouse.up()
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(20)
      await list.locator('.test-scroll-content').evaluate((el) => el.remove())
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0)
      const after = await marker.boundingBox()
      expect(after).toEqual(before)
    }

    await list.evaluate((el) => {
      const panel = document.createElement('div')
      panel.dataset.listViewport = ''
      panel.style.overflow = 'auto'
      const inner = document.createElement('div')
      inner.dataset.listViewport = ''
      inner.className = 'test-nested-list'
      inner.style.cssText = 'height: 80px; overflow: auto'
      inner.tabIndex = 0
      const spacer = document.createElement('div')
      spacer.style.height = '300px'
      const last = document.createElement('button')
      last.textContent = '行尾操作'
      last.onclick = () => {
        last.textContent = '已点击'
      }
      inner.append(spacer, last)
      panel.append(inner)
      el.prepend(panel)
      inner.scrollTop = 24
    })
    const inner = list.locator('.test-nested-list')
    await expect(inner).toHaveAttribute('data-overlayscrollbars', '')
    expect(await inner.evaluate((el) => el.scrollTop)).toBe(24)
    await inner.hover()
    await page.mouse.wheel(0, 50)
    await expect.poll(() => inner.evaluate((el) => el.scrollTop)).toBeGreaterThan(24)
    await inner.focus()
    await page.keyboard.press('End')
    const last = inner.getByRole('button', { name: '行尾操作' })
    await expect(last).toBeInViewport({ ratio: 1 })
    await last.click()
    await expect(inner.getByRole('button', { name: '已点击' })).toBeVisible()
    await classic.evaluate((style) => style.parentNode?.removeChild(style))
    await expect
      .poll(() => inner.evaluate((el) => el.getBoundingClientRect().width - el.clientWidth))
      .toBeCloseTo(0, 0)
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})

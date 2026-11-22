import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { PanelId } from '../../src/shared/panels'
// Domain surfaces share one document. Composer popovers and image previews portal to its body.
function surface(player: Page, id: PanelId) {
  return player.locator(
    `[data-panel="${id}"], body > .modal-backdrop, body > .sticker-context-menu`,
  )
}

export async function panelPage(app: ElectronApplication, id: PanelId) {
  const player = await app.firstWindow()
  await expect(player.locator(`[data-panel="${id}"]`)).toBeVisible()
  return surface(player, id)
}
export async function openTool(
  app: ElectronApplication,
  player: Page,
  id:
    | 'lyrics'
    | 'controls'
    | 'search'
    | 'library'
    | 'room'
    | 'queue'
    | 'chat'
    | 'private'
    | 'settings'
    | 'login',
) {
  const names = {
    lyrics: '歌词',
    controls: '播放调节',
    search: '搜索',
    library: '音乐库',
    room: '一起听',
    queue: '播放队列',
    chat: '房间聊天',
    private: '私信',
    settings: '设置',
    login: '扫码登录',
  }
  await expect(player.locator('.adaptive-shell')).toBeVisible()
  const target = player.locator(`[data-panel="${id}"]:not([inert])`)
  const directory = player.getByRole('button', { name: /^(全部功能|打开内容)$/ }).first()
  const catalog = player.locator('[data-panel="windows"]')
  for (let depth = 0; depth < 8; depth++) {
    if (await catalog.isVisible()) break
    if (
      (await target.isVisible()) &&
      (await player.locator('[aria-modal="true"]:visible').count()) === 0
    )
      return surface(player, id)
    if (await directory.isVisible()) {
      try {
        await directory.click({ trial: true, timeout: 300 })
        await directory.click()
        break
      } catch {
        // A modal or drawer is covering the persistent directory control.
      }
    }
    await player.keyboard.press('Escape')
  }
  await expect(catalog).toBeVisible()
  await catalog.getByRole('button', { name: names[id], exact: true }).click()
  return panelPage(app, id)
}

export async function loginFixture(app: ElectronApplication, player: Page) {
  await openTool(app, player, 'login')
  await expect(player.locator('[data-panel="login"]')).toBeHidden()
}
export async function widenPanel(
  app: ElectronApplication,
  target: Locator | Page,
  width = 760,
  height = 610,
) {
  const page = 'page' in target ? target.page() : target
  const win = await app.browserWindow(page)
  await win.evaluate((w, size) => w.setContentSize(size.width, size.height), { width, height })
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
  await expect(page.locator('.adaptive-shell')).toHaveAttribute(
    'data-layout',
    width >= 960 ? 'wide' : width >= 560 ? 'medium' : 'compact',
  )
}

// Serve deterministic artwork to both <img> elements and background images.
export async function serveArtwork(app: ElectronApplication, bytes: Buffer, contentType: string) {
  await app.evaluate(
    ({ session, net }, data) => {
      session.defaultSession.protocol.handle('https', (request) => {
        if (new URL(request.url).hostname === 'p1.music.126.net')
          return new Response(new Uint8Array(data.bytes), {
            headers: { 'content-type': data.contentType },
          })
        return net.fetch(request, { bypassCustomProtocolHandlers: true })
      })
    },
    { bytes: Array.from(bytes), contentType },
  )
}

export async function showPrivateList(panel: Locator) {
  const back = panel.getByRole('button', { name: '返回私信列表', exact: true })
  if (await back.isVisible()) await back.click()
}

export async function settingsGroup(
  page: Locator,
  title: '外观' | '播放与桌面' | '账号' | '更新与帮助',
) {
  const nav = page.getByRole('navigation', { name: '设置分类' })
  if (!(await nav.isVisible()))
    await page.getByRole('button', { name: '设置分类', exact: true }).click()
  await nav.getByRole('button', { name: title, exact: true }).click()
}

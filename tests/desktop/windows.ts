import { expect, type ElectronApplication, type Page } from '@playwright/test'
import type { PanelId } from '../../src/shared/panels'
export async function panelPage(app: ElectronApplication, id: PanelId) {
  let result: Page | undefined
  await expect
    .poll(async () => {
      for (const p of app.windows()) {
        if (p.isClosed()) continue
        if (await p.locator('.desktop-panel[data-panel="' + id + '"]').count()) {
          result = p
          return true
        }
      }
      return false
    })
    .toBe(true)
  return result!
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
  if (id === 'controls') await player.getByRole('button', { name: names[id], exact: true }).click()
  else {
    await player.getByRole('button', { name: '外挂窗口', exact: true }).click()
    const nav = await panelPage(app, 'windows')
    await nav.getByRole('button', { name: names[id], exact: true }).click()
  }
  return panelPage(app, id)
}

export async function loginFixture(app: ElectronApplication, player: Page) {
  const login = await openTool(app, player, 'login')
  const win = await app.browserWindow(login)
  await expect.poll(() => win.evaluate((w) => w.isVisible())).toBe(false)
}
export async function widenPanel(app: ElectronApplication, page: Page, width = 760, height = 610) {
  const win = await app.browserWindow(page)
  await win.evaluate((w, size) => w.setContentSize(size.width, size.height), { width, height })
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
}

// An about:blank satellite shares its opener's renderer. Stub the Electron session so
// artwork requests from either document are served by the same deterministic fixture.
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

export async function settingsGroup(
  page: Page,
  title: '外观' | '播放与桌面' | '账号' | '更新与帮助',
) {
  const nav = page.getByRole('navigation', { name: '设置分类' })
  if (!(await nav.isVisible()))
    await page.getByRole('button', { name: '设置分类', exact: true }).click()
  await nav.getByRole('button', { name: title, exact: true }).click()
}

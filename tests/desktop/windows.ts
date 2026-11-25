import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PanelId } from '../../src/shared/panels'

// These workflows assert Chinese UI labels regardless of the host's preferred languages.
export async function createChineseProfile(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(
    join(path, 'settings.json'),
    JSON.stringify({ preferences: { language: 'zh-CN' } }),
  )
  return path
}

export function serveSeekableWav(req: IncomingMessage, res: ServerResponse, pcm: Buffer) {
  res.setHeader('Content-Type', 'audio/wav')
  res.setHeader('Accept-Ranges', 'bytes')
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
  const start = range ? Number(range[1]) : 0
  const end = range?.[2] ? Math.min(Number(range[2]), pcm.length - 1) : pcm.length - 1
  if (start > end) {
    res.writeHead(416, { 'Content-Range': `bytes */${pcm.length}` })
    res.end()
    return
  }
  if (range) {
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${pcm.length}`)
  }
  res.setHeader('Content-Length', end - start + 1)
  res.end(pcm.subarray(start, end + 1))
}

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

export async function expectRoomHeaderSingleLine(panel: Locator) {
  const header = panel.locator('.panel-titlebar')
  await expect(header.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(header.getByRole('button', { name: /刷新|同步/ })).toHaveCount(0)
  await expect(header).not.toContainText(/人一起听|人正在一起听|首待播/)
  const geometry = await header.evaluate((bar) => {
    const bounds = bar.getBoundingClientRect()
    const centers = Array.from(bar.querySelectorAll('h1, button'), (item) =>
      item.getBoundingClientRect(),
    ).filter((rect) => rect.height > 0)
    return {
      height: bounds.height,
      offsets: centers.map((rect) =>
        Math.abs(rect.y + rect.height / 2 - bounds.y - bounds.height / 2),
      ),
    }
  })
  expect(geometry.height).toBeLessThanOrEqual(49)
  for (const offset of geometry.offsets) expect(offset).toBeLessThanOrEqual(2)
}

export async function expectQueueHeaderFits(queue: Locator) {
  const spans = await queue
    .locator('.panel-titlebar h1, .panel-titlebar .queue-total, .room-queue-order :is(span, small)')
    .evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const text = document.createRange()
        text.selectNodeContents(node)
        const visible = node.getBoundingClientRect()
        return Array.from(text.getClientRects(), (ink) => {
          const rightmost = document.elementFromPoint(ink.right - 1, (ink.y + ink.bottom) / 2)
          return {
            label: node.textContent,
            clipped: ink.right > visible.right + 1 || ink.left < visible.left - 1,
            covering: node.contains(rightmost) ? null : rightmost?.tagName || 'outside viewport',
          }
        })
      }),
    )
  expect(spans.length).toBeGreaterThanOrEqual(2)
  for (const span of spans) {
    expect(span.clipped, span.label || '').toBe(false)
    expect(span.covering, span.label || '').toBeNull()
  }
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
    const modal = player.locator('body > .modal-backdrop').last()
    if (await modal.isVisible()) {
      const count = await player.locator('body > .modal-backdrop').count()
      await player.keyboard.press('Escape')
      await expect(player.locator('body > .modal-backdrop')).toHaveCount(count - 1)
      continue
    }
    if (await target.isVisible()) return surface(player, id)
    if (await catalog.isVisible()) break
    const floating = player.locator('.surface-dialog, .surface-drawer:not([inert])').last()
    if (await floating.isVisible()) {
      await player.keyboard.press('Escape')
      continue
    }
    const direct = player
      .locator('.main-sidebar, .adaptive-player-bar, .mp-chrome-actions')
      .getByRole('button', { name: id === 'login' ? '登录账号' : names[id], exact: true })
      .first()
    if (await direct.isVisible()) {
      await direct.click()
      return panelPage(app, id)
    }
    if (await directory.isVisible()) {
      await directory.click()
      break
    }
    const collapse = player.getByRole('button', { name: '返回浏览', exact: true })
    if (await collapse.isVisible()) {
      await collapse.click()
      continue
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
  const scale = await win.evaluate((w) => w.webContents.getZoomFactor())
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => innerWidth)) - width / scale))
    .toBeLessThan(1)
  await expect(page.locator('.adaptive-shell')).toHaveAttribute(
    'data-layout',
    width / scale >= 1040 ? 'wide' : width / scale >= 520 ? 'medium' : 'compact',
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

export async function mouseSide(page: Page, button: 'back' | 'forward', x: number, y: number) {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button,
      buttons: button === 'back' ? 8 : 16,
      x,
      y,
      clickCount: 1,
    })
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button,
      buttons: 0,
      x,
      y,
      clickCount: 1,
    })
  } finally {
    await session.detach()
  }
}

export async function showPrivateList(panel: Locator) {
  if (await panel.locator('.conversation-pane').isVisible()) return
  await panel
    .getByRole('navigation', { name: '页面导航' })
    .getByRole('button', { name: '私信', exact: true })
    .click()
}

export async function settingsGroup(
  page: Locator,
  title: '外观' | '播放与桌面' | '账号' | '更新与帮助',
) {
  const nav = page.getByRole('navigation', { name: '设置分类' })
  if (!(await nav.isVisible()))
    await page
      .getByRole('navigation', { name: '页面导航' })
      .getByRole('button', { name: '设置', exact: true })
      .click()
  await nav.getByRole('button', { name: title, exact: true }).click()
}

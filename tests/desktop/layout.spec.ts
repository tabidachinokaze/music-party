import {
  expectRoomHeaderSingleLine,
  settingsGroup,
  openTool,
  panelPage,
  loginFixture,
  widenPanel,
} from './windows'
import { test, expect, _electron as electron, type Locator } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('application pages keep their controls and content inside small windows at larger font sizes', async () => {
  test.setTimeout(90000)
  const self = { userId: 123, nickname: '布局测试账户' }
  const peer = { userId: 456, nickname: '布局好友 · 喜欢分享长歌曲名的听友' }
  const songs = [111, 112, 113].map((id) => ({
    id,
    name: `布局歌曲${id} · 这是一首名称很长的歌曲和现场特别演出版本`,
    ar: [{ name: '布局歌手 · 完整艺术家名称' }],
    al: {
      name: '布局专辑 · 完整专辑名称',
      picUrl:
        id === 111
          ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
          : '',
    },
    dt: 180000,
  }))
  const playlistName = '晚间歌单 · 长标题也能保留歌曲操作按钮'
  const albumName = '收藏专辑 · 长标题的特别演出版本'
  const message = {
    id: 1,
    fromUser: peer,
    toUser: self,
    time: Date.now() - 10000,
    msg: JSON.stringify({
      type: 1,
      msg: '私信布局检查：长消息自动换行，输入框和工具保持在面板内部。',
    }),
  }
  const playback = {
    playSong: { songId: 111, songBizId: '1000111', songRcmdUid: 123 },
    nextSongs: [],
    version: 1,
    playedTime: 5000,
    songDuration: 180000,
    waitSongCount: 0,
  }
  const snapshot = {
    roomId: 'layout-room',
    roomPlaySongInfo: playback,
    multiRoomInfoDTO: { roomBizType: 2, chatRoomId: '8877' },
    multiLtRoomUserAgg: {
      onlineNums: 2,
      onlineUserInfos: [self, peer].map((user) => ({ uid: user.userId, nickname: user.nickname })),
    },
  }
  const pcm = Buffer.alloc(44 + 8000 * 2 * 60)
  pcm.write('RIFF')
  pcm.writeUInt32LE(pcm.length - 8, 4)
  pcm.write('WAVEfmt ', 8)
  pcm.writeUInt32LE(16, 16)
  pcm.writeUInt16LE(1, 20)
  pcm.writeUInt16LE(1, 22)
  pcm.writeUInt32LE(8000, 24)
  pcm.writeUInt32LE(16000, 28)
  pcm.writeUInt16LE(2, 32)
  pcm.writeUInt16LE(16, 34)
  pcm.write('data', 36)
  pcm.writeUInt32LE(pcm.length - 44, 40)
  let port = 0
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname
    if (path === '/audio.wav') {
      response.setHeader('Content-Type', 'audio/wav')
      response.setHeader('Content-Length', pcm.length)
      response.end(pcm)
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const args = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const route = path === '/api' ? args.uri : path
    let body: any = { code: 200 }
    switch (route) {
      case '/login/status':
        body = {
          data: {
            code: 200,
            profile: String(args.cookie).includes('layout-fixture') ? self : null,
          },
        }
        break
      case '/login/qr/key':
        body = { code: 200, data: { unikey: 'layout-key' } }
        break
      case '/login/qr/create':
        body = {
          code: 200,
          data: {
            qrimg: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          },
        }
        break
      case '/login/qr/check':
        body = { code: 803, cookie: 'MUSIC_U=layout-fixture; Path=/;' }
        break
      case '/register/checktoken/v3':
        body = { code: 200, token: 'layout-token' }
        break
      case '/user/playlist':
        body = {
          code: 200,
          more: false,
          playlist: [
            { id: 10, name: '喜欢的音乐', specialType: 5, trackCount: 3, creator: self },
            { id: 20, name: playlistName, trackCount: 3, creator: self },
          ],
        }
        break
      case '/album/sublist':
        body = {
          code: 200,
          hasMore: false,
          data: [{ id: 50, name: albumName, size: 3, artists: [{ name: '布局歌手' }] }],
        }
        break
      case '/likelist':
        body = { code: 200, ids: [111] }
        break
      case '/playlist/detail':
        body = { code: 200, playlist: { id: args.id, trackIds: songs.map(({ id }) => ({ id })) } }
        break
      case '/album':
        body = { code: 200, album: { id: 50, name: albumName }, songs }
        break
      case '/cloudsearch':
        body = { code: 200, result: { songs, songCount: songs.length } }
        break
      case '/song/detail':
        body = {
          code: 200,
          songs: songs.filter((song) => String(args.ids).split(',').includes(String(song.id))),
        }
        break
      case '/song/url/v1':
        body = { code: 200, data: [{ id: args.id, url: `http://127.0.0.1:${port}/audio.wav` }] }
        break
      case '/lyric':
        body = {
          code: 200,
          tlyric: {
            lyric:
              '[00:05.00]A long translated line that must wrap without clipping at larger font sizes.',
          },
          lrc: {
            lyric:
              '[00:00.00]第一句歌词用于布局检查\n[00:05.00]当前歌词在大小窗口都能完整显示\n[00:30.00]第三句歌词',
          },
        }
        break
      case '/api/listen/together/multi/match/status/get':
        body = { code: 200, data: { status: 'IN_ROOM', multiLtRoomSnapshot: snapshot } }
        break
      case '/api/listen/together/multi/match/heartbeat':
        body = { code: 200, data: { heartBeatDuration: 30, roomPlaySongInfo: playback } }
        break
      case '/api/listen/together/multi/played/song/info':
        body = { code: 200, data: { liked: false, songInfo: { zanCnt: 0 } } }
        break
      case '/msg/private':
        body = {
          code: 200,
          more: false,
          msgs: [
            {
              fromUser: peer,
              toUser: self,
              lastMsg: message.msg,
              lastMsgTime: message.time,
              newMsgCount: 0,
            },
          ],
        }
        break
      case '/msg/private/history':
        body = { code: 200, more: false, msgs: [message] }
        break
      case '/user/follows':
        body = { code: 200, more: false, follow: [peer] }
        break
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as any).port
  const profile = await mkdtemp(join(tmpdir(), 'music-party-layout-'))
  const app = await electron.launch({
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
  try {
    const player = await app.firstWindow()
    let page = player.locator('body')
    const errors: string[] = []
    player.on('pageerror', (error) => errors.push(error.message))
    await player.locator('audio').evaluate((node: HTMLAudioElement) => (node.muted = true))
    await loginFixture(app, player)
    page = await openTool(app, player, 'room')
    await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText(songs[0].name)
    await player.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 240
      const context = canvas.getContext('2d')!
      const gradient = context.createLinearGradient(0, 0, 400, 240)
      gradient.addColorStop(0, '#b88643')
      gradient.addColorStop(1, '#544aa0')
      context.fillStyle = gradient
      context.fillRect(0, 0, 400, 240)
      const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (x) =>
        x.charCodeAt(0),
      )
      const { image } = await window.together.preparePlayerBackground(bytes)
      await window.together.updatePreferences({
        playerBackground: {
          image,
          zoom: 100,
          opacity: 100,
          layoutTransparency: 100,
          componentTransparency: 50,
          popupTransparency: 12,
          blur: 0,
          x: 50,
          y: 50,
        },
      })
    })
    const insideWindow = async (locator: Locator) => {
      await expect(locator).toBeVisible()
      // Pages may scroll vertically at larger font sizes. Their controls must
      // remain reachable without requiring any horizontal window scrolling.
      await locator.scrollIntoViewIfNeeded()
      // IntersectionObserver can report a fractional-pixel clip after scrolling.
      // Keep a proportion check, then bound actual clipping on every edge below.
      await expect(locator).toBeInViewport({ ratio: 0.99 })
      const box = (await locator.boundingBox())!
      const viewport = await locator.evaluate((node) => ({
        width: node.ownerDocument.defaultView!.innerWidth,
        height: node.ownerDocument.defaultView!.innerHeight,
      }))
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      expect(box.x).toBeGreaterThanOrEqual(-1)
      expect(box.y).toBeGreaterThanOrEqual(-1)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
      const clipped = await locator.evaluate((node) => {
        const box = node.getBoundingClientRect()
        let left = 0,
          top = 0,
          right = innerWidth,
          bottom = innerHeight
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent),
            bounds = parent.getBoundingClientRect()
          if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
            left = Math.max(left, bounds.left + parent.clientLeft)
            right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth)
          }
          if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
            top = Math.max(top, bounds.top + parent.clientTop)
            bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight)
          }
        }
        return [left - box.left, top - box.top, box.right - right, box.bottom - bottom]
      })
      for (const pixels of clipped)
        expect(pixels, 'each clipped edge stays within one CSS pixel').toBeLessThanOrEqual(1)
    }
    const checkCoverAlignment = async () => {
      const currentRow = page.locator('.song-row[aria-current=true]')
      await expect(currentRow).toBeVisible()
      const { gap, waveOffsets } = await currentRow.evaluate((row) => {
        const marker = getComputedStyle(row, '::before')
        const bounds = row.getBoundingClientRect()
        const cover = row.querySelector('.song-title > :first-child')!.getBoundingClientRect()
        const wave = row.querySelector('.song-index svg')!.getBoundingClientRect()
        const center = wave.top + wave.height / 2
        const markerTop = bounds.top + parseFloat(marker.top)
        const markerBottom = bounds.bottom - parseFloat(marker.bottom)
        return {
          gap: cover.left - bounds.left - parseFloat(marker.left) - parseFloat(marker.width),
          waveOffsets: wave.height
            ? [center - (cover.top + cover.height / 2), center - (markerTop + markerBottom) / 2]
            : [],
        }
      })
      for (const offset of waveOffsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1)
      if (await currentRow.locator('.song-index').isVisible()) expect(gap).toBeGreaterThan(6)
      else expect(gap).toBeCloseTo(6, 1)
      const coverOffsets = await page
        .locator('.song-row .song-title > :first-child')
        .evaluateAll((covers) => covers.map((cover) => cover.getBoundingClientRect().left))
      expect(new Set(coverOffsets).size).toBe(1)
    }
    const songControls = async () => {
      await expect(page.locator('.song-row:not(.list-label)')).toHaveCount(3)
      await checkCoverAlignment()
      expect(
        await page
          .locator('.song-list')
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true)
      const actions = page
        .locator('.song-row:not(.list-label)')
        .first()
        .locator('.song-actions button')
      await expect(actions).toHaveCount(4)
      for (const action of await actions.all()) await insideWindow(action)
    }
    await test.step('one skin and transport stay anchored under drawers and across listening layouts', async () => {
      await player.getByRole('button', { name: '关闭一起听', exact: true }).click()
      await widenPanel(app, player, 864, 722)
      await player.getByRole('button', { name: '展开正在播放', exact: true }).click()
      const stage = player.locator('.immersive-player')
      const foot = player.locator('.adaptive-player-bar')
      const wallpaper = player.locator('.adaptive-shell > .player-background-layer img')
      const image = await wallpaper.elementHandle()
      const audio = await player.locator('audio').elementHandle()
      let previousCover = 0
      for (const [width, height] of [
        [740, 590],
        [864, 722],
        [900, 722],
      ]) {
        await widenPanel(app, player, width, height)
        await expect(stage).toHaveAttribute('data-focus', 'both')
        await expect(stage.locator('.lyric-active')).toBeInViewport()
        const cover = (await stage.locator('.sleeve').boundingBox())!
        expect(cover.width).toBeGreaterThan(previousCover)
        previousCover = cover.width
        expect(cover.height).toBeCloseTo(cover.width, 0)
        const caption = (await stage.locator('.immersive-song-heading').boundingBox())!
        expect(caption.x).toBeCloseTo(cover.x, 0)
        expect(caption.y).toBeGreaterThan(cover.y + cover.height)
        const lyricsColumn = (await stage.locator('.immersive-song').boundingBox())!
        expect(lyricsColumn.x).toBeCloseTo(cover.x + cover.width + (width < 800 ? 24 : 36), 0)
        expect(lyricsColumn.width).toBeGreaterThanOrEqual(460)
        const bar = (await foot.boundingBox())!
        expect(bar.width).toBe(width)
        const play = (await foot.locator('.primary-play').boundingBox())!
        expect(play.x + play.width / 2).toBeCloseTo(width / 2, 0)
        const progress = (await foot.getByRole('slider', { name: '播放进度' }).boundingBox())!
        expect(progress.width).toBeGreaterThan(width * 0.8)
        expect(progress.y + progress.height).toBeLessThanOrEqual(play.y)
        let drawerWidth: number | undefined
        for (const [id, label] of [
          ['queue', '播放队列'],
          ['chat', '房间聊天'],
        ]) {
          await foot.getByRole('button', { name: label, exact: true }).click()
          const drawer = player.locator('.surface-drawer[data-panel="' + id + '"]')
          await expect(drawer).toBeVisible()
          await expectRoomHeaderSingleLine(drawer)
          await expect(drawer).toHaveCSS('opacity', '1')
          const rect = (await drawer.boundingBox())!
          expect(rect.width).toBeGreaterThanOrEqual(300)
          if (drawerWidth !== undefined) expect(rect.width).toBe(drawerWidth)
          drawerWidth = rect.width
          expect(rect.y).toBe(0)
          expect(rect.x + rect.width).toBeCloseTo(width, 0)
          expect(rect.y + rect.height).toBeCloseTo(bar.y, 0)
          expect(await stage.locator('.sleeve').boundingBox()).toEqual(cover)
          expect(await foot.boundingBox()).toEqual(bar)
          await player.keyboard.press('Escape')
          await expect(drawer).toBeHidden()
        }
      }
      let previousDisc = 0
      for (const [width, height] of [
        [1159, 750],
        [1920, 1080],
        [2560, 1440],
      ]) {
        await widenPanel(app, player, width, height)
        const disc = stage.locator('.vinyl-disc')
        await expect(disc).toBeInViewport({ ratio: 1 })
        const bounds = (await disc.boundingBox())!
        expect(bounds.width).toBeGreaterThan(previousDisc + 80)
        expect(bounds.width).toBeCloseTo(bounds.height, 0)
        previousDisc = bounds.width
        await expect(stage.locator('.immersive-song-heading')).toBeInViewport({ ratio: 1 })
      }
      // Reading and audio survive font-size and height changes without remounting.
      // Side tools should keep the same rhythm even when labels disappear.
      for (const width of [321, 520, 639, 740, 900, 1159]) {
        await widenPanel(app, player, width, 722)
        for (const selector of ['.footer-song-actions', '.footer-actions']) {
          const boxes = await foot.locator(selector + ' button:visible').evaluateAll((buttons) =>
            buttons.map((button) => {
              const rect = button.getBoundingClientRect()
              return { x: rect.x, right: rect.right, width: rect.width, height: rect.height }
            }),
          )
          for (const [index, button] of boxes.entries()) {
            expect(button.height).toBe(30)
            if (width < 1040) expect(button.width).toBe(30)
            // Wide mode includes the volume slider between the volume button and lyrics.
            if (index && width < 950) expect(button.x - boxes[index - 1].right).toBeCloseTo(6, 0)
          }
        }
        const play = (await foot.locator('.primary-play').boundingBox())!
        expect(play.x + play.width / 2).toBeCloseTo(width / 2, 0)
        await expect(foot.getByRole('button', { name: '私信快捷回复' })).toHaveCount(0)
        const tools = foot.locator('.footer-actions button:visible')
        for (const button of await tools.all()) {
          expect(
            await button.evaluate((element) => {
              const rect = element.getBoundingClientRect()
              return element.contains(
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
              )
            }),
          ).toBe(true)
        }
        if (width === 1159) {
          const art = (await stage.locator('.turntable').boundingBox())!
          const lyrics = (await stage.locator('.immersive-song').boundingBox())!
          expect(art.width).toBeGreaterThan(300)
          expect(art.x).toBeCloseTo(width - (lyrics.x + lyrics.width), 0)
        }
      }
      await widenPanel(app, player, 900, 722)
      const reader = stage.locator('.lyrics')
      await reader.hover()
      await player.mouse.wheel(0, 84)
      await expect(stage.getByRole('button', { name: '回到当前歌词' })).toBeVisible()
      await widenPanel(app, player, 740, 440)
      await expect(stage).toHaveAttribute('data-focus', 'lyrics')
      await expect(stage.getByRole('button', { name: '回到当前歌词' })).toBeVisible()
      await insideWindow(foot.getByRole('slider', { name: '播放进度' }))
      await widenPanel(app, player, 864, 722)
      await player.evaluate(() => window.together.updatePreferences({ fontScale: 150 }))
      await expect(stage).toHaveAttribute('data-focus', 'lyrics')
      await widenPanel(app, player, 900, 722)
      await expect(stage).toHaveAttribute('data-focus', 'both')
      await expect(stage.locator('.lyric-translation').first()).toBeVisible()
      expect(await reader.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await player.getByRole('button', { name: '返回浏览' }).click()
      await expect(player.locator('[data-panel="library"]')).toBeVisible()
      expect(await image!.evaluate((el) => el.isConnected)).toBe(true)
      expect(await audio!.evaluate((el) => el.isConnected)).toBe(true)
      // Start the compact checks in the automatic cover presentation.
      await player.getByRole('button', { name: '展开正在播放', exact: true }).click()
      await foot.getByRole('button', { name: '歌词', exact: true }).click()
      await player.getByRole('button', { name: '返回浏览' }).click()
    })
    await test.step('album breadcrumbs, search and window controls align across title bar layouts', async () => {
      const library = await openTool(app, player, 'library')
      await library.getByRole('button', { name: '收藏的专辑', exact: true }).click()
      const albums = player.locator('.surface-page[data-panel="albums"]')
      const search = albums.getByRole('searchbox', { name: '搜索当前专辑列表' })
      await expect(albums.locator('.page-crumbs')).toHaveText('音乐库/收藏的专辑')
      await search.fill('收藏')
      for (const fontScale of [100, 150]) {
        await player.evaluate(
          (fontScale) => window.together.updatePreferences({ fontScale }),
          fontScale,
        )
        await expect
          .poll(() =>
            app.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
            ),
          )
          .toBeCloseTo(fontScale / 100)
        for (const width of [321, 643, 1159]) {
          await widenPanel(app, player, width, 682)
          const layout = await albums.locator('.panel-titlebar').evaluate((bar) => {
            const chrome = document.querySelector('.mp-window-chrome')!
            const rowTop = chrome.getBoundingClientRect().top
            const rowBottom = rowTop + chrome.clientHeight
            const firstCenter = (rowTop + rowBottom) / 2
            const searchCenter =
              innerWidth < 520
                ? (rowBottom + bar.getBoundingClientRect().top + bar.clientHeight) / 2
                : firstCenter
            const mid = (box: DOMRect) => box.y + box.height / 2
            const offsets = (elements: NodeListOf<Element>, center: number) =>
              Array.from(elements)
                .filter((el) => el.getClientRects().length)
                .map((el) => ({
                  name: el.getAttribute('class') || el.tagName,
                  delta: mid(el.getBoundingClientRect()) - center,
                }))
            // Text ranges reveal baseline drift even when the surrounding controls align.
            const textOffsets = Array.from(
              document.querySelectorAll(
                '.mp-chrome-brand strong, .surface-page .page-crumbs :is(button,h1,.crumb-separator)',
              ),
            )
              .filter((el) => el.getClientRects().length)
              .map((el) => {
                const range = document.createRange()
                range.selectNodeContents(el)
                return {
                  name: el.textContent,
                  delta: mid(range.getBoundingClientRect()) - firstCenter,
                }
              })
            const input = bar.querySelector('input')!.getBoundingClientRect()
            const field = bar.querySelector('.header-search')!
            const innerTop = field.getBoundingClientRect().top + field.clientTop
            return {
              icons: [
                ...offsets(
                  document.querySelectorAll(
                    '.mp-window-chrome svg, .chrome-account .social-avatar, .window-buttons svg',
                  ),
                  firstCenter,
                ),
                ...offsets(bar.querySelectorAll('.surface-back svg'), firstCenter),
                ...offsets(
                  bar.querySelectorAll('.header-search, .header-search svg, .header-search input'),
                  searchCenter,
                ),
              ],
              textOffsets,
              inputOverflow: Math.max(
                innerTop - input.top,
                input.bottom - (innerTop + field.clientHeight),
              ),
            }
          })
          for (const { name, delta } of layout.icons)
            expect(Math.abs(delta), `${width}px / ${fontScale}% · ${name}`).toBeLessThanOrEqual(
              0.25,
            )
          for (const { name, delta } of layout.textOffsets)
            expect(Math.abs(delta), `${width}px / ${fontScale}% · ${name}`).toBeLessThanOrEqual(1)
          const crumbs = layout.textOffsets.filter(({ name }) =>
            ['音乐库', '收藏的专辑'].includes(name || ''),
          )
          expect(crumbs).toHaveLength(2)
          expect(Math.abs(crumbs[0].delta - crumbs[1].delta)).toBeLessThanOrEqual(0.25)
          expect(layout.inputOverflow).toBeLessThanOrEqual(0.25)
        }
      }
      await search.blur()
      await albums.locator('.header-search-field').click({ position: { x: 2, y: 2 } })
      await expect(search).toBeFocused()
      await search.fill('')
      await albums.getByRole('button', { name: '音乐库', exact: true }).click()
    })
    await test.step('playing markers align with covers across index layouts and zoom levels', async () => {
      for (const [width, fontScale] of [
        [449, 100],
        [450, 100],
        [480, 150],
      ]) {
        await player.evaluate(
          (scale) => window.together.updatePreferences({ fontScale: scale }),
          fontScale,
        )
        await widenPanel(app, player, (width * fontScale) / 100, 680)
        page = await openTool(app, player, 'library')
        await checkCoverAlignment()
        for (const [name, id] of [
          ['我喜欢', 'liked'],
          ['最近播放', 'recent'],
        ] as const) {
          const library = await openTool(app, player, 'library')
          await library.getByRole('button', { name, exact: true }).click()
          page = await panelPage(app, id)
          await checkCoverAlignment()
          await expect(page.locator('.song-row[aria-current=true] .song-index')).toBeVisible({
            visible: width > 449,
          })
        }
      }
    })
    for (const [width, height, fontScale] of [
      [288, 350, 150],
      [360, 640, 100],
      [288, 512, 150],
      [450, 800, 150],
    ]) {
      const main = await app.browserWindow(player)
      await main.evaluate((w, size) => w.setContentSize(size.width, size.height), { width, height })
      await player.evaluate(
        (fontScale) => window.together.updatePreferences({ fontScale }),
        fontScale,
      )
      await player.getByRole('button', { name: '展开正在播放', exact: true }).click()
      const stage = player.locator('.immersive-player')
      const art = await stage.locator('.sleeve').boundingBox()
      expect(art!.width).toBeCloseTo(art!.height, 1)
      for (const node of [
        player.locator('.sleeve'),
        player.locator('.playhead'),
        ...(await player.locator('.adaptive-player-bar button:visible').all()),
      ])
        await insideWindow(node)
      page = await openTool(app, player, 'search')
      await widenPanel(app, page, width + 32, height)
      const search = page.locator('.panel-titlebar').getByLabel('搜索音乐库')
      await insideWindow(search)
      await search.fill('布局')
      await search.press('Enter')
      await songControls()
      page = await openTool(app, player, 'library')
      await page.getByRole('button', { name: '歌单', exact: true }).click()
      const list = page.getByRole('button', { name: new RegExp('^' + playlistName) })
      await insideWindow(list)
      await list.click()
      page = await panelPage(app, 'detail-playlist-20')
      await songControls()
      page = await openTool(app, player, 'library')
      await page.getByRole('button', { name: '收藏的专辑', exact: true }).click()
      page = await panelPage(app, 'albums')
      await page.locator('.album-grid .playlist-card').click()
      page = await panelPage(app, 'detail-album-50')
      await songControls()
      page = await openTool(app, player, 'private')
      await widenPanel(app, page, Math.max(350, width), height)
      if (!(await page.getByLabel('私信内容', { exact: true }).isVisible()))
        await page.locator('.conversation-list > button').first().click()
      await expect(page.getByRole('log', { name: '私信消息' })).toContainText('私信布局检查')
      await page.getByLabel('私信内容', { exact: true }).fill('布局草稿')
      for (const node of [
        page.getByLabel('私信内容', { exact: true }),
        ...(await page.locator('.private-compose .composer-tools button:visible').all()),
      ])
        await insideWindow(node)
      expect(
        await page
          .locator('.private-layout')
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true)
      page = await openTool(app, player, 'settings')
      await widenPanel(app, page, width, height)
      await settingsGroup(page, '外观')
      const settingRows = page.locator('.settings-section:visible .settings-row')
      const offsets = await settingRows.evaluateAll((rows) =>
        rows.map((row) => {
          const label = row.querySelector('.setting-label')!.getBoundingClientRect()
          const control = row.querySelector('.setting-body > :last-child')!.getBoundingClientRect()
          return Math.abs(label.left - control.left)
        }),
      )
      expect(Math.max(...offsets), 'controls align with their labels on narrow pages').toBeLessThan(
        1,
      )
      await insideWindow(page.getByLabel('显示大小'))
      const transparencyRows = page.locator('.transparency-control')
      await expect(transparencyRows).toHaveCount(3)
      for (const row of await transparencyRows.all()) {
        await insideWindow(row.getByRole('slider'))
        const [left, track, available] = await row.evaluate((el) => {
          const label = el.getBoundingClientRect(),
            slider = el.querySelector('input')!.getBoundingClientRect(),
            value = el.querySelector('output')!.getBoundingClientRect()
          return [Math.abs(slider.left - label.left), slider.width, value.left - label.left]
        })
        expect(left).toBeLessThanOrEqual(1)
        expect(track).toBeGreaterThan(available * 0.85)
      }
      await insideWindow(page.getByRole('button', { name: '编辑背景', exact: true }))
      await settingsGroup(page, '更新与帮助')
      await page.getByRole('button', { name: '观测记录' }).click()
      page = await panelPage(app, 'diagnostics')
      await insideWindow(page.getByRole('button', { name: '导出记录' }))
      await player.screenshot({ path: test.info().outputPath('player-' + width + '.png') })
    }
    await test.step('the same component slider controls real surfaces in every window size', async () => {
      async function checkPopup(surface: Locator) {
        const previousComponent = await player.evaluate(
          async () =>
            (await window.together.desktopInfo()).preferences.playerBackground
              .componentTransparency,
        )
        for (const transparency of [0, 50, 100]) {
          await player.evaluate(async (popupTransparency) => {
            const { preferences } = await window.together.desktopInfo()
            await window.together.updatePreferences({
              playerBackground: { ...preferences.playerBackground, popupTransparency },
            })
          }, transparency)
          await expect
            .poll(() =>
              surface.evaluate((el) => {
                const style = getComputedStyle(el)
                return [
                  Number(style.getPropertyValue('--skin-popup-alpha')),
                  Number(style.getPropertyValue('--skin-component-alpha')),
                  style.backgroundImage,
                  style.opacity,
                ]
              }),
            )
            .toEqual([1 - transparency / 100, 1 - previousComponent / 100, 'none', '1'])
        }
        // At 100% transparency, removing only the popup's paint must not change interior pixels.
        // Keep the real underlying page, nested dialogs and scrims in place in both captures.
        const mark = await player.addStyleTag({
          content: '.popup-pixel-probe > * { visibility: hidden !important }',
        })
        const points = await surface.evaluate((el) => {
          el.classList.add('popup-pixel-probe')
          const bounds = el.getBoundingClientRect()
          return [
            [0.23, 0.31],
            [0.75, 0.68],
          ].map(([fx, fy]) => ({
            x: Math.floor(bounds.left + bounds.width * fx),
            y: Math.floor(bounds.top + bounds.height * fy),
          }))
        })
        const probe = player.locator('.popup-pixel-probe')
        const win = await app.browserWindow(player)
        const readPixels = () =>
          win.evaluate(async (window, points) => {
            const frame = await window.webContents.capturePage()
            return points.map(({ x, y }) => [
              ...frame.crop({ x, y, width: 1, height: 1 }).toBitmap(),
            ])
          }, points)
        try {
          await probe.evaluate((el) => {
            el.style.visibility = 'hidden'
          })
          await player.evaluate(
            () =>
              new Promise<void>((done) =>
                requestAnimationFrame(() => requestAnimationFrame(() => done())),
              ),
          )
          const underlying = await readPixels()
          await probe.evaluate((el) => el.style.removeProperty('visibility'))
          await expect.poll(readPixels).toEqual(underlying)
        } finally {
          await probe.evaluate((el) => {
            el.style.removeProperty('visibility')
            el.classList.remove('popup-pixel-probe')
          })
          await mark.evaluate((el) => el.parentNode?.removeChild(el))
        }
      }
      async function checkSurfaces(root: Locator, filled: string[], clear: string[] = []) {
        for (const [transparency, expected] of [
          [0, 255],
          [50, 128],
          [100, 0],
        ]) {
          await player.evaluate(async (value) => {
            const { preferences } = await window.together.desktopInfo()
            await window.together.updatePreferences({
              playerBackground: { ...preferences.playerBackground, componentTransparency: value },
            })
          }, transparency)
          await expect
            .poll(
              () =>
                root.evaluate(
                  (panel, selectors) => {
                    const ctx = document.createElement('canvas').getContext('2d')!
                    return selectors.map((selector) => {
                      const el = selector === ':scope' ? panel : panel.querySelector(selector)
                      if (!el?.checkVisibility()) return null
                      ctx.clearRect(0, 0, 1, 1)
                      ctx.fillStyle = getComputedStyle(el).backgroundColor
                      ctx.fillRect(0, 0, 1, 1)
                      return ctx.getImageData(0, 0, 1, 1).data[3]
                    })
                  },
                  [...filled, ...clear],
                ),
              { message: [...filled, ...clear].join(', ') },
            )
            .toEqual([...filled.map(() => expected), ...clear.map(() => 0)])
        }
      }
      await player.evaluate(() =>
        window.together.updatePreferences({ theme: 'dark', fontScale: 100 }),
      )
      await widenPanel(app, player, 1062, 658)
      const inbox = player.locator('.surface-page[data-panel="private"]')
      await openTool(app, player, 'private')
      await inbox.locator('.conversation-list > button').first().click()
      for (const [width, height] of [
        [1062, 658],
        [740, 590],
        [321, 682],
      ]) {
        await widenPanel(app, player, width, height)
        if (width === 740)
          await player.evaluate(() => window.together.updatePreferences({ theme: 'light' }))
        await expect(inbox.locator('.chat-bubble').first()).toBeVisible()
        await checkSurfaces(
          inbox,
          ['.chat-bubble'],
          [
            '.panel-titlebar',
            '.private-layout',
            ...(width >= 1040 ? ['.conversation-pane'] : []),
            '.private-thread-heading',
            '.private-compose',
          ],
        )
        if (width < 1040) {
          await inbox
            .getByRole('navigation', { name: '页面导航' })
            .getByRole('button', { name: '私信', exact: true })
            .click()
          await expect(inbox.locator('.conversation-pane')).toBeVisible()
          await checkSurfaces(inbox, [], ['.conversation-pane'])
          await inbox.locator('.conversation-list > button').first().click()
        }
        await expect(inbox.locator('.thread-avatar')).toHaveCSS('opacity', '1')
        await expect(inbox.locator('.private-thread-heading strong')).toHaveCSS(
          'text-shadow',
          'none',
        )
      }
      const emoji = inbox.getByRole('button', { name: 'Emoji', exact: true })
      await emoji.click()
      await checkPopup(player.getByRole('dialog', { name: 'Emoji', exact: true }))
      await expect(emoji).toHaveCSS('background-color', /(?:\/ 0|, 0)\)$/)
      await player.keyboard.press('Escape')
      await widenPanel(app, player, 1062, 658)
      const settings = await openTool(app, player, 'settings')
      await settingsGroup(settings, '外观')
      await checkSurfaces(
        player.locator('.surface-page[data-panel=settings]'),
        ['.settings-row'],
        ['.settings-group', '.setting-icon', '.theme-options'],
      )
      const componentRange = settings.getByRole('slider', { name: '组件底色透明度' })
      await componentRange.scrollIntoViewIfNeeded()
      const track = (await componentRange.boundingBox())!
      const savedComponent = () =>
        player.evaluate(
          async () =>
            (await window.together.desktopInfo()).preferences.playerBackground
              .componentTransparency,
        )
      await player.mouse.move(track.x + track.width - 5, track.y + track.height / 2)
      await player.mouse.down()
      await player.mouse.move(track.x + track.width / 2, track.y + track.height / 2, { steps: 6 })
      const liveValue = Number(await componentRange.inputValue())
      expect(liveValue).toBeGreaterThan(45)
      expect(liveValue).toBeLessThan(55)
      expect(await savedComponent()).toBe(100)
      const previewAlpha = await componentRange.evaluate((el) =>
        Number(getComputedStyle(el).getPropertyValue('--skin-component-alpha')),
      )
      expect(previewAlpha).toBeCloseTo((100 - liveValue) / 100, 3)
      await player.mouse.up()
      await expect.poll(savedComponent).toBe(liveValue)
      await componentRange.press('ArrowRight')
      await expect.poll(savedComponent).toBe(liveValue + 1)
      await settings.getByLabel('布局背景透明度', { exact: true }).fill('50')
      await settings.getByRole('button', { name: '编辑背景', exact: true }).click()
      const editor = player.getByRole('dialog', { name: '自定义播放器背景' })
      await checkPopup(editor)
      const preview = editor.locator('.background-preview')
      await expect(preview.locator('.background-preview-track')).toBeVisible()
      await expect(preview.locator('.background-preview-track')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      )
      await expect
        .poll(() =>
          preview
            .locator('.player-background-layer')
            .evaluate((el) => getComputedStyle(el, '::after').opacity),
        )
        .toBe('0.5')
      await editor.getByLabel('背景模糊', { exact: true }).press('ArrowRight')
      await expect(preview.locator('.player-background-layer img')).toHaveCSS('opacity', '1')
      await editor.getByRole('button', { name: '取消', exact: true }).click()
      const library = await openTool(app, player, 'library')
      await expect(library.locator('.playlist-card').first()).toBeVisible()
      await checkSurfaces(player.locator('.surface-page[data-panel=library]'), ['.playlist-card'])
      await openTool(app, player, 'queue')
      await checkPopup(player.locator('.surface-drawer[data-panel=queue]'))
      await checkSurfaces(
        player.locator('.surface-drawer[data-panel=queue]'),
        [],
        ['.panel-titlebar', '.queue-drawer', '.queue-toolbar'],
      )
      await openTool(app, player, 'chat')
      const chat = player.locator('.surface-drawer[data-panel=chat]')
      await checkPopup(chat)
      await chat.getByRole('button', { name: 'Emoji', exact: true }).click()
      await checkPopup(player.getByRole('dialog', { name: 'Emoji', exact: true }))
      await player.keyboard.press('Escape')
      await checkSurfaces(
        player.locator('.surface-drawer[data-panel=chat]'),
        ['.party-composer'],
        ['.panel-titlebar', '.chat-drawer', '.chat-status'],
      )
    })
    await test.step('the media key preference gates actual playback', async () => {
      await openTool(app, player, 'settings')
      await settingsGroup(player.locator('.surface-page[data-panel=settings]'), '播放与桌面')
      await expect
        .poll(() => player.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
        .toBe(false)
      const mediaKeys = player.getByRole('checkbox', { name: '系统媒体快捷键' })
      for (const enabled of [false, true]) {
        // Install a probe before clicking the real settings switch; leave Chromium's native registrations intact.
        await expect(mediaKeys).toBeChecked({ checked: !enabled })
        await mediaKeys.evaluate(async (control: HTMLInputElement) => {
          const media = navigator.mediaSession
          const native = media.setActionHandler
          const registered = new Promise<MediaSessionActionHandler>((resolve) => {
            media.setActionHandler = function (action, handler) {
              native.call(this, action, handler)
              if (action === 'pause' && handler) resolve(handler)
            }
          })
          try {
            control.click()
            const pause = await registered
            pause({ action: 'pause' })
          } finally {
            media.setActionHandler = native
          }
        })
        await expect
          .poll(() => player.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
          .toBe(enabled)
      }
    })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

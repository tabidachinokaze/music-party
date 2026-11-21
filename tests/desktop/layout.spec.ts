import { settingsGroup, openTool, panelPage, loginFixture, widenPanel } from './windows'
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
    al: { name: '布局专辑 · 完整专辑名称' },
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
    multiRoomInfoDTO: { roomBizType: 2 },
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
    let page = player
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.locator('audio').evaluate((node: HTMLAudioElement) => (node.muted = true))
    await loginFixture(app, player)
    page = await openTool(app, player, 'room')
    await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
    const controls = await openTool(app, player, 'controls')
    await expect(controls.locator('.song-identity strong')).toHaveText(songs[0].name)
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
        playerBackground: { image, zoom: 100, opacity: 100, blur: 0, x: 50, y: 50 },
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
    const songControls = async () => {
      await expect(page.locator('.song-row:not(.list-label)')).toHaveCount(3)
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
    for (const [width, height, fontScale] of [
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
      const art = await player.locator('.sleeve').boundingBox()
      expect(art!.width).toEqual(art!.height)
      for (const node of [
        player.locator('.sleeve'),
        player.locator('.playhead'),
        ...(await player.locator('button').all()),
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
      await settingsGroup(page, '外观')
      await insideWindow(page.getByLabel('界面字体大小'))
      await insideWindow(page.getByRole('button', { name: '自定义播放器背景', exact: true }))
      await settingsGroup(page, '更新与帮助')
      await page.getByRole('button', { name: '观测记录' }).click()
      page = await panelPage(app, 'diagnostics')
      await insideWindow(page.getByRole('button', { name: '导出记录' }))
      await player.screenshot({ path: test.info().outputPath('player-' + width + '.png') })
    }
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

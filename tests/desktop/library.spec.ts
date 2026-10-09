import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('favorite views share server playlist ordering and adding to an owned playlist needs confirmation', async () => {
  const favoriteIds = ['9', '2', '7']
  const targetIds: string[] = []
  const calls: { route: string; args: any }[] = []
  let failWrite = true
  const self = { userId: 123, nickname: '歌单测试账户' }
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const args = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const path = new URL(request.url!, 'http://localhost').pathname
    const route = path === '/api' ? args.uri : path
    calls.push({ route, args })
    let body: any = { code: 200 }
    switch (route) {
      case '/login/status':
        body = {
          data: {
            code: 200,
            profile: String(args.cookie).includes('MUSIC_U=library-fixture') ? self : null,
          },
        }
        break
      case '/login/qr/key':
        body = { code: 200, data: { unikey: 'library-key' } }
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
        body = { code: 803, cookie: 'MUSIC_U=library-fixture; Path=/;' }
        break
      case '/user/playlist':
        body = {
          code: 200,
          more: false,
          playlist: [
            {
              id: 10,
              name: '喜欢的音乐',
              specialType: 5,
              trackCount: favoriteIds.length,
              creator: self,
            },
            { id: 20, name: '晚间歌单', trackCount: targetIds.length, creator: self },
            { id: 30, name: '他人歌单', trackCount: 1, creator: { userId: 456, nickname: '好友' } },
          ],
        }
        break
      case '/album/sublist':
        body = { code: 200, data: [], hasMore: false }
        break
      case '/likelist':
        body = { code: 200, ids: [2, 7, 9] }
        break
      case '/playlist/detail': {
        const isFavorite = args.id === '10'
        body = {
          code: 200,
          playlist: {
            id: Number(args.id),
            creator: self,
            specialType: isFavorite ? 5 : 0,
            trackIds: (isFavorite ? favoriteIds : targetIds).map((id) => ({ id: Number(id) })),
          },
        }
        break
      }
      case '/song/detail':
        body = {
          code: 200,
          songs: String(args.ids)
            .split(',')
            .reverse()
            .map((id) => ({
              id: Number(id),
              name: `排序歌曲${id}`,
              ar: [{ name: '测试歌手' }],
              al: { name: '排序专辑' },
              dt: 30000,
            })),
        }
        break
      case '/msg/private':
        body = { code: 200, msgs: [], more: false }
        break
      case '/api/playlist/manipulate/tracks':
        if (failWrite) {
          failWrite = false
          body = { code: 500, message: '模拟添加失败，请检查歌单' }
        } else {
          targetIds.push(...JSON.parse(args.data.trackIds))
          body = { code: 200 }
        }
        break
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  const profile = await mkdtemp(join(tmpdir(), 'music-party-library-'))
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
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: '扫码登录', exact: true }).click()
    await expect(page.getByText(self.nickname, { exact: true })).toBeVisible()
    // A category reacts only within its own button; the rest of the bar stays unchanged.
    await page.locator('.sidebar').getByRole('button', { name: '我的歌单', exact: true }).click()
    const category = page
      .locator('.filter-tabs')
      .getByRole('button', { name: '我创建的', exact: true })
    const tabsBackground = await page
      .locator('.filter-tabs')
      .evaluate((node) => getComputedStyle(node).backgroundColor)
    const categoryBackground = await category.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    )
    await category.hover()
    await expect
      .poll(() => category.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe(categoryBackground)
    expect(
      await page.locator('.filter-tabs').evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe(tabsBackground)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('界面字体大小', { exact: true }).fill('150')
    await page
      .locator('.sidebar')
      .getByRole('button', { name: '我喜欢的音乐', exact: true })
      .click()
    await expect(page.locator('.song-title strong')).toHaveText([
      '排序歌曲9',
      '排序歌曲2',
      '排序歌曲7',
    ])
    expect(
      await page.locator('.song-list').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    expect(calls.some((call) => call.route === '/playlist/detail' && call.args.id === '10')).toBe(
      true,
    )
    await page.locator('.sidebar').getByRole('button', { name: '我的歌单', exact: true }).click()
    await page.getByRole('button', { name: /^喜欢的音乐 3/ }).click()
    await expect(page.locator('.song-title strong')).toHaveText([
      '排序歌曲9',
      '排序歌曲2',
      '排序歌曲7',
    ])
    await page.getByRole('button', { name: '添加到歌单 排序歌曲9', exact: true }).click()
    let popup = page.getByRole('dialog', { name: '添加歌曲到歌单', exact: true })
    await expect(popup.getByRole('button', { name: /^他人歌单/ })).toHaveCount(0)
    await expect(popup.getByRole('button', { name: /^喜欢的音乐/ })).toHaveCount(0)
    await expect(popup.getByRole('button', { name: '确认添加', exact: true })).toBeDisabled()
    await popup.getByRole('button', { name: /^晚间歌单/ }).click()
    expect(calls.filter((call) => call.route.endsWith('/manipulate/tracks'))).toHaveLength(0)
    await popup.getByRole('button', { name: '确认添加', exact: true }).click()
    await expect(popup.getByRole('alert')).toContainText('模拟添加失败')
    expect(calls.filter((call) => call.route.endsWith('/manipulate/tracks'))).toHaveLength(1)
    await popup.getByRole('button', { name: '确认添加', exact: true }).click()
    await expect(popup).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: '已添加到“晚间歌单”' })).toBeVisible()
    expect(targetIds).toEqual(['9'])
    expect(
      calls.filter((call) => call.route.endsWith('/manipulate/tracks')).at(-1)?.args.data,
    ).toEqual({ op: 'add', pid: '20', trackIds: '["9"]', imme: 'true' })
    await page.getByRole('button', { name: '添加到歌单 排序歌曲9', exact: true }).click()
    popup = page.getByRole('dialog', { name: '添加歌曲到歌单', exact: true })
    await popup.getByRole('button', { name: /^晚间歌单 1/ }).click()
    await popup.getByRole('button', { name: '确认添加', exact: true }).click()
    await expect(popup).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: '歌曲已在“晚间歌单”中' })).toBeVisible()
    expect(calls.filter((call) => call.route.endsWith('/manipulate/tracks'))).toHaveLength(2)
    expect(targetIds).toEqual(['9'])
    await page.screenshot({ path: 'test-results/music-party-library-order.png' })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

test('player playlist entry keeps the chosen song across playback changes and isolates account changes', async () => {
  test.setTimeout(60000)
  let port = 0,
    roomActive = false,
    roomSong = '9',
    version = 1
  const self = { userId: 123, nickname: '播放页歌单账户' }
  const targetIds: string[] = []
  const writes: any[] = []
  const playback = () => ({
    playSong: { songId: roomSong, songBizId: `1000${roomSong}`, songRcmdUid: 123 },
    nextSongs: [],
    version,
    playedTime: 1000,
    songDuration: 30000,
    waitSongCount: 0,
  })
  const snapshot = () => ({
    roomId: 'playlist-player-room',
    roomPlaySongInfo: playback(),
    multiRoomInfoDTO: { roomBizType: 2 },
    multiLtRoomUserAgg: {
      onlineNums: 1,
      onlineUserInfos: [{ uid: self.userId, nickname: self.nickname }],
    },
  })
  const pcm = Buffer.alloc(44 + 8000 * 2 * 30)
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
            profile: String(args.cookie).includes('MUSIC_U=player-playlist-fixture') ? self : null,
          },
        }
        break
      case '/login/qr/key':
        body = { code: 200, data: { unikey: 'player-playlist-key' } }
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
        body = { code: 803, cookie: 'MUSIC_U=player-playlist-fixture; Path=/;' }
        break
      case '/user/playlist':
        body = {
          code: 200,
          more: false,
          playlist: [
            { id: 10, name: '喜欢的音乐', specialType: 5, trackCount: 3, creator: self },
            { id: 20, name: '晚间歌单', trackCount: targetIds.length, creator: self },
            { id: 30, name: '他人歌单', trackCount: 1, creator: { userId: 456 } },
          ],
        }
        break
      case '/album/sublist':
        body = { code: 200, data: [], hasMore: false }
        break
      case '/likelist':
        body = { code: 200, ids: [2, 7, 9] }
        break
      case '/playlist/detail':
        body = {
          code: 200,
          playlist: {
            id: Number(args.id),
            creator: self,
            specialType: args.id === '10' ? 5 : 0,
            trackIds: (args.id === '10' ? ['2', '7', '9'] : targetIds).map((id) => ({ id })),
          },
        }
        break
      case '/song/detail':
        body = {
          code: 200,
          songs: String(args.ids)
            .split(',')
            .map((id) => ({
              id,
              name: `播放页歌曲${id}`,
              ar: [{ name: '测试歌手' }],
              al: { name: '测试专辑' },
              dt: 30000,
            })),
        }
        break
      case '/song/url/v1':
        body = { code: 200, data: [{ id: args.id, url: `http://127.0.0.1:${port}/audio.wav` }] }
        break
      case '/msg/private':
        body = { code: 200, msgs: [], more: false }
        break
      case '/register/checktoken/v3':
        body = { code: 200, token: 'player-playlist-token' }
        break
      case '/api/listen/together/multi/match/status/get':
        body = {
          code: 200,
          data: {
            status: roomActive ? 'IN_ROOM' : 'IDLE',
            multiLtRoomSnapshot: roomActive ? snapshot() : null,
          },
        }
        break
      case '/api/listen/together/multi/match/heartbeat':
        body = { code: 200, data: { heartBeatDuration: 1, roomPlaySongInfo: playback() } }
        break
      case '/api/listen/together/multi/played/song/info':
        body = { code: 200, data: { liked: false, songInfo: { zanCnt: 0 } } }
        break
      case '/api/playlist/manipulate/tracks':
        writes.push(args.data)
        targetIds.push(...JSON.parse(args.data.trackIds))
        break
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as any).port
  const profile = await mkdtemp(join(tmpdir(), 'music-party-player-playlist-'))
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
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.locator('audio').evaluate((node: HTMLAudioElement) => (node.muted = true))
    await page.getByRole('button', { name: '扫码登录', exact: true }).click()
    await expect(page.getByText(self.nickname, { exact: true })).toBeVisible()
    await page
      .locator('.sidebar')
      .getByRole('button', { name: '我喜欢的音乐', exact: true })
      .click()
    await page.getByRole('button', { name: '播放 播放页歌曲2', exact: true }).click()
    await expect(page.locator('.now-playing strong')).toHaveText('播放页歌曲2')
    await page.getByRole('button', { name: '打开播放界面', exact: true }).click()
    await page.getByRole('button', { name: '添加当前歌曲到歌单', exact: true }).click()
    let popup = page.getByRole('dialog', { name: '添加歌曲到歌单', exact: true })
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲2')
    await expect(popup.getByRole('button', { name: /^他人歌单|^喜欢的音乐/ })).toHaveCount(0)
    await expect(popup.getByRole('button', { name: '确认添加', exact: true })).toBeDisabled()
    // Playback may advance while the user is choosing a playlist; the dialog retains song 2.
    await page.locator('audio').evaluate((node) => node.dispatchEvent(new Event('ended')))
    await expect(page.locator('.now-playing strong')).toHaveText('播放页歌曲7')
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲2')
    await popup.getByRole('button', { name: /^晚间歌单/ }).click()
    expect(writes).toHaveLength(0)
    await popup.getByRole('button', { name: '确认添加', exact: true }).click()
    await expect(popup).toHaveCount(0)
    expect(targetIds).toEqual(['2'])
    await page.getByRole('button', { name: '添加当前歌曲到歌单', exact: true }).click()
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲7')
    // Simulate account departure while the modal owns focus; stale choices must be discarded.
    await page
      .getByRole('button', { name: '退出账号', exact: true, includeHidden: true })
      .evaluate((node) => (node as HTMLElement).click())
    await expect(popup).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '扫码登录', exact: true, includeHidden: true }),
    ).toBeAttached()
    roomActive = true
    await page.getByRole('button', { name: '收起播放界面', exact: true }).click()
    await page.getByRole('button', { name: '扫码登录', exact: true }).click()
    await expect(page.getByText(self.nickname, { exact: true })).toBeVisible()
    await expect(popup).toHaveCount(0)
    await page.locator('.sidebar').getByRole('button', { name: '正在播放', exact: true }).click()
    await page.getByRole('button', { name: '一起听', exact: true }).click()
    await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
    await expect(page.locator('.now-playing strong')).toHaveText('播放页歌曲9')
    await page.getByRole('button', { name: '添加当前歌曲到歌单', exact: true }).click()
    popup = page.getByRole('dialog', { name: '添加歌曲到歌单', exact: true })
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲9')
    await popup.getByRole('button', { name: /^晚间歌单/ }).click()
    await popup.getByRole('button', { name: '确认添加', exact: true }).click()
    await expect(popup).toHaveCount(0)
    expect(targetIds).toEqual(['2', '9'])
    await page.getByRole('button', { name: '收起播放界面', exact: true }).click()
    await page
      .locator('.sidebar')
      .getByRole('button', { name: '我喜欢的音乐', exact: true })
      .click()
    await page.getByRole('button', { name: '试听 播放页歌曲7', exact: true }).click()
    await expect(page.locator('.now-playing strong')).toHaveText('播放页歌曲7')
    await page.getByRole('button', { name: '打开播放界面', exact: true }).click()
    await page.getByRole('button', { name: '添加当前歌曲到歌单', exact: true }).click()
    popup = page.getByRole('dialog', { name: '添加歌曲到歌单', exact: true })
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲7')
    roomSong = '2'
    version++
    await popup.getByRole('button', { name: /^晚间歌单/ }).click()
    await popup.getByRole('button', { name: '确认添加', exact: true }).click()
    await expect(popup).toHaveCount(0)
    expect(targetIds).toEqual(['2', '9', '7'])
    expect(writes.map((args) => JSON.parse(args.trackIds))).toEqual([['2'], ['9'], ['7']])
    await page.screenshot({ path: 'test-results/music-party-player-playlist-entry.png' })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

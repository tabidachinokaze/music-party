import { settingsGroup, openTool, panelPage, loginFixture, widenPanel } from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('favorite views share server playlist ordering and multi-playlist writes retain selection and retry only failures', async () => {
  const favoriteIds = ['9', '2', '7']
  const tracks = new Map<string, string[]>([['301', ['9']]])
  const playlistTracks = (id: string) => tracks.get(id) ?? []
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
            ...Array.from({ length: 24 }, (_, index) => ({
              id: 300 + index,
              name: '测试歌单 ' + index,
              trackCount: playlistTracks(String(300 + index)).length,
              creator: self,
            })),
            { id: 20, name: '晚间歌单', trackCount: playlistTracks('20').length, creator: self },
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
            trackIds: (isFavorite ? favoriteIds : playlistTracks(args.id)).map((id) => ({
              id: Number(id),
            })),
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
        if (failWrite && args.data.pid === '20') {
          failWrite = false
          body = { code: 500, message: '模拟添加失败，请检查歌单' }
        } else {
          tracks.set(args.data.pid, [
            ...playlistTracks(args.data.pid),
            ...JSON.parse(args.data.trackIds),
          ])
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
    const player = await app.firstWindow()
    await player.emulateMedia({ reducedMotion: 'reduce' })
    let page = player.locator('body')
    const errors: string[] = []
    player.on('pageerror', (error) => errors.push(error.message))
    await loginFixture(app, player)
    // A category reacts only within its own button; the rest of the bar stays unchanged.
    page = await openTool(app, player, 'library')
    const cards = page.locator('.playlist-card')
    await expect(cards.filter({ hasText: '晚间歌单' })).toContainText(self.nickname)
    await expect(cards.filter({ hasText: '他人歌单' })).toContainText('好友')
    await expect(cards.getByText(/自建歌单|收藏歌单/)).toHaveCount(0)
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
    await category.click()
    await expect(cards.filter({ hasText: '他人歌单' })).toHaveCount(0)
    await page.getByRole('button', { name: /^晚间歌单/ }).click()
    const detail = await panelPage(app, 'detail-playlist-20')
    await detail
      .getByRole('navigation', { name: '页面导航' })
      .getByRole('button', { name: /^返回/ })
      .click()
    await expect(category).toHaveAttribute('aria-pressed', 'true')
    await expect(cards.filter({ hasText: '他人歌单' })).toHaveCount(0)
    await page.getByRole('button', { name: '全部', exact: true }).click()

    page = await openTool(app, player, 'settings')
    await settingsGroup(page, '外观')
    await page.getByLabel('显示大小', { exact: true }).fill('150')
    page = await openTool(app, player, 'library')
    await player
      .locator('.main-sidebar')
      .getByRole('button', { name: '我喜欢的音乐', exact: true })
      .click()
    page = await panelPage(app, 'liked')
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
    page = await openTool(app, player, 'library')
    await page.getByRole('button', { name: /^喜欢的音乐 3/ }).click()
    page = await panelPage(app, 'detail-playlist-10')
    await expect(page.locator('.song-title strong')).toHaveText([
      '排序歌曲9',
      '排序歌曲2',
      '排序歌曲7',
    ])
    await page.getByRole('button', { name: '添加到歌单 排序歌曲9', exact: true }).click()
    let popup = player.getByRole('dialog', { name: '添加到歌单', exact: true })
    await expect(popup.getByRole('checkbox', { name: /^他人歌单/ })).toHaveCount(0)
    await expect(popup.getByRole('checkbox', { name: /^喜欢的音乐/ })).toHaveCount(0)
    await expect(popup.getByRole('button', { name: /^确认添加/ })).toBeDisabled()
    const pinned = popup.locator('.panel-titlebar')
    const needle = popup.getByRole('searchbox')
    const addButton = popup.getByRole('button', { name: /^确认添加/ })
    const list = popup.locator('.playlist-target-list')
    for (const [width, height] of [
      [321, 682],
      [288, 410],
      [740, 590],
      [1159, 750],
      [2560, 1440],
    ]) {
      await widenPanel(app, player, width, height)
      const headerBefore = await pinned.boundingBox()
      const searchBefore = await needle.boundingBox()
      await needle.focus()
      await popup.getByRole('checkbox', { name: /^晚间歌单/ }).focus()
      await expect(popup.getByRole('checkbox', { name: /^晚间歌单/ })).toBeInViewport()
      expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      expect(await pinned.boundingBox()).toEqual(headerBefore)
      expect(await needle.boundingBox()).toEqual(searchBefore)
      await expect(addButton).toBeInViewport({ ratio: 1 })
      await expect(popup.getByRole('button', { name: '关闭添加到歌单' })).toBeInViewport({
        ratio: 1,
      })
      await list.evaluate((element) => {
        element.scrollTop = 0
      })
    }
    await player.evaluate(() => window.together.updatePreferences({ fontScale: 100 }))
    await expect.poll(() => player.evaluate(() => innerWidth)).toBe(2560)
    const full = (await popup.boundingBox())!
    expect(full.width).toBeCloseTo(600, 0)
    expect(full.height).toBeLessThanOrEqual(801)
    const items = popup.locator('.playlist-target')
    const viewport = (await list.boundingBox())!
    const first = (await items.first().boundingBox())!
    const eighth = (await items.nth(7).boundingBox())!
    expect(eighth.y + eighth.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1)
    expect(viewport.x + viewport.width - first.x - first.width).toBeGreaterThanOrEqual(8)
    const searchBounds = (await popup.locator('.playlist-target-search').boundingBox())!
    expect(first.x + first.width).toBeCloseTo(searchBounds.x + searchBounds.width, 0)
    await needle.fill('晚间歌单')
    await expect(items).toHaveCount(1)
    expect((await popup.boundingBox())!.height).toBeLessThan(full.height / 2)
    await needle.fill('')
    await widenPanel(app, player, 1159, 750)
    const writes = () => calls.filter((call) => call.route.endsWith('/manipulate/tracks'))
    const late = popup.getByRole('checkbox', { name: /^晚间歌单/ })
    const previous = popup.getByRole('checkbox', { name: /^测试歌单 1 / })
    const fresh = popup.getByRole('checkbox', { name: /^测试歌单 2 / })
    await expect(popup.getByText(/请使用歌曲红心按钮/)).toHaveCount(0)
    await late.check()
    await player.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    expect(writes()).toHaveLength(0)
    await page.getByRole('button', { name: '添加到歌单 排序歌曲9', exact: true }).click()
    await expect(late).not.toBeChecked()
    await late.check()
    await needle.fill('没有此歌单')
    await expect(popup.getByText('没有找到匹配歌单')).toBeVisible()
    await expect(addButton).toHaveText('确认添加（1）')
    await needle.fill('测试歌单')
    await previous.check()
    await fresh.check()
    await fresh.uncheck()
    await expect(addButton).toHaveText('确认添加（2）')
    await fresh.check()
    await expect(addButton).toHaveText('确认添加（3）')
    expect(writes()).toHaveLength(0)
    await addButton.click()
    await expect(popup.getByRole('alert')).toContainText('1 个歌单添加失败')
    await expect(late).toHaveAccessibleName(/模拟添加失败/)
    await expect(late).toBeChecked()
    await expect(late).toBeEnabled()
    await expect(previous).toHaveAccessibleName(/1 首 · 已收录/)
    await expect(previous).toBeDisabled()
    await expect(fresh).toHaveAccessibleName(/1 首 · 已添加/)
    await expect(fresh).toBeDisabled()
    await expect(addButton).toHaveText('确认添加（1）')
    expect(
      writes()
        .map((call) => call.args.data.pid)
        .sort(),
    ).toEqual(['20', '302'])
    const checksBeforeRetry = calls.filter(
      (call) => call.route === '/playlist/detail' && ['301', '302'].includes(call.args.id),
    ).length
    await addButton.click()
    await expect(popup).toHaveCount(0)
    await expect(
      (await panelPage(app, 'feedback'))
        .getByRole('status')
        .filter({ hasText: '已添加到 2 个歌单，1 个歌单已收录' }),
    ).toBeVisible()
    expect(
      calls.filter(
        (call) => call.route === '/playlist/detail' && ['301', '302'].includes(call.args.id),
      ),
    ).toHaveLength(checksBeforeRetry)
    expect(writes().at(-1)?.args.data).toEqual({
      op: 'add',
      pid: '20',
      trackIds: '["9"]',
      imme: 'true',
    })
    expect(playlistTracks('302')).toEqual(['9'])
    expect(playlistTracks('20')).toEqual(['9'])
    await page.getByRole('button', { name: '添加到歌单 排序歌曲9', exact: true }).click()
    await popup.getByRole('checkbox', { name: /^晚间歌单 1/ }).check()
    await addButton.click()
    await expect(popup).toHaveCount(0)
    await expect(
      (await panelPage(app, 'feedback'))
        .getByRole('status')
        .filter({ hasText: '歌曲已在“晚间歌单”中' }),
    ).toBeVisible()
    expect(writes()).toHaveLength(3)
    await player.screenshot({ path: 'test-results/music-party-library-order.png' })
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
  const longList = Array.from({ length: 225 }, (_, i) => String(i + 100))
  longList.splice(207, 0, '7')
  let failMiddlePage = true
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
            { id: 40, name: '分页歌单', trackCount: longList.length, creator: self },
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
            trackIds: (args.id === '40'
              ? longList
              : args.id === '10'
                ? ['2', '7', '9']
                : targetIds
            ).map((id) => ({ id })),
          },
        }
        break
      case '/song/detail':
        if (failMiddlePage && String(args.ids).startsWith('200,201,')) {
          failMiddlePage = false
          body = { code: 500, message: '模拟歌曲分页失败' }
          break
        }
        body = {
          code: 200,
          songs: String(args.ids)
            .split(',')
            .filter((id) => Number(id) < 200 || Number(id) >= 300)
            .map((id) => ({
              id,
              name: `播放页歌曲${id}`,
              ar: [{ id: 41, name: '艺人A' }, { id: 42, name: '艺人B' }, { name: '无编号艺人' }],
              composers: [{ id: 43, name: '作曲C' }],
              al: { name: '测试专辑' },
              dt: 30000,
            })),
        }
        break
      case '/artist/songs':
        body = {
          code: 200,
          songs: [{ id: 75, name: '音乐人作品', ar: [{ id: 42, name: '艺人B' }] }],
          more: false,
          total: 1,
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
      case '/api/listen/together/multi/match/wait/song/list':
        body = {
          code: 200,
          data: {
            songLists: [roomSong, '7'].map((id) => ({
              songInfo: {
                resourceId: id,
                bizId: '1000' + id,
                title: '房间歌曲' + id,
                artistName: ['房间艺人'],
              },
              rcmdUid: self.userId,
            })),
          },
        }
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
    const player = await app.firstWindow()
    let page = player.locator('body')
    const errors: string[] = []
    player.on('pageerror', (error) => errors.push(error.message))
    await player.locator('audio').evaluate((node: HTMLAudioElement) => (node.muted = true))
    await loginFixture(app, player)
    page = await openTool(app, player, 'library')
    await player
      .locator('.main-sidebar')
      .getByRole('button', { name: '我喜欢的音乐', exact: true })
      .click()
    page = await panelPage(app, 'liked')
    await page.getByRole('button', { name: '播放 播放页歌曲2', exact: true }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('播放页歌曲2')
    await test.step('open a personal queue artist by keyboard without starting that track', async () => {
      const queue = await openTool(app, player, 'queue')
      const second = queue.locator('.queue-track').nth(1)
      await expect(second).toContainText('无编号艺人')
      await expect(second.getByRole('button', { name: '查看音乐人 无编号艺人' })).toHaveCount(0)
      await second.getByRole('button', { name: '查看音乐人 艺人B' }).press('Enter')
      const artist = await panelPage(app, 'detail-artist-42')
      await expect(artist.locator('.song-title strong')).toHaveText('音乐人作品')
      await expect(player.locator('.footer-track-copy strong:visible')).toHaveText('播放页歌曲2')
      await artist.locator('.surface-back').click()
      await expect(queue.locator('.queue-track[aria-current=true]')).toContainText('播放页歌曲2')
      await player.keyboard.press('Escape')
    })
    await test.step('open individual artists from the transport and now playing', async () => {
      const footer = player.locator('.adaptive-player-bar')
      await footer.getByRole('button', { name: '查看音乐人 艺人B' }).click()
      const artist = await panelPage(app, 'detail-artist-42')
      await expect(artist.locator('.song-title strong')).toHaveText('音乐人作品')
      await artist.locator('.surface-back').click()
      await footer.getByRole('button', { name: '展开正在播放', exact: true }).click()
      const playing = player.locator('.immersive-song-info')
      await expect(playing.getByRole('button', { name: '查看音乐人 无编号艺人' })).toHaveCount(0)
      await playing.getByRole('button', { name: '查看音乐人 艺人A' }).click()
      const firstArtist = await panelPage(app, 'detail-artist-41')
      await firstArtist.locator('.surface-back').click()
      await expect(playing.locator('h1')).toHaveText('播放页歌曲2')
      await player.getByRole('button', { name: '返回浏览' }).click()
    })
    await player.getByRole('button', { name: '添加当前歌曲到歌单', exact: true }).click()
    let popup = player.getByRole('dialog', { name: '添加到歌单', exact: true })
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲2')
    await expect(popup.getByRole('checkbox', { name: /^他人歌单|^喜欢的音乐/ })).toHaveCount(0)
    await expect(popup.getByRole('button', { name: /^确认添加/ })).toBeDisabled()
    // Playback may advance while the user is choosing a playlist; the dialog retains song 2.
    await player.locator('audio').evaluate((node) => node.dispatchEvent(new Event('ended')))
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('播放页歌曲7')
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲2')
    await popup.getByRole('checkbox', { name: /^晚间歌单/ }).click()
    expect(writes).toHaveLength(0)
    await popup.getByRole('button', { name: /^确认添加/ }).click()
    await expect(popup).toHaveCount(0)
    expect(targetIds).toEqual(['2'])
    await test.step('locate an unpaged playing song, filter it, open a credited artist and return to the same position', async () => {
      const library = await openTool(app, player, 'library')
      await library.getByRole('button', { name: /^分页歌单/ }).click()
      const collection = await panelPage(app, 'detail-playlist-40')
      const locate = collection.getByRole('button', { name: '定位正在播放的歌曲' })
      const row = collection.locator('.song-row[aria-current="true"]')
      await expect(collection.locator('.song-row:not(.list-label)')).toHaveCount(100)
      await expect(row).toHaveCount(0)
      await locate.click()
      await expect(collection.getByRole('alert')).toContainText('模拟歌曲分页失败')
      await locate.click()
      await expect(row).toBeInViewport()
      await expect(collection.locator('.collection-summary')).toContainText('100 首暂不可用')
      await expect(locate).toBeHidden()

      const viewport = collection.locator('.panel-content')
      await viewport.evaluate((node) => node.scrollTo(0, 0))
      await expect(locate).toBeVisible()
      const search = collection.getByRole('searchbox')
      await search.fill('无匹配记录')
      await expect(locate).toBeHidden()
      await search.fill('播放页歌曲')
      await locate.click()
      await expect(row).toBeInViewport()
      await expect(row.getByRole('button', { name: /无编号艺人/ })).toHaveCount(0)
      for (const [name, id] of [
        ['艺人B', 42],
        ['作曲C', 43],
      ] as const) {
        const top = await viewport.evaluate((node) => node.scrollTop)
        await row.getByRole('button', { name: '查看音乐人 ' + name }).click()
        const artist = await panelPage(app, `detail-artist-${id}`)
        await expect(artist.locator('.song-title strong')).toHaveText('音乐人作品')
        await expect(artist.getByRole('button', { name: '定位正在播放的歌曲' })).toBeHidden()
        await artist.locator('.surface-back').click()
        await expect(search).toHaveValue('播放页歌曲')
        await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(top)
        await expect(row).toBeInViewport()
      }
      await viewport.evaluate((node) => node.scrollTo(0, node.scrollHeight))
      await expect(locate).toBeVisible()
      await locate.click()
      await expect(row).toBeInViewport()
      await expect(locate).toBeHidden()
    })
    await player.getByRole('button', { name: '添加当前歌曲到歌单', exact: true }).click()
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲7')
    // Leaving the picker and switching accounts must discard the old song choice.
    const settings = await openTool(app, player, 'settings')
    await settingsGroup(settings, '账号')
    await settings.getByRole('button', { name: '退出账号', exact: true }).click()
    await expect(popup).toBeHidden()
    await expect(
      player.getByRole('banner').getByRole('button', { name: '登录账号', exact: true }),
    ).toBeVisible()
    roomActive = true
    await loginFixture(app, player)
    await expect(popup).toHaveCount(0)
    page = player.locator('body')
    await player.bringToFront()
    page = await openTool(app, player, 'room')
    await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('播放页歌曲9')
    await test.step('use track IDs to resolve both current and upcoming room artists', async () => {
      const queue = await openTool(app, player, 'queue')
      await expect(
        queue.locator('.queue-playing').getByRole('button', { name: '查看音乐人 艺人A' }),
      ).toBeVisible()
      await queue.locator('.queue-track').getByRole('button', { name: '查看音乐人 艺人B' }).click()
      const artist = await panelPage(app, 'detail-artist-42')
      await expect(artist.locator('.song-title strong')).toHaveText('音乐人作品')
      await expect(player.locator('.footer-track-copy strong:visible')).toHaveText('播放页歌曲9')
      await artist.locator('.surface-back').click()
      await expect(queue.locator('.queue-playing strong')).toHaveText('房间歌曲9')
      await player.keyboard.press('Escape')
    })
    await player.getByRole('button', { name: '添加当前歌曲到歌单', exact: true }).click()
    popup = player.getByRole('dialog', { name: '添加到歌单', exact: true })
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲9')
    await popup.getByRole('checkbox', { name: /^晚间歌单/ }).click()
    await popup.getByRole('button', { name: /^确认添加/ }).click()
    await expect(popup).toHaveCount(0)
    expect(targetIds).toEqual(['2', '9'])
    page = await openTool(app, player, 'library')
    await player
      .locator('.main-sidebar')
      .getByRole('button', { name: '我喜欢的音乐', exact: true })
      .click()
    page = await panelPage(app, 'liked')
    await page.getByRole('button', { name: '试听 播放页歌曲7', exact: true }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('播放页歌曲7')
    await player.getByRole('button', { name: '添加当前歌曲到歌单', exact: true }).click()
    popup = player.getByRole('dialog', { name: '添加到歌单', exact: true })
    await expect(popup.locator('.playlist-add-song strong')).toHaveText('播放页歌曲7')
    roomSong = '2'
    version++
    await popup.getByRole('checkbox', { name: /^晚间歌单/ }).click()
    await popup.getByRole('button', { name: /^确认添加/ }).click()
    await expect(popup).toHaveCount(0)
    expect(targetIds).toEqual(['2', '9', '7'])
    expect(writes.map((args) => JSON.parse(args.trackIds))).toEqual([['2'], ['9'], ['7']])
    await player.screenshot({ path: 'test-results/music-party-player-playlist-entry.png' })
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

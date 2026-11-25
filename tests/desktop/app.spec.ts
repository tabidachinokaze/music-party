import {
  expectQueueHeaderFits,
  expectRoomHeaderSingleLine,
  settingsGroup,
  openTool,
  panelPage,
  loginFixture,
  serveArtwork,
  serveSeekableWav,
  widenPanel,
} from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import packageInfo from '../../package.json'

type RoomSong = { songId: string; songBizId: string; songRcmdUid: string | number }

test('official multiplayer lifecycle with three members, remote song changes and add-song semantics', async () => {
  test.setTimeout(90000)
  let active = false,
    currentSong = '111',
    version = 1,
    port = 0
  let queue: RoomSong[] = []
  let played: RoomSong[] = []
  let historyUnavailable = false
  let queueUnavailable = false
  const roomLikes = new Set<string>(),
    roomLikeCounts = new Map<string, number>(),
    roomUps = new Set<string>()
  let heartbeatSeconds = 1,
    lastHeartbeatSeconds = 0,
    boundaryChecks = -1
  let synchronizationGate: Promise<void> | null = null
  let releaseSynchronization: () => void = () => {}
  let heldHeartbeats = 0
  let likeResponseGate: Promise<void> | null = null
  let releaseLikeResponse: () => void = () => {}
  let liked = ['111', '112']
  let memberIds = [123, 456, 789]
  let creatorId = 123
  let onlineCount = memberIds.length
  const chatStart = Date.now()
  const peerNickname = '听友456 · 喜欢在一起听房间分享音乐的超长完整昵称'
  const chatRecords: any[] = [
    {
      roomId: 'multi-test-room',
      sendUid: 456,
      sendTime: chatStart,
      nickname: peerNickname,
      avatarUrl: '',
      msgType: 0,
      imChatRoomMsgBody: { text: '手机端的聊天内容 <b>原样显示</b>' },
    },
  ]
  const calls: Array<{ path: string; args: any }> = []
  const songInfo = () => ({
    playSong: { songId: currentSong, songBizId: `1000${currentSong}`, songRcmdUid: 123 },
    nextSongs: queue.slice(0, 4),
    version,
    playedTime: 5000,
    songDuration: 30000,
    waitSongCount: queue.length,
    playingSongZanCnt: roomLikeCounts.get(`1000${currentSong}`) || 0,
  })
  const snapshot = () => ({
    roomId: 'multi-test-room',
    roomPlaySongInfo: songInfo(),
    multiRoomInfoDTO: { chatRoomId: '99887766', roomType: 'MULTI_MATCH_SONG', creatorId },
    multiLtRoomUserAgg: {
      onlineNums: onlineCount,
      onlineUserInfos: memberIds.map((uid) => ({ uid, nickname: `听友${uid}`, avatar: '' })),
    },
  })
  const roomQueueRow = (song: RoomSong) => ({
    songInfo: {
      resourceId: song.songId,
      bizId: song.songBizId,
      title: `测试歌曲${song.songId}`,
      artistName: ['测试歌手'],
      coverUrl: '',
    },
    rcmdUid: song.songRcmdUid,
    selfRcmd: String(song.songRcmdUid) === '123',
    uped: roomUps.has(song.songBizId),
    nickname: `听友${song.songRcmdUid}`,
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
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname
    if (path === '/audio.wav') {
      serveSeekableWav(req, res, pcm)
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const args = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const route = path === '/api' ? args.uri : path
    calls.push({ path: route, args })
    let body: any = { code: 200 }
    switch (route) {
      case '/login/status':
        body = {
          data: {
            code: 200,
            profile: args.cookie.includes('MUSIC_U=mock-secret')
              ? { userId: 123, nickname: '测试听友' }
              : null,
          },
        }
        break
      case '/login/qr/key':
        body = { code: 200, data: { unikey: 'mock-key' } }
        break
      case '/login/qr/create':
        body = {
          code: 200,
          data: {
            qrimg:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
          },
        }
        break
      case '/login/qr/check':
        body = {
          code: 803,
          cookie: 'MUSIC_U=mock-secret; Path=/; HttpOnly; __csrf=mock-csrf; Path=/',
        }
        break
      case '/register/checktoken/v3':
        body = { code: 200, token: 'mock-request-token' }
        break
      case '/api/listen/together/multi/room/create':
        active = true
        creatorId = 123
        body = { code: 200, data: { success: true, multiLtRoomSnapshot: snapshot() } }
        break
      case '/api/listen/together/multi/match/ack':
        active = true
        creatorId = 789
        body = { code: 200, data: { success: true, multiLtRoomSnapshot: snapshot() } }
        break
      case '/api/listen/together/multi/played/song/info':
        body = {
          code: 200,
          data: {
            liked: roomLikes.has(args.data.songBizId),
            songInfo: { zanCnt: roomLikeCounts.get(args.data.songBizId) || 0 },
          },
        }
        break
      case '/api/listen/together/multi/match/played/song/list': {
        if (!active) {
          body = { code: 403, message: '已离开房间' }
          break
        }
        if (historyUnavailable) {
          body = { code: 500, message: '读取已播记录失败' }
          break
        }
        const offset = Number(JSON.parse(args.data.page).cursor || 0)
        const more = offset + 2 < played.length
        body = {
          code: 200,
          data: {
            songLists: played.slice(offset, offset + 2).map(roomQueueRow),
            page: { more, cursor: more ? String(offset + 2) : '' },
          },
        }
        break
      }
      case '/api/listen/together/multi/match/wait/song/list': {
        if (queueUnavailable) {
          body = { code: 500, message: '读取待播列表失败' }
          break
        }
        const cursor = JSON.parse(args.data.page).cursor
        const offset = Number(cursor || 0)
        const list = [songInfo().playSong, ...queue].map(roomQueueRow)
        body = {
          code: 200,
          data: {
            songLists: list.slice(offset, offset + 20),
            page: {
              more: offset + 20 < list.length,
              cursor: offset + 20 < list.length ? String(offset + 20) : '',
            },
          },
        }
        break
      }
      case '/api/listen/together/multi/match/status/get':
        if (boundaryChecks >= 0 && ++boundaryChecks === 2) {
          currentSong = '666'
          version++
        }

        body = {
          code: 200,
          data: {
            status: active ? 'IN_ROOM' : 'IDLE',
            multiLtRoomSnapshot: active ? snapshot() : null,
          },
        }
        break
      case '/api/listen/together/multi/match/heartbeat':
        if (synchronizationGate) {
          heldHeartbeats++
          await synchronizationGate
        }
        lastHeartbeatSeconds = heartbeatSeconds
        body = {
          code: 200,
          data: { heartBeatDuration: lastHeartbeatSeconds, roomPlaySongInfo: songInfo() },
        }
        break
      case '/api/listen/together/multi/match/song/operate':
        if (args.data.operate === 4) {
          body = { code: 200, data: { failedCode: 10000, failedMsg: '没有切歌权限' } }
          break
        }
        if (args.data.operate === 2) {
          const index = queue.findIndex(
            (song) => String(song.songBizId) === String(args.data.bizId),
          )
          if (index >= 0) queue.unshift(...queue.splice(index, 1))
          roomUps.add(String(args.data.bizId))
          version++
        }
        if (args.data.operate === 3) {
          await new Promise((resolve) => setTimeout(resolve, 700))
          roomLikes.add(String(args.data.bizId))
          roomLikeCounts.set(
            String(args.data.bizId),
            (roomLikeCounts.get(String(args.data.bizId)) || 0) + 1,
          )
          version++
          if (likeResponseGate) await likeResponseGate
        }
        if (args.data.operate === 7) {
          queue = queue.filter((song) => String(song.songBizId) !== String(args.data.bizId))
          version++
        }
        if (args.data.operate === 1) {
          queue.push({ songId: args.data.songId, songBizId: '999', songRcmdUid: '123' })
          version++
        }
        body = { code: 200, data: { failedCode: 0, roomSongInfo: songInfo() } }
        break
      case '/api/listen/together/multi/match/msg/history': {
        const page = JSON.parse(args.data.page)
        body = {
          code: 200,
          data: {
            records: page.cursor
              ? [
                  {
                    ...chatRecords[0],
                    sendTime: chatStart - 10000,
                    imChatRoomMsgBody: { text: '更早的聊天记录' },
                  },
                ]
              : [...chatRecords].reverse(),
            page: { more: !page.cursor, cursor: page.cursor ? null : 'older-cursor', size: 50 },
          },
        }
        break
      }
      case '/api/middle/im/chatroom/send': {
        const text = JSON.parse(args.data.msgBody).msg
        if (text === '失败测试') {
          body = { code: 405, message: '发太多啦' }
          break
        }
        chatRecords.push({
          roomId: JSON.parse(args.data.clientExt).roomId,
          sendUid: 123,
          sendTime: Date.now(),
          nickname: '测试听友',
          avatarUrl: '',
          msgType: 0,
          imChatRoomMsgBody: { text },
          emoji: JSON.parse(args.data.clientExt).emoji,
        })
        body = { code: 200, data: { success: true } }
        break
      }
      case '/api/listen/together/multi/match/exit':
        active = false
        body = { code: 200, data: { success: true } }
        break
      case '/album/sublist':
        body = {
          code: 200,
          count: 51,
          hasMore: !args.offset,
          data: Array.from({ length: args.offset ? 1 : 50 }, (_, i) => ({
            id: 8000 + Number(args.offset || 0) + i,
            name: `收藏专辑${Number(args.offset || 0) + i + 1}`,
            artists: [{ name: '专辑歌手' }],
            size: 2,
          })),
        }
        break
      case '/album':
        body = {
          code: 200,
          album: { id: args.id },
          songs: [
            {
              id: 6100,
              name: '专辑第一首',
              ar: [{ name: '专辑歌手' }],
              al: { name: '收藏专辑1' },
              dt: 30000,
            },
            { id: 6101, name: '专辑第二首', dt: 30000 },
          ],
        }
        break
      case '/song/detail':
        body = {
          code: 200,
          songs: String(args.ids)
            .split(',')
            .map((id) => ({
              id,
              name: `测试歌曲${id}`,
              ar:
                id === '221'
                  ? [
                      { id: 921, name: '音乐人甲' },
                      { id: 922, name: '音乐人乙' },
                    ]
                  : [{ name: '测试歌手' }],
              al: { name: '测试专辑' },
              dt: 30000,
            })),
        }
        break
      case '/user/playlist': {
        const offset = args.offset || 0
        body = {
          code: 200,
          more: offset === 0,
          playlist: Array.from({ length: offset === 0 ? 50 : 1 }, (_, i) => ({
            id: offset + i + 1,
            name: `歌单${offset + i + 1}`,
            trackCount: offset + i + 1 === 10 ? 2599 : 205,
            creator: { userId: i % 2 === 0 ? 123 : 456, nickname: '歌单作者' },
          })),
        }
        break
      }
      case '/playlist/detail':
        body = {
          code: 200,
          playlist: {
            trackIds: Array.from({ length: Number(args.id) === 10 ? 2599 : 205 }, (_, i) => ({
              id: 5000 + i,
            })),
          },
        }
        break
      case '/likelist':
        body = { code: 200, ids: liked }
        break
      case '/like':
        liked = args.like === 'false' ? liked.filter((id) => id !== args.id) : [...liked, args.id]
        body = { code: 200 }
        break
      case '/cloudsearch':
        if (args.keywords === '分页测试') {
          const offset = Number(args.offset || 0)
          const results = Array.from({ length: Math.min(30, 65 - offset) }, (_, index) => ({
            id: 9000 + offset + index,
            name: `分页结果${offset + index + 1}`,
            dt: 30000,
            trackCount: 205,
          }))
          body = {
            code: 200,
            result:
              Number(args.type) === 1000
                ? { playlists: results, playlistCount: 65 }
                : Number(args.type) === 100
                  ? { artists: results, artistCount: 65 }
                  : { songs: results, songCount: 65 },
          }
          break
        }
        body = {
          code: 200,
          result:
            Number(args.type) === 1000
              ? { playlists: [{ id: 1, name: '搜索歌单', trackCount: 205 }], playlistCount: 1 }
              : Number(args.type) === 100
                ? { artists: [{ id: 501, name: '搜索歌手' }], artistCount: 1 }
                : { songs: [{ id: 777, name: '搜索歌曲', dt: 30000 }], songCount: 1 },
        }
        break
      case '/artist/songs':
        body = {
          code: 200,
          songs: [{ id: 888, name: '歌手歌曲', dt: 30000 }],
          more: false,
          total: 1,
        }
        break
      case '/lyric':
        body = {
          code: 200,
          tlyric: { lyric: '[00:00.00]第一句译文' },
          lrc: {
            lyric:
              '[00:00.00]第一句\n[00:05.00]第二句\n' +
              Array.from({ length: 24 }, (_, i) => {
                const seconds = (i + 2) * 5
                return `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.00]第${i + 3}行歌词`
              }).join('\n'),
          },
        }
        break
      case '/song/url/v1':
        body = { code: 200, data: [{ id: args.id, url: `http://127.0.0.1:${port}/audio.wav` }] }
        break
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as any).port
  const profile = await mkdtemp(join(tmpdir(), 'music-party-test-'))
  const launch = () =>
    electron.launch({
      args: [
        '.',
        `--ozone-platform=${process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'}`,
        '--password-store=basic',
      ],
      env: {
        ...process.env,
        MUSIC_PARTY_API_URL: `http://127.0.0.1:${port}`,
        MUSIC_PARTY_PROFILE: profile,
        ELECTRON_RENDERER_URL: '',
      },
    })
  let app = await launch()
  try {
    let player = await app.firstWindow()
    let page = player.locator('body')
    await serveArtwork(
      app,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
        'base64',
      ),
      'image/png',
    )
    const errors: string[] = []
    player.on('pageerror', (error) => errors.push(error.message))
    await expect(player.getByRole('slider', { name: '播放进度' })).toBeVisible()
    await player.evaluate(() => {
      localStorage.setItem(
        'music-party.chat-display.v1',
        JSON.stringify({
          position: 'bottom-left',
          danmaku: true,
        }),
      )
    })
    await player.reload()
    await expect(player.getByRole('slider', { name: '播放进度' })).toBeVisible()
    await expect(player).toHaveTitle(`Music Party ${packageInfo.version} · 官方多人一起听`)
    await player.evaluate(() => {
      document.querySelector('audio')!.muted = true
    })
    expect(await player.evaluate(() => typeof (window as any).require)).toBe('undefined')
    await loginFixture(app, player)
    const rooms = await openTool(app, player, 'room')
    page = rooms
    await page
      .getByLabel('一起听邀请链接')
      .fill('https://st.music.163.com/listen-together/share/?roomId=pair&inviterId=1')
    await page.getByRole('button', { name: '通过链接加入', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('双人一起听')
    await expect(page.getByRole('button', { name: '用当前歌曲创建', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '关闭一起听' }).click()
    page = await openTool(app, player, 'search')
    await expect(page.locator('.panel-titlebar').getByLabel('搜索音乐库')).toBeVisible()
    await expect(page.locator('.music-browser .wide-search')).toHaveCount(0)
    await page.getByLabel('搜索音乐库').fill('111')
    await page.locator('.panel-titlebar').getByLabel('搜索音乐库').press('Enter')
    await expect
      .poll(() => calls.some((call) => call.path === '/song/detail' && call.args.ids === '111'))
      .toBe(true)
    await page.getByRole('button', { name: '播放 测试歌曲111' }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲111')
    await player.screenshot({
      path: 'test-results/header-search-global.png',
      animations: 'disabled',
    })
    const lyrics = await openTool(app, player, 'lyrics')
    const audioElement = await player.locator('audio').elementHandle()
    await expect(page.getByLabel('搜索音乐库')).toHaveValue('111')
    await expect(lyrics.getByLabel('当前歌曲歌词')).toContainText('第二句')
    const translation = player.getByRole('button', { name: '显示歌词翻译' })
    await expect(lyrics.locator('.lyric-translation')).toHaveText('第一句译文')
    await translation.click()
    await expect(lyrics.locator('.lyric-translation')).toHaveCount(0)
    await translation.click()
    await expect(lyrics.locator('.lyric-translation')).toHaveText('第一句译文')
    expect(await audioElement!.evaluate((audio) => audio.isConnected)).toBe(true)
    const libraryContent = page.locator('.panel-content')
    const mainScroll = await libraryContent.evaluate((element) => element.scrollTop)
    await player.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.currentTime = 12
    })
    await expect(lyrics.locator('.lyric-active')).toContainText('第3行歌词')
    await expect(lyrics.locator('.lyric-active')).toBeInViewport()
    await test.step('taller playback windows reveal more lyric rows and keep the active line centered', async () => {
      const original = await (
        await app.browserWindow(player)
      ).evaluate((win) => win.getContentSize())
      const reader = lyrics.getByLabel('当前歌曲歌词')
      const visibleRows = () =>
        reader.evaluate((node) => {
          const view = node.getBoundingClientRect()
          return [...node.querySelectorAll('.lyric-line')].filter((line) => {
            const row = line.getBoundingClientRect()
            return row.top >= view.top && row.bottom <= view.bottom
          }).length
        })
      await widenPanel(app, player, 1100, 590)
      await expect.poll(() => player.evaluate(() => innerHeight)).toBe(590)
      const shortCount = await visibleRows()
      await widenPanel(app, player, 1100, 980)
      await expect.poll(visibleRows).toBeGreaterThan(shortCount + 2)
      await expect
        .poll(() =>
          reader.evaluate((node) => {
            const view = node.getBoundingClientRect()
            const active = node.querySelector('.lyric-active')!.getBoundingClientRect()
            return Math.abs(active.top + active.height / 2 - view.top - view.height / 2)
          }),
        )
        .toBeLessThanOrEqual(1)
      await widenPanel(app, player, original[0], original[1])
    })
    const loginNotice = player.getByRole('button', { name: '关闭播放提示' })
    if (await loginNotice.isVisible()) await loginNotice.click()
    await player.screenshot({
      path: test.info().outputPath('playing-with-lyrics.png'),
      animations: 'disabled',
    })
    await player
      .locator('.adaptive-player-bar')
      .getByRole('button', { name: '播放队列', exact: true })
      .click()
    await expect(player.locator('[data-panel="queue"]')).toBeInViewport()
    await expect(player.locator('[data-panel="queue"]')).toHaveCSS('opacity', '1')
    await player.screenshot({
      path: test.info().outputPath('playing-with-queue.png'),
      animations: 'disabled',
    })
    await player.keyboard.press('Escape')
    expect(await libraryContent.evaluate((element) => element.scrollTop)).toBe(mainScroll)
    await lyrics.getByRole('button', { name: '跳转歌词：第二句', exact: true }).click()
    await expect
      .poll(() =>
        player
          .locator('audio')
          .evaluate((audio: HTMLAudioElement) => audio.currentTime >= 5 && audio.currentTime < 8),
      )
      .toBe(true)
    const bar = player.getByRole('slider', { name: '播放进度' })
    const mainWindow = await app.browserWindow(player)
    const fixed = await mainWindow.evaluate((w) => w.getBounds())
    const track = (await bar.boundingBox())!
    await player.mouse.move(track.x + track.width * 0.2, track.y + track.height / 2)
    await player.mouse.down()
    await player.mouse.move(track.x + track.width * 0.62, track.y + track.height / 2, { steps: 3 })
    await player.mouse.up()
    await expect
      .poll(() => player.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeGreaterThan(17)
    await bar.press('Home')
    await expect.poll(() => bar.inputValue()).toMatch(/^\d{1,3}$/)
    expect(await mainWindow.evaluate((w) => w.getBounds())).toEqual(fixed)
    await player.screenshot({ path: 'test-results/music-party-player-solo.png' })
    page = await openTool(app, player, 'room')
    await page.getByRole('button', { name: '用当前歌曲创建', exact: true }).click()
    await expect(rooms.getByRole('button', { name: '查看房间成员', exact: true })).toContainText(
      '3 人',
    )
    const chat = await openTool(app, player, 'chat')
    const roomLike = player
      .locator('.adaptive-player-bar')
      .getByRole('button', { name: '为房间当前歌曲点赞', exact: true })
    await expect(chat.getByRole('button', { name: /点赞/ })).toHaveCount(0)
    const roomTop = (await chat.locator('.panel-titlebar').boundingBox())!.y
    await roomLike.click()
    await expect(roomLike).toBeDisabled()
    await expect(roomLike).toBeEnabled()
    expect((await chat.locator('.panel-titlebar').boundingBox())!.y).toBe(roomTop)
    expect(
      calls.filter((call) => call.path.endsWith('/song/operate') && call.args.data.operate === 3),
    ).toHaveLength(1)
    expect(calls.filter((call) => call.path === '/like')).toHaveLength(0)

    await openTool(app, player, 'room')
    await rooms.getByRole('button', { name: '查看房间成员' }).click()
    page = await panelPage(app, 'members')
    const roomButton = player.locator('.adaptive-player-bar .footer-room')
    const originalButtonBounds = await roomButton.boundingBox()
    const memberHeader = page.locator('.panel-titlebar')
    const originalHeader = await memberHeader.boundingBox()
    const firstMember = page.locator('.member-directory-row').first()
    const firstMemberY = (await firstMember.boundingBox())!.y
    const roomLabel = roomButton.locator('.footer-room-label')
    const expandedRoom = await player.evaluate(() => matchMedia('(min-width: 1040px)').matches)
    await expect(roomLabel).toBeVisible({ visible: expandedRoom })
    await expect(roomButton.locator('.transport-count')).toBeVisible({ visible: !expandedRoom })
    const fullDirectory = [123, 456, 789, ...Array.from({ length: 9 }, (_, i) => 1000 + i)]
    for (const [index, update] of [
      { count: 1, directory: [123] },
      { count: 12, directory: [123] }, // Online total can precede profile data.
      { count: 12, directory: fullDirectory },
      { count: 3, directory: [123, 456, 789] },
    ].entries()) {
      memberIds = update.directory
      onlineCount = update.count
      await mainWindow.evaluate((win, payload) => win.webContents.send('room-members', payload), {
        roomId: 'multi-test-room',
        version: index + 1,
        onlineCount,
        members: memberIds.map((id) => ({ uid: String(id), nickname: `听友${id}`, avatar: '' })),
      })
      await expect(page.locator('.member-directory-row')).toHaveCount(memberIds.length)
      if (expandedRoom) await expect(roomLabel).toHaveText(`${onlineCount} 人一起听`)
      else await expect(roomButton.locator('.transport-count')).toHaveText(String(onlineCount))
      await expect(roomButton).toHaveAccessibleDescription(`${onlineCount} 人一起听`)
      expect(await roomButton.boundingBox()).toEqual(originalButtonBounds)
      expect(await memberHeader.boundingBox()).toEqual(originalHeader)
      expect((await firstMember.boundingBox())!.y).toBe(firstMemberY)
      await expectRoomHeaderSingleLine(page)
    }
    const playingTitle = player.locator(
      '.footer-track-copy strong:visible, .immersive-song-heading h1:visible',
    )
    const originalTrack = await playingTitle.textContent()
    await player.evaluate(() => window.together.updatePreferences({ language: 'en' }))
    await expect(player.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('.panel-titlebar h1')).toHaveText('Room members')
    await expect(roomButton).toHaveAccessibleName('Listen Together')
    await expect(roomButton).toHaveAccessibleDescription('3 listening')
    await expect(playingTitle).toHaveText(originalTrack!)
    await player.evaluate(() => window.together.updatePreferences({ language: 'zh-CN' }))
    await page.getByRole('button', { name: '关闭房间成员' }).click()
    expect(calls.filter((call) => call.path === '/api/middle/im/chatroom/send')).toHaveLength(0)
    await openTool(app, player, 'room')
    await player
      .locator('.adaptive-player-bar')
      .getByRole('button', { name: '房间聊天', exact: true })
      .click()
    page = chat
    await expect(page.getByRole('log')).toContainText('手机端的聊天内容 <b>原样显示</b>')
    expect(await page.locator('.chat-bubble b').count()).toBe(0)
    const incomingCard = page
      .getByRole('log')
      .locator('article.chat-message')
      .filter({ hasText: '手机端的聊天内容 <b>原样显示</b>' })
    await expect(incomingCard.locator('.chat-author > span')).toHaveText(peerNickname)
    await expect(incomingCard.locator('.chat-author time')).toBeVisible()
    expect(
      await incomingCard.evaluate((card) => {
        const avatar = card.querySelector('.chat-message-avatar')!
        const body = card.querySelector('.chat-message-body')!
        return (
          !body.contains(avatar) &&
          avatar.getBoundingClientRect().right <= body.getBoundingClientRect().left + 1
        )
      }),
    ).toBe(true)
    await expect(page.getByRole('button', { name: '加载更早消息' })).toHaveCount(0)
    await page.getByRole('log').evaluate((box) => {
      box.scrollTop = 0
    })
    await page.getByRole('log').hover()
    await player.mouse.wheel(0, -500)
    await expect(page.getByRole('log')).toContainText('更早的聊天记录')
    await page.getByLabel('聊天内容').fill('桌面端发送测试')
    await page.getByLabel('聊天内容').dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    expect(calls.filter((call) => call.path === '/api/middle/im/chatroom/send')).toHaveLength(0)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByLabel('聊天内容')).toHaveValue('')
    const historyAfterSend = calls.filter((call) => call.path.endsWith('/msg/history')).length
    await expect
      .poll(() => calls.filter((call) => call.path.endsWith('/msg/history')).length, {
        timeout: 10000,
      })
      .toBeGreaterThan(historyAfterSend)
    await expect(page.locator('.chat-bubble').filter({ hasText: '桌面端发送测试' })).toHaveCount(1)
    const outgoingCard = page.locator('article.chat-message.mine').filter({
      hasText: '桌面端发送测试',
    })
    expect(
      await outgoingCard.evaluate((card) => {
        const avatar = card.querySelector('.chat-message-avatar')!.getBoundingClientRect()
        const body = card.querySelector('.chat-message-body')!.getBoundingClientRect()
        return avatar.left >= body.right - 1
      }),
    ).toBe(true)
    const send = calls.find((call) => call.path === '/api/middle/im/chatroom/send')!
    expect(send.args.data.chatroomId).toBe('99887766')
    expect(JSON.parse(send.args.data.clientExt)).toMatchObject({
      roomId: 'multi-test-room',
      ltType: 'MULTI_MATCH_SONG',
    })
    await page.getByLabel('聊天内容').fill('失败测试')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.locator('.chat-failed')).toContainText('发送过于频繁')
    await expect(page.getByLabel('聊天内容')).toHaveValue('失败测试')
    expect(calls.filter((call) => call.path === '/api/middle/im/chatroom/send')).toHaveLength(2)
    await page.getByLabel('聊天内容').fill('')
    chatRecords.push(
      {
        roomId: 'multi-test-room',
        sendUid: 456,
        sendTime: chatStart + 100,
        msgType: 0,
        nickname: '听友456',
        emoji: {
          emojiId: '9',
          emojiGroupId: '8',
          emojiName: '开心',
          emojiImgUrl: 'https://p1.music.126.net/chat-test.gif',
          width: 100,
          height: 100,
          format: 'gif',
        },
        imChatRoomMsgBody: { text: '[开心]' },
      },
      {
        roomId: 'multi-test-room',
        sendUid: 456,
        sendTime: chatStart + 101,
        msgType: 2,
        nickname: '听友456',
        resourceInfo: {
          resourceId: '777',
          bizId: '778',
          title: '聊天推荐歌曲',
          artistName: ['聊天歌手'],
        },
        imChatRoomMsgBody: { text: '推荐了一首歌' },
      },
      {
        roomId: 'multi-test-room',
        sendUid: 0,
        sendTime: chatStart + 102,
        msgType: 3,
        imChatRoomMsgBody: {
          msgRichText: {
            contentTextList: [
              { text: '欢迎 ', highLighted: false },
              { text: '新听友', highLighted: true },
            ],
          },
        },
      },
      {
        roomId: 'multi-test-room',
        sendUid: 456,
        sendTime: chatStart + 103,
        msgType: 1,
        interactType: 3,
        nickname: peerNickname,
        imChatRoomMsgBody: { text: '赞了正在播放的歌曲' },
      },
      {
        roomId: 'multi-test-room',
        sendUid: 456,
        sendTime: chatStart + 104,
        msgType: 3,
        nickname: peerNickname,
        resourceInfo: {
          resourceId: '777',
          bizId: '778',
          title: '聊天推荐歌曲',
          artistName: ['聊天歌手'],
        },
        imChatRoomMsgBody: {
          text: `${peerNickname}来了，带来歌曲 聊天推荐歌曲 - 聊天歌手`,
        },
      },
    )
    const recommendation = page.locator('article.chat-activity[data-activity="recommend"]')
    await expect(recommendation.locator('.chat-activity-heading')).toContainText('推荐', {
      timeout: 10000,
    })
    await expect(recommendation.locator('.chat-activity-icon svg')).toHaveCount(1)
    await expect(recommendation.locator('.chat-activity-heading time')).toBeVisible()
    await expect(recommendation.locator('.chat-activity-text')).toContainText(
      '推荐了一首歌 · 聊天推荐歌曲',
    )
    await expect(recommendation.locator('.chat-activity-song')).toHaveText('聊天推荐歌曲')
    await expect(page.getByRole('log').locator('.chat-activity .message-resource')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '推送 聊天推荐歌曲', exact: true })).toHaveCount(
      0,
    )
    await expect(
      page
        .locator('article.chat-activity')
        .filter({ hasText: '新听友' })
        .locator('.chat-activity-heading'),
    ).toContainText('动态')
    const interaction = page.locator('article.chat-activity').filter({
      hasText: '赞了正在播放的歌曲',
    })
    await expect(interaction).toHaveAttribute('data-activity', 'like')
    await expect(interaction.locator('.chat-activity-heading')).toContainText('点赞')
    await expect(interaction.locator('.chat-activity-actor')).toHaveText(peerNickname)
    const joined = page.locator('article.chat-activity[data-activity="join"]')
    await expect(joined.locator('.chat-activity-heading')).toContainText('加入')
    await expect(joined.locator('.chat-activity-text')).toHaveText(
      `${peerNickname}来了，带来歌曲 聊天推荐歌曲 - 聊天歌手`,
    )
    await expect(joined.locator('.chat-activity-actor')).toHaveText(peerNickname)
    await expect(joined.locator('.chat-activity-song')).toHaveText('聊天推荐歌曲')
    const joinedText = await joined.locator('.chat-activity-text').innerText()
    expect(joinedText.split(peerNickname)).toHaveLength(2)
    expect(joinedText.split('聊天推荐歌曲')).toHaveLength(2)
    expect(
      await page.getByRole('log').evaluate((log) => {
        const bounds = log.getBoundingClientRect()
        return (
          log.scrollWidth <= log.clientWidth + 1 &&
          [
            ...log.querySelectorAll(
              '.chat-message, .chat-activity, .chat-author, .message-resource, .message-image',
            ),
          ].every((card) => {
            const rect = card.getBoundingClientRect()
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
          })
        )
      }),
    ).toBe(true)
    await expect(
      page
        .locator('article.chat-activity')
        .filter({ hasText: '新听友' })
        .locator('.chat-activity-text'),
    ).toContainText('欢迎 新听友')
    await recommendation.scrollIntoViewIfNeeded()
    await player.screenshot({
      path: 'test-results/music-party-room-activity.png',
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '查看图片：开心' }).click()
    await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible()
    await player.mouse.click(5, 5)
    await expect(page.getByRole('dialog', { name: '图片预览' })).toHaveCount(0)
    await expect(page.getByLabel('官方房间聊天', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '表情包', exact: true }).click()
    await page.getByRole('button', { name: '最近使用', exact: true }).click()
    await page.getByRole('button', { name: '发送表情 开心', exact: true }).click()
    await expect
      .poll(() => calls.filter((call) => call.path === '/api/middle/im/chatroom/send').length)
      .toBe(3)
    expect(
      JSON.parse(
        calls.filter((call) => call.path === '/api/middle/im/chatroom/send').at(-1)!.args.data
          .clientExt,
      ).emoji.emojiId,
    ).toBe('9')
    // Panel input matches the mod: text tools insert at the caret, Enter is a newline,
    // and room members can be selected with the keyboard without truncating names.
    const editor = page.getByLabel('聊天内容', { exact: true })
    await editor.fill('前后')
    await editor.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(1, 1))
    await page.getByRole('button', { name: 'Emoji', exact: true }).click()
    const textPicker = player.getByRole('dialog', { name: 'Emoji', exact: true })
    await expect(textPicker).toBeVisible()
    await textPicker.getByRole('button', { name: '😊', exact: true }).click()
    await expect(editor).toHaveValue('前😊后')
    await editor.press('Enter')
    await expect(editor).toHaveValue('前😊\n后')
    await page.getByRole('button', { name: '颜文字', exact: true }).click()
    await player
      .getByRole('dialog', { name: '颜文字', exact: true })
      .getByRole('button', { name: '(T_T)', exact: true })
      .click()
    await expect(editor).toHaveValue('前😊\n(T_T)后')
    await editor.fill('')
    await incomingCard.getByRole('button', { name: `提及 ${peerNickname}`, exact: true }).click()
    await expect(editor).toHaveValue(`@${peerNickname} `)
    await editor.fill('@听友456')
    await expect(page.getByRole('listbox', { name: '提及成员' })).toBeVisible()
    await editor.press('Enter')
    await expect(editor).toHaveValue('@听友456 ')
    await editor.fill('')

    // Chat stays in the panel even if a previous version saved floating/Danmaku settings.
    await expect(page.getByRole('button', { name: '聊天显示设置', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '弹幕设置', exact: true })).toHaveCount(0)
    await expect(page.locator('.floating-room-chat, .room-danmaku-layer')).toHaveCount(0)
    await expect(page.locator('.chat-drawer .chat-messages')).toBeVisible()
    await player.screenshot({ path: 'test-results/music-party-chat.png' })
    await player.keyboard.press('Escape')
    await expect(page.getByLabel('官方房间聊天', { exact: true })).toBeHidden()
    await expect(player.getByLabel('底部播放栏', { exact: true })).toBeVisible()
    await expect(player.getByRole('button', { name: '本机暂停' })).toBeVisible()
    await expect
      .poll(() => player.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThan(4.5)
    await expect
      .poll(() => player.evaluate(() => navigator.mediaSession.metadata?.title))
      .toBe('测试歌曲111')
    expect(
      await app.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('desktop-previous')!.enabled,
      ),
    ).toBe(false)
    const beforeHide = calls.filter((call) => call.path.endsWith('/exit')).length
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() !== 'about:blank')!
        .close(),
    )
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL() !== 'about:blank')!
            .isVisible(),
        ),
      )
      .toBe(false)
    expect(await player.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(false)
    expect(calls.filter((call) => call.path.endsWith('/exit')).length).toBe(beforeHide)
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('desktop-show')!
      item.click(item, undefined, {} as any)
    })
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('desktop-toggle')!
      item.click(item, undefined, {} as any)
    })
    await expect(player.getByRole('button', { name: '恢复同听' })).toBeVisible()
    await openTool(app, player, 'room')
    const roomHeader = rooms.locator('.panel-titlebar')
    const beforeHeartbeat = await roomHeader.boundingBox()
    // Background heartbeats must preserve the header geometry and local pause state.
    synchronizationGate = new Promise<void>((resolve) => {
      releaseSynchronization = resolve
    })
    const heldBeforeSynchronization = heldHeartbeats
    await expect.poll(() => heldHeartbeats).toBeGreaterThan(heldBeforeSynchronization)
    await expectRoomHeaderSingleLine(rooms)
    await expect(rooms.locator('.busy')).toHaveCount(0)
    expect(await roomHeader.boundingBox()).toEqual(beforeHeartbeat)
    const heartbeatCalls = calls.filter((call) => call.path.endsWith('/heartbeat')).length
    synchronizationGate = null
    releaseSynchronization()
    await expect
      .poll(() => calls.filter((call) => call.path.endsWith('/heartbeat')).length)
      .toBeGreaterThan(heartbeatCalls)
    expect(await roomHeader.boundingBox()).toEqual(beforeHeartbeat)
    expect(await player.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
    await player.getByRole('button', { name: '恢复同听' }).click()
    currentSong = '222'
    version++ // A different official-client member changes the room song.
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲222', {
      timeout: 10000,
    })
    const mutationsBeforeWake = calls.filter(
      (call) => call.path.endsWith('/song/operate') || call.path.endsWith('/chatroom/send'),
    ).length
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('suspend')
    })
    await expect
      .poll(() => player.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
      .toBe(true)
    currentSong = '555'
    version++
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('resume')
    })
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲555', {
      timeout: 10000,
    })
    expect(
      calls.filter(
        (call) => call.path.endsWith('/song/operate') || call.path.endsWith('/chatroom/send'),
      ).length,
    ).toBe(mutationsBeforeWake)
    await player.evaluate(() => window.dispatchEvent(new Event('offline')))
    await expect
      .poll(() => player.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
      .toBe(true)
    currentSong = '222'
    version++
    await player.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲222', {
      timeout: 10000,
    })
    page = await openTool(app, player, 'search')
    await page.getByLabel('搜索音乐库').fill('333')
    await page
      .locator('.panel-titlebar .header-search')
      .getByRole('button', { name: '搜索', exact: true })
      .click()
    await page.getByRole('button', { name: '推送 测试歌曲333' }).click()
    const feedback = await panelPage(app, 'feedback')
    await expect(feedback.getByText('已推送「测试歌曲333」到官方多人房间')).toBeVisible()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲222')
    await expect(player.getByLabel('播放进度')).toBeDisabled()
    await player.getByRole('button', { name: '下一首', exact: true }).click()
    await expect(feedback.getByRole('alert')).toHaveText(/没有切歌权限/)
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲222')
    await player.screenshot({ path: 'test-results/music-party-multiplayer.png' })
    page = await openTool(app, player, 'settings')
    await settingsGroup(page, '更新与帮助')
    await page.getByRole('button', { name: '观测记录' }).click()
    page = await panelPage(app, 'diagnostics')
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '导出记录' })).toBeVisible()
    expect(await page.locator('.panel-content').innerText()).not.toContain('mock-secret')
    const chatTrace = page
      .locator('.trace-list button')
      .filter({ hasText: 'multiChatSend' })
      .first()
    await chatTrace.click()
    expect(await page.locator('pre').innerText()).not.toContain('桌面端发送测试')
    expect(await page.locator('pre').innerText()).not.toContain('失败测试')
    await expect(lyrics.getByRole('button', { name: /^跳转歌词/ })).toHaveCount(0)
    // Newest first, including the current occurrence and two earlier performances of track 221.
    played = [
      songInfo().playSong,
      { songId: '221', songBizId: '888', songRcmdUid: 456 },
      { songId: '222', songBizId: '777', songRcmdUid: 789 },
      { songId: '221', songBizId: '666', songRcmdUid: 123 },
    ]
    historyUnavailable = true
    page = await openTool(app, player, 'queue')
    await expect(page.getByRole('dialog', { name: '房间待播列表' })).toBeVisible()
    await test.step('room history keeps distinct plays, supports retry and returns from an artist to the same tab', async () => {
      const listening = page.getByRole('tab', { name: '正在听', exact: true })
      const history = page.getByRole('tab', { name: '听过的', exact: true })
      const pending = page.getByRole('tabpanel', { name: '正在听', exact: true })
      const heard = page.getByRole('tabpanel', { name: '听过的', exact: true })
      const streams = () => calls.filter((call) => call.path === '/song/url/v1').length
      const before = streams()
      await expect(listening).toHaveAttribute('aria-selected', 'true')
      await expect(pending.locator('.queue-playing-copy strong')).toHaveText('测试歌曲222')
      await expect(pending.locator('.queue-track-copy strong')).toHaveText('测试歌曲333')
      await history.click()
      const retry = heard.getByRole('alert').getByRole('button', { name: '重试' })
      await expect(retry).toBeVisible()
      historyUnavailable = false
      await retry.click()
      await expect(heard.locator('.queue-track-copy strong')).toHaveText([
        '测试歌曲221',
        '测试歌曲222',
        '测试歌曲221',
      ])
      await expect(heard.locator('.queue-track-overline')).toHaveText([
        '听友456 推荐',
        '听友789 推荐',
        '听友123 推荐',
      ])
      await expect(heard.getByRole('button', { name: /顶歌|删除推荐/ })).toHaveCount(0)
      const duet = heard.locator('.queue-track').first()
      await expect(duet.getByRole('button', { name: '查看音乐人 音乐人甲' })).toBeVisible()
      await duet.getByRole('button', { name: '查看音乐人 音乐人乙' }).click()
      const artist = await panelPage(app, 'detail-artist-922')
      await expect(artist.locator('.panel-titlebar h1')).toHaveText('音乐人乙')
      await artist
        .getByRole('navigation', { name: '页面导航' })
        .getByRole('button', { name: /^返回/ })
        .click()
      await expect(history).toHaveAttribute('aria-selected', 'true')
      await expect(heard.locator('.queue-track')).toHaveCount(3)
      await listening.click()
      await expect(pending.locator('.queue-playing-copy strong')).toHaveText('测试歌曲222')
      await expect(pending.locator('.queue-track-copy strong')).toHaveText('测试歌曲333')
      expect(await player.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(false)
      expect(streams()).toBe(before)
    })
    expect(app.windows()).toHaveLength(1)
    await player.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '房间待播列表' })).toBeHidden()
    await openTool(app, player, 'room')
    await rooms.getByRole('button', { name: '退出房间', exact: true }).click()
    const confirm = await panelPage(app, 'confirm')
    expect(calls.filter((call) => call.path.endsWith('/exit'))).toHaveLength(0)
    await player.keyboard.press('Escape')
    await expect(player.getByRole('dialog', { name: '离开多人房间？', exact: true })).toHaveCount(0)
    await expect(player.getByLabel('底部播放栏', { exact: true })).toBeVisible()
    await openTool(app, player, 'room')
    await rooms.getByRole('button', { name: '退出房间', exact: true }).click()
    const audio = player.locator('audio')
    await expect
      .poll(() => audio.evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 4))
      .toBe(true)
    await audio.evaluate((element) => {
      element.addEventListener('loadstart', () => element.setAttribute('data-reloaded', ''), {
        once: true,
      })
    })
    await confirm.getByRole('button', { name: '确认离开' }).click()
    await expect(feedback.getByText('已离开多人房间', { exact: true })).toBeVisible()
    expect(await audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(false)
    const leavePosition = await audio.evaluate((a: HTMLAudioElement) => a.currentTime)
    expect(leavePosition).toBeGreaterThan(4)
    await expect
      .poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThan(leavePosition)
    await expect(audio).not.toHaveAttribute('data-reloaded', '')
    page = await openTool(app, player, 'queue')
    await expect(page.getByRole('dialog', { name: '个人播放队列', exact: true })).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)
    await expect(page.locator('.queue-track-copy strong')).toHaveText([
      '测试歌曲221',
      '测试歌曲222',
      '测试歌曲221',
      '测试歌曲222',
      '测试歌曲333',
    ])
    await expect(page.locator('.queue-track').nth(3)).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('button', { name: '清空队列', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭个人播放队列' }).click()
    const localTitle = player.locator('.footer-title:visible, .immersive-song-heading h1:visible')
    await player.getByRole('button', { name: '上一首', exact: true }).click()
    await expect(localTitle).toHaveText('测试歌曲221')
    await player.getByRole('button', { name: '下一首', exact: true }).click()
    await expect(localTitle).toHaveText('测试歌曲222')
    await expect(player.getByRole('button', { name: '下一首', exact: true })).toBeEnabled()
    await expect
      .poll(() => audio.evaluate((a: HTMLAudioElement) => !a.paused && a.duration > 0))
      .toBe(true)
    await audio.evaluate((a: HTMLAudioElement) => {
      a.currentTime = a.duration - 0.1
    })
    await expect(localTitle).toHaveText('测试歌曲333')
    played = []
    const add = calls.find(
      (call) => call.path.endsWith('/song/operate') && call.args.data.operate === 1,
    )!
    expect(add.args.data).toMatchObject({ operate: 1, songId: '333', bizId: '0' })
    expect(
      calls.some(
        (call) => call.path.includes('/play/command') || call.path.includes('/sync/list/command'),
      ),
    ).toBe(false)
    expect(calls.find((call) => call.path.endsWith('/room/create'))!.args.data).toMatchObject({
      type: 1,
      songId: '111',
    })
    page = await openTool(app, player, 'room')
    await page
      .getByLabel('一起听邀请链接')
      .fill(
        String.raw`[官方多人邀请](https://st.music.163.com/listen-together/multishare/index.html?roomId=multi-test-room\&inviterUid=456\&isFLT=false)`,
      )
    await page.getByRole('button', { name: '通过链接加入', exact: true }).click()
    await expect(rooms.getByRole('button', { name: '查看房间成员', exact: true })).toContainText(
      '3 人',
    )
    // The invitation was shared by 456 and the first listed member is 123.
    // The room identifies 789 as the person who created it.
    await expect(
      rooms.locator('.room-facts > div').filter({ hasText: '创建者' }).locator('dd'),
    ).toHaveText('听友789')
    expect(calls.find((call) => call.path.endsWith('/ack'))!.args.data).toMatchObject({
      roomId: 'multi-test-room',
      inviterUid: '456',
      agree: true,
    })
    await openTool(app, player, 'room')
    await rooms.getByRole('button', { name: '退出房间', exact: true }).click()
    await confirm.getByRole('button', { name: '确认离开' }).click()
    await expect(feedback.getByText('已离开多人房间', { exact: true })).toBeVisible()
    // Account is now already in a room on the official phone app. Restore must load music and queue.
    active = true
    currentSong = '444'
    roomLikeCounts.set('1000444', 4) // Four likes from other listeners.
    version++
    page = await openTool(app, player, 'room')
    await expect(page.getByRole('button', { name: '恢复当前房间' })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: '恢复当前房间' }).click()
    await expect(rooms.getByRole('button', { name: '查看房间成员', exact: true })).toContainText(
      '3 人',
    )
    page = await openTool(app, player, 'queue')
    await expect(page.getByRole('dialog', { name: '房间待播列表' })).toBeVisible()
    await expectRoomHeaderSingleLine(page)
    await expect(page.locator('.queue-track')).toHaveCount(1)
    await expect(page.locator('.queue-playing .queue-track-overline')).toHaveText('听友123 推荐')
    await expect(page.locator('.queue-playing .equalizer')).toBeVisible()
    await expect(page.getByRole('button', { name: /点赞/ })).toHaveCount(0)
    const currentSongLike = player.locator('.adaptive-player-bar').getByRole('button', {
      name: '为房间当前歌曲点赞',
      exact: true,
    })
    await expect(currentSongLike).toBeEnabled()
    await expect(currentSongLike).toHaveAttribute('aria-pressed', 'false')
    await expect(currentSongLike.locator('small')).toHaveText('4')
    likeResponseGate = new Promise<void>((resolve) => {
      releaseLikeResponse = resolve
    })
    await currentSongLike.click()
    await expect(currentSongLike).toBeDisabled()
    await expect(page.locator('.busy')).toHaveCount(0)
    // The server has counted this like, but the mutation reply is still pending.
    // A concurrent heartbeat must not make the eventual reply count it again.
    await expect.poll(() => roomLikeCounts.get('1000444')).toBe(5)
    await expect(currentSongLike.locator('small')).toHaveText('5')
    await expect(currentSongLike).toHaveAttribute('aria-pressed', 'false')
    await expect(currentSongLike).toBeDisabled()
    likeResponseGate = null
    releaseLikeResponse()
    await expect(currentSongLike).toHaveAttribute('aria-pressed', 'true')
    await expect(currentSongLike).toBeEnabled()
    await expect(currentSongLike.locator('small')).toHaveText('5')
    await currentSongLike.click()
    await expect(currentSongLike).toBeDisabled()
    await expect(currentSongLike).toBeEnabled()
    await expect(currentSongLike).toHaveAttribute('aria-pressed', 'true')
    await expect(currentSongLike.locator('small')).toHaveText('6')
    const currentSongLikes = calls.filter(
      (call) =>
        call.path.endsWith('/song/operate') &&
        call.args.data.operate === 3 &&
        call.args.data.bizId === '1000444',
    )
    expect(currentSongLikes).toHaveLength(2)
    for (const call of currentSongLikes)
      expect(call.args.data).toMatchObject({
        roomId: 'multi-test-room',
        songId: '444',
        bizId: '1000444',
      })
    await expect(page.locator('.queue-track-copy strong')).toHaveText('测试歌曲333')
    queue = Array.from({ length: 45 }, (_, i) => ({
      songId: String(700 + (i % 5)),
      songBizId: String(900000 + i),
      songRcmdUid: i === 44 ? '0' : '123',
    }))
    queueUnavailable = true
    version++
    const queueError = page.getByRole('alert')
    await expect(queueError.getByRole('button', { name: '重试' })).toBeVisible()
    await expectRoomHeaderSingleLine(page)
    queueUnavailable = false
    await queueError.getByRole('button', { name: '重试' }).click()
    await expect(page.locator('.queue-track')).toHaveCount(45)
    await expect(queueError).toHaveCount(0)
    await expect(page.locator('.queue-track-overline').first()).toHaveText('听友123 推荐')
    const systemRecommendation = page.locator('.queue-track-overline').last()
    await expect(systemRecommendation).toHaveText('系统推荐')
    const centerOffset = await systemRecommendation.evaluate((label) => {
      const icon = label.querySelector('svg')!.getBoundingClientRect()
      const text = label.querySelector('span')!.getBoundingClientRect()
      return Math.abs(icon.y + icon.height / 2 - (text.y + text.height / 2))
    })
    expect(centerOffset).toBeLessThanOrEqual(1)
    await page.locator('.queue-track').nth(2).getByRole('button', { name: /^顶歌/ }).click()
    await expect(page.locator('.queue-track-copy strong').first()).toHaveText('测试歌曲702')
    await expect(
      page.locator('.queue-track').first().getByRole('button', { name: /^顶歌/ }),
    ).toBeDisabled()
    await page
      .locator('.queue-track')
      .first()
      .getByRole('button', { name: /^删除推荐/ })
      .click()
    expect(
      calls.filter((call) => call.path.endsWith('/song/operate') && call.args.data.operate === 7),
    ).toHaveLength(0)
    await page.getByRole('button', { name: '确认删除推荐' }).click()
    await expect(page.locator('.queue-track')).toHaveCount(44)
    expect(queue.filter((song) => song.songId === '702')).toHaveLength(8)

    expect(
      calls
        .filter((call) => call.path.endsWith('/wait/song/list'))
        .map((call) => JSON.parse(call.args.data.page).cursor),
    ).toEqual(expect.arrayContaining(['20', '40']))

    await expect(page.getByRole('button', { name: '清空队列', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('播放模式', { exact: true })).toHaveCount(0)
    await player.screenshot({ path: 'test-results/music-party-room-queue.png' })
    await page.getByRole('button', { name: '关闭房间待播列表' }).click()
    await expect(player.locator('[data-panel="queue"]')).toBeHidden()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲444')
    await player.screenshot({ path: test.info().outputPath('player-room.png') })
    heartbeatSeconds = 30
    await openTool(app, player, 'room')
    // A heartbeat may already have negotiated the slower interval while the drawer opened.
    await expect.poll(() => lastHeartbeatSeconds).toBe(30)
    const beforeBoundaryMutations = calls.filter((call) =>
      call.path.endsWith('/song/operate'),
    ).length
    boundaryChecks = 0
    const boundaryStart = Date.now()
    await player.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.currentTime = audio.duration
      audio.dispatchEvent(new Event('ended'))
    })
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲666', {
      timeout: 5000,
    })
    expect(Date.now() - boundaryStart).toBeLessThan(5000)
    expect(boundaryChecks).toBeGreaterThanOrEqual(2)
    expect(calls.filter((call) => call.path.endsWith('/song/operate')).length).toBe(
      beforeBoundaryMutations,
    )
    boundaryChecks = -1
    currentSong = '444'
    version++
    await openTool(app, player, 'room')
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('resume')
    })
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲444')

    await expect
      .poll(() => player.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThan(4.5)
    expect(calls.filter((call) => call.path.endsWith('/ack'))).toHaveLength(1)
    expect(calls.filter((call) => call.path.endsWith('/room/create'))).toHaveLength(1)
    page = await openTool(app, player, 'library')
    await expect(page.getByText('全部歌单 · 51 个')).toBeVisible()
    await expect(page.locator('.panel-titlebar h1')).toHaveText('音乐库')
    await expect(page.locator('main > .section-heading')).toHaveCount(0)
    await expect(page.locator('.music-browser h2')).toHaveCount(0)
    await page.locator('.panel-titlebar').getByLabel('搜索当前歌单列表').fill('歌单1')
    await expect(page.getByRole('button', { name: /^歌单2 / })).toHaveCount(0)
    await page.getByRole('button', { name: /^歌单1 205/ }).click()
    page = await panelPage(app, 'detail-playlist-1')
    await expect(page.locator('.panel-titlebar h1')).toHaveText('歌单1')
    await expect(page.locator('.panel-titlebar').getByLabel('搜索当前歌单或专辑')).toHaveValue('')
    await expect(page.locator('.music-browser input[type="search"]')).toHaveCount(0)
    await expect(page.getByText('已加载 100 / 205 首')).toBeVisible()
    await expect(page.getByRole('button', { name: '加载更多歌曲' })).toHaveCount(0)
    await page.locator('.panel-titlebar').getByLabel('搜索当前歌单或专辑').fill('5204')
    await expect(page.getByRole('button', { name: '推送 测试歌曲5204', exact: true })).toBeVisible()
    await expect(page.getByText('找到 1 首', { exact: true })).toBeVisible()
    await player.screenshot({
      path: 'test-results/header-search-playlist.png',
      animations: 'disabled',
    })
    await expect(page.getByRole('button', { name: '推送 测试歌曲5000', exact: true })).toHaveCount(
      0,
    )
    await page.getByRole('button', { name: '推送 测试歌曲5204', exact: true }).click()
    await page.getByRole('button', { name: '清空列表搜索' }).click()
    await expect(page.getByText('已加载 205 / 205 首')).toBeVisible()
    await page.getByRole('button', { name: '推送 测试歌曲5000' }).click()
    expect(
      calls
        .filter((call) => call.path.endsWith('/song/operate') && call.args.data.operate === 1)
        .at(-1)!.args.data.songId,
    ).toBe('5000')
    await page
      .getByRole('navigation', { name: '页面导航' })
      .getByRole('button', { name: /^返回/ })
      .click()
    page = await openTool(app, player, 'library')
    await expect(page.locator('.panel-titlebar h1')).toHaveText('音乐库')
    await expect(page.getByLabel('搜索当前歌单列表')).toHaveValue('歌单1')
    await expect(page.getByRole('button', { name: /^歌单2 / })).toHaveCount(0)
    await page.getByRole('button', { name: '清空列表搜索', exact: true }).click()
    await expect(page.getByRole('button', { name: /^歌单2 / })).toBeVisible()
    await player
      .locator('.main-sidebar')
      .getByRole('button', { name: '我喜欢的音乐', exact: true })
      .click()
    page = await panelPage(app, 'liked')
    await expect(page.getByText('已加载 2 / 2 首')).toBeVisible()
    await page.getByRole('button', { name: '取消喜欢 测试歌曲111', exact: true }).click()
    await expect(
      player.getByRole('dialog', { name: '取消喜欢这首歌？', exact: true }),
    ).toBeVisible()
    expect(calls.filter((call) => call.path === '/like')).toHaveLength(0)
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await expect(player.getByRole('dialog', { name: '取消喜欢这首歌？', exact: true })).toHaveCount(
      0,
    )
    await expect(
      page.getByRole('button', { name: '取消喜欢 测试歌曲111', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '取消喜欢 测试歌曲111', exact: true }).click()
    await confirm.getByRole('button', { name: '确认取消喜欢' }).click()
    await expect(page.getByText('已加载 1 / 1 首')).toBeVisible()
    expect(calls.find((call) => call.path === '/like')!.args.like).toBe('false')
    await openTool(app, player, 'lyrics')
    await expect(lyrics.getByLabel('当前歌曲歌词')).toContainText('第二句')
    await openTool(app, player, 'room')
    await rooms.getByRole('button', { name: '退出房间', exact: true }).click()
    await confirm.getByRole('button', { name: '确认离开' }).click()
    await expect(feedback.getByText('已离开多人房间', { exact: true })).toBeVisible()
    page = await openTool(app, player, 'library')
    await page.getByRole('button', { name: /^歌单10 2599/ }).click()
    page = await panelPage(app, 'detail-playlist-10')
    await expect(page.getByRole('button', { name: '播放全部' })).toBeEnabled()
    await page.getByRole('button', { name: '播放全部' }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲5000')
    await player.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.currentTime = audio.duration
      audio.dispatchEvent(new Event('ended'))
    })
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('测试歌曲5001', {
      timeout: 10000,
    })
    page = await openTool(app, player, 'queue')
    await expect(page.getByText('2599 首', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '个人播放队列' })).toBeVisible()
    await expect(page.getByRole('button', { name: '显示更多', exact: true })).toHaveCount(0)
    const queueList = page.locator('.queue-drawer-list')
    const queueRows = queueList.locator('.queue-track')
    await expect(queueRows).toHaveCount(100)
    await expect
      .poll(
        async () => {
          await queueList.evaluate((element) => {
            element.scrollTop = element.scrollHeight
          })
          return queueRows.count()
        },
        { intervals: [25, 50, 100], timeout: 15000 },
      )
      .toBe(2599)
    const originalSize = await player.evaluate(() => [innerWidth, innerHeight])
    await player.evaluate(() => window.together.updatePreferences({ fontScale: 150 }))
    for (const [width, height] of [
      [321, 682],
      [740, 590],
    ]) {
      await widenPanel(app, player, width, height)
      await expectQueueHeaderFits(page)
      await queueRows.last().scrollIntoViewIfNeeded()
      const bounds = await queueList.evaluate((list) => {
        const rows = list.querySelectorAll('.queue-track')
        return [99, 100, 999, 1000, 2599].map((n) => {
          const index = rows[n - 1].querySelector('.queue-index')!
          const digits = document.createRange()
          digits.selectNodeContents(index)
          return {
            right: digits.getBoundingClientRect().right,
            cover: index.nextElementSibling!.getBoundingClientRect().left,
          }
        })
      })
      for (const row of bounds) {
        expect(row.right).toBeCloseTo(bounds[0].right, 0)
        expect(row.cover - row.right).toBeGreaterThanOrEqual(7)
      }
      const toolbar = page.locator('.queue-toolbar')
      const centers = await toolbar.evaluate((el) => {
        const bar = el.getBoundingClientRect()
        return [...el.children].map((child) => {
          const rect = child.getBoundingClientRect()
          return rect.y + rect.height / 2 - bar.y - bar.height / 2
        })
      })
      for (const offset of centers) expect(Math.abs(offset)).toBeLessThanOrEqual(1)
      // At fractional zoom the bottom border can land between device pixels.
      const lastRow = await queueRows.last().boundingBox()
      const viewport = await queueList.boundingBox()
      expect(lastRow!.y).toBeGreaterThanOrEqual(viewport!.y - 1)
      expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height + 1)
    }
    await player.evaluate(() => window.together.updatePreferences({ fontScale: 100 }))
    await widenPanel(app, player, originalSize[0], originalSize[1])
    await player.screenshot({ path: 'test-results/music-party-library.png' })
    await page.getByRole('button', { name: '关闭个人播放队列' }).click()
    page = await openTool(app, player, 'search')
    await page.getByLabel('搜索音乐库').fill('分页测试')
    await page
      .locator('.panel-titlebar .header-search')
      .getByRole('button', { name: '搜索', exact: true })
      .click()
    for (const [kind, selector] of [
      ['歌曲', '.song-row:not(.list-label)'],
      ['歌单', '.playlist-card'],
      ['歌手', '.artist-card'],
    ] as const) {
      if (kind !== '歌曲')
        await page.locator('.filter-tabs').getByRole('button', { name: kind, exact: true }).click()
      await expect(page.locator(selector)).toHaveCount(30)
      await expect(page.getByRole('button', { name: '加载更多结果' })).toHaveCount(0)
      await page.locator('.panel-content').evaluate((element) => {
        element.scrollTop = element.scrollHeight
        element.dispatchEvent(new Event('scroll'))
        element.dispatchEvent(new Event('scroll'))
      })
      await expect(page.locator(selector)).toHaveCount(60)
      await page.locator('.panel-content').evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect(page.locator(selector)).toHaveCount(65)
    }
    expect(
      calls
        .filter((call) => call.path === '/cloudsearch' && call.args.keywords === '分页测试')
        .map((call) => [Number(call.args.type), Number(call.args.offset || 0)]),
    ).toEqual([
      [1, 0],
      [1, 30],
      [1, 60],
      [1000, 0],
      [1000, 30],
      [1000, 60],
      [100, 0],
      [100, 30],
      [100, 60],
    ])
    await page.locator('.filter-tabs').getByRole('button', { name: '歌曲', exact: true }).click()
    await page.getByLabel('搜索音乐库').fill('测试')
    await page
      .locator('.panel-titlebar .header-search')
      .getByRole('button', { name: '搜索', exact: true })
      .click()
    await expect(page.getByRole('button', { name: '播放 搜索歌曲' })).toBeVisible()
    await page.locator('.filter-tabs').getByRole('button', { name: '歌单', exact: true }).click()
    await expect(page.getByRole('button', { name: /搜索歌单/ })).toBeVisible()
    await page.locator('.filter-tabs').getByRole('button', { name: '歌手', exact: true }).click()
    await page.getByRole('button', { name: '搜索歌手', exact: true }).click()
    page = await panelPage(app, 'detail-artist-501')
    await expect(page.getByRole('button', { name: '播放 歌手歌曲' })).toBeVisible()
    await expect(page.locator('.panel-titlebar h1')).toHaveText('搜索歌手')
    const artistSearch = page.locator('.panel-titlebar').getByLabel('搜索当前歌手歌曲')
    await artistSearch.fill('不存在的歌手歌曲')
    await expect(page.getByRole('button', { name: '播放 歌手歌曲' })).toHaveCount(0)
    await expect(page.getByText('没有找到匹配歌曲', { exact: true })).toBeVisible()
    await artistSearch.fill('歌手')
    await expect(page.getByRole('button', { name: '播放 歌手歌曲' })).toBeVisible()
    await page.getByRole('button', { name: '清空列表搜索', exact: true }).click()
    await expect(artistSearch).toHaveValue('')
    await expect(page.getByRole('button', { name: '播放 歌手歌曲' })).toBeVisible()
    await page
      .getByRole('navigation', { name: '页面导航' })
      .getByRole('button', { name: /^返回/ })
      .click()
    page = await openTool(app, player, 'search')
    const searches = calls.filter((call) => call.path === '/cloudsearch').length
    await page.getByRole('button', { name: '删除搜索记录 111', exact: true }).click()
    await expect(page.getByRole('button', { name: '删除搜索记录 111', exact: true })).toHaveCount(0)
    expect(calls.filter((call) => call.path === '/cloudsearch')).toHaveLength(searches)
    expect(
      await player.evaluate(() => JSON.parse(localStorage.getItem('music-party-search-history')!)),
    ).not.toContain('111')
    await page.getByRole('button', { name: '清空搜索记录' }).click()
    await expect(page.locator('.search-history')).toHaveCount(0)
    page = await openTool(app, player, 'library')
    await page.getByRole('button', { name: '收藏的专辑', exact: true }).click()
    page = await panelPage(app, 'albums')
    await expect(page.getByText('全部专辑 · 51 张')).toBeVisible()
    await expect(page.locator('.panel-titlebar h1')).toHaveText('收藏的专辑')
    await page.getByLabel('搜索当前专辑列表').fill('收藏专辑1')
    await expect(page.getByRole('button', { name: /^收藏专辑2 / })).toHaveCount(0)
    await page.getByRole('button', { name: /^收藏专辑1 专辑歌手/ }).click()
    page = await panelPage(app, 'detail-album-8000')
    await expect(page.locator('.panel-titlebar h1')).toHaveText('收藏专辑1')
    await expect(page.getByText('已加载 2 / 2 首')).toBeVisible()
    await expect(page.getByRole('button', { name: '播放 专辑第一首', exact: true })).toBeVisible()
    await expect(page.getByLabel('搜索当前歌单或专辑')).toHaveValue('')
    await page.getByLabel('搜索当前歌单或专辑').fill('不存在的歌曲')
    await expect(page.getByText('没有找到匹配歌曲', { exact: true })).toBeVisible()
    await page.getByLabel('搜索当前歌单或专辑').fill('  专辑歌手  收藏专辑1  ')
    await expect(page.getByRole('button', { name: '播放 专辑第二首', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '播放搜索结果', exact: true }).click()
    await expect
      .poll(() => calls.filter((call) => call.path === '/song/url/v1').at(-1)?.args.id)
      .toBe('6100')
    page = await openTool(app, player, 'queue')
    await expect(page.getByText('1 首', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭个人播放队列' }).click()
    page = await panelPage(app, 'detail-album-8000')
    await page.getByLabel('搜索当前歌单或专辑').press('Escape')
    await expect(page.getByRole('button', { name: '播放 专辑第二首', exact: true })).toBeVisible()
    await page
      .getByRole('navigation', { name: '页面导航' })
      .getByRole('button', { name: /^返回/ })
      .click()
    page = await panelPage(app, 'albums')
    await expect(page.getByLabel('搜索当前专辑列表')).toHaveValue('收藏专辑1')
    await page.getByLabel('搜索当前专辑列表').fill('没有这个专辑')
    await expect(page.getByText('没有找到匹配专辑', { exact: true })).toBeVisible()
    await page.getByLabel('搜索当前专辑列表').press('Escape')
    await expect(page.getByRole('button', { name: /^收藏专辑2 / })).toBeVisible()
    await player.screenshot({ path: 'test-results/music-party-album.png' })
    expect(errors).toEqual([])
    const invalid = await player.evaluate(() =>
      window.together.call({ method: 'multiStatus', args: { cookie: 'bad' } }),
    )
    expect(invalid.ok).toBe(false)
    await test.step('quitting preserves the room; leaving while paused persists its queue and cursor', async () => {
      async function reopenPlayer() {
        app = await launch()
        player = await app.firstWindow()
        const signedIn = await player.evaluate(async () => {
          const reply = await window.together.call({ method: 'account' })
          return !!reply.data?.data?.profile
        })
        if (!signedIn) await loginFixture(app, player)
      }
      const exits = () => calls.filter((call) => call.path.endsWith('/match/exit')).length
      const previousExits = exits()
      const displayedTrack = () =>
        player.locator('.footer-title:visible, .immersive-song-heading h1:visible')
      const setup = await openTool(app, player, 'room')
      const matchPicker = () => player.getByRole('dialog', { name: '切换歌曲', exact: true })
      const rememberedSearch = '重启后选歌'
      await setup.getByRole('button', { name: '切换歌曲', exact: true }).click()
      await matchPicker().getByRole('searchbox').fill(rememberedSearch)
      await matchPicker().getByRole('searchbox').press('Enter')
      await player.keyboard.press('Escape')
      await setup.getByRole('button', { name: '用当前歌曲创建', exact: true }).click()
      await expect(setup.locator('.room-count')).toBeVisible()
      await app.close()
      expect(exits()).toBe(previousExits)
      expect(active).toBe(true)
      currentSong = '987654'
      played = [{ songId: '987653', songBizId: '73', songRcmdUid: 456 }]
      queue = [{ songId: '987655', songBizId: '75', songRcmdUid: 789 }]
      version++
      await reopenPlayer()
      await expect(displayedTrack()).toHaveText('测试歌曲987654')
      await player.getByRole('button', { name: '本机暂停', exact: true }).click()
      await expect(player.getByRole('button', { name: '恢复同听', exact: true })).toBeVisible()
      const pausedPosition = await player
        .locator('audio')
        .evaluate((a: HTMLAudioElement) => a.currentTime)
      const restored = await openTool(app, player, 'room')
      await restored.getByRole('button', { name: '切换歌曲', exact: true }).click()
      await expect(
        matchPicker().getByRole('button', { name: rememberedSearch, exact: true }),
      ).toBeVisible()
      await matchPicker()
        .getByRole('button', { name: `删除搜索记录 ${rememberedSearch}`, exact: true })
        .click()
      await expect(
        matchPicker().getByRole('button', { name: rememberedSearch, exact: true }),
      ).toHaveCount(0)
      await player.keyboard.press('Escape')
      await restored.getByRole('button', { name: '退出房间', exact: true }).click()
      await player.getByRole('button', { name: '确认离开' }).click()
      await expect(player.getByText('已离开多人房间', { exact: true })).toBeVisible()
      await expect(displayedTrack()).toHaveText('测试歌曲987654')
      expect(
        await player.locator('audio').evaluate((element) => (element as HTMLAudioElement).paused),
      ).toBe(true)
      expect(
        await player.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime),
      ).toBeCloseTo(pausedPosition, 1)
      await app.close()
      await reopenPlayer()
      const personalQueue = await openTool(app, player, 'queue')
      await expect(personalQueue.getByRole('heading', { name: '个人播放队列' })).toBeVisible()
      await expect(personalQueue.locator('.queue-track-copy strong')).toHaveText([
        '测试歌曲987653',
        '测试歌曲987654',
        '测试歌曲987655',
      ])
      await expect(personalQueue.locator('.queue-track[aria-current=true]')).toContainText(
        '测试歌曲987654',
      )
      await personalQueue.getByRole('button', { name: '清空队列' }).click()
      await player.reload()
      await expect((await openTool(app, player, 'queue')).getByText('队列还是空的')).toBeVisible()
      expect(exits()).toBe(previousExits + 1)
    })
  } finally {
    synchronizationGate = null
    releaseSynchronization()
    likeResponseGate = null
    releaseLikeResponse()
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

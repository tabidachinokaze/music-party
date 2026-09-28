import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import packageInfo from '../../package.json'

test('official multiplayer lifecycle with three members, remote song changes and add-song semantics', async () => {
  let active = false,
    currentSong = '111',
    version = 1,
    port = 0
  let queue: any[] = []
  let heartbeatSeconds = 1,
    boundaryChecks = -1
  let liked = ['111', '112']
  let memberIds = [123, 456, 789]
  const chatStart = Date.now()
  const chatRecords: any[] = [
    {
      roomId: 'multi-test-room',
      sendUid: 456,
      sendTime: chatStart,
      nickname: '听友456',
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
  })
  const snapshot = () => ({
    roomId: 'multi-test-room',
    roomPlaySongInfo: songInfo(),
    multiRoomInfoDTO: { chatRoomId: '99887766', roomType: 'MULTI_MATCH_SONG' },
    multiLtRoomUserAgg: {
      onlineNums: memberIds.length,
      onlineUserInfos: memberIds.map((uid) => ({ uid, nickname: `听友${uid}`, avatar: '' })),
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
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname
    if (path === '/audio.wav') {
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('Accept-Ranges', 'bytes')
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/)
      if (range) {
        const start = Number(range[1]),
          end = range[2] ? Math.min(Number(range[2]), pcm.length - 1) : pcm.length - 1
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${pcm.length}`)
        res.setHeader('Content-Length', end - start + 1)
        res.end(pcm.subarray(start, end + 1))
      } else {
        res.setHeader('Content-Length', pcm.length)
        res.end(pcm)
      }
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
        body = { code: 200, data: { success: true, multiLtRoomSnapshot: snapshot() } }
        break
      case '/api/listen/together/multi/match/ack':
        active = true
        body = { code: 200, data: { success: true, multiLtRoomSnapshot: snapshot() } }
        break
      case '/api/listen/together/multi/match/wait/song/list': {
        const cursor = JSON.parse(args.data.page).cursor
        const offset = Number(cursor || 0)
        const list = [songInfo().playSong, ...queue].map((song) => ({
          songInfo: {
            resourceId: song.songId,
            bizId: song.songBizId,
            title: `测试歌曲${song.songId}`,
            artistName: ['测试歌手'],
            coverUrl: '',
          },
          rcmdUid: song.songRcmdUid,
          nickname: `听友${song.songRcmdUid}`,
        }))
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
        body = {
          code: 200,
          data: { heartBeatDuration: heartbeatSeconds, roomPlaySongInfo: songInfo() },
        }
        break
      case '/api/listen/together/multi/match/song/operate':
        if (args.data.operate === 4) {
          body = { code: 200, data: { failedCode: 10000, failedMsg: '没有切歌权限' } }
          break
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
              ar: [{ name: '测试歌手' }],
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
            trackCount: 205,
            creator: { userId: i % 2 === 0 ? 123 : 456, nickname: '歌单作者' },
          })),
        }
        break
      }
      case '/playlist/detail':
        body = {
          code: 200,
          playlist: { trackIds: Array.from({ length: 205 }, (_, i) => ({ id: 5000 + i })) },
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
  const app = await electron.launch({
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
  try {
    const page = await app.firstWindow()
    await page.route('https://p1.music.126.net/chat-test.gif', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    )
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('heading', { name: '好音乐，一起听。' })).toBeVisible()
    await expect(page.locator('.version b')).toHaveText(packageInfo.version)
    await expect(page).toHaveTitle(`Music Party ${packageInfo.version} · 官方多人一起听`)
    await page.evaluate(() => {
      document.querySelector('audio')!.muted = true
    })
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
    await page.getByRole('button', { name: '扫码登录', exact: true }).click()
    await expect(page.getByText('测试听友', { exact: true })).toBeVisible()
    await expect(
      page.locator('.sidebar').getByRole('button', { name: '个人队列', exact: true }),
    ).toHaveCount(0)
    await expect(
      page.locator('.sidebar').getByRole('button', { name: '歌词', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: '一起听', exact: true }).click()
    await page
      .getByLabel('一起听邀请链接')
      .fill('https://st.music.163.com/listen-together/share/?roomId=pair&inviterId=1')
    await page.getByRole('button', { name: '加入房间', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('双人一起听')
    await expect(page.getByRole('button', { name: '创建多人一起听' })).toBeDisabled()
    await page.getByRole('button', { name: '关闭一起听' }).click()
    await page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByLabel('搜索音乐库').fill('111')
    await page.locator('.wide-search').getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('button', { name: '播放 测试歌曲111' }).click()
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲111')
    const audioElement = await page.locator('audio').elementHandle()
    await page.getByRole('button', { name: '打开播放界面' }).click()
    await expect(page.locator('.sidebar')).toBeHidden()
    await expect(page.locator('.music-header')).toBeHidden()
    expect((await page.locator('.workspace').boundingBox())!.x).toBe(0)
    expect((await page.locator('.workspace').boundingBox())!.width).toBe(
      await page.evaluate(() => innerWidth),
    )
    await page.getByRole('button', { name: '收起播放界面' }).click()
    await expect(page.getByLabel('搜索音乐库')).toHaveValue('111')
    await expect(page.getByRole('button', { name: '播放 测试歌曲111' })).toBeVisible()
    expect(await audioElement!.evaluate((audio) => audio.isConnected)).toBe(true)
    await page.getByRole('button', { name: '打开播放界面' }).click()
    await expect(page.getByLabel('播放界面').getByLabel('当前歌曲歌词')).toContainText('第二句')
    const mainScroll = await page.locator('main').evaluate((element) => element.scrollTop)
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.currentTime = 12
    })
    await expect
      .poll(() => page.getByLabel('当前歌曲歌词').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
    expect(await page.locator('main').evaluate((element) => element.scrollTop)).toBe(mainScroll)
    await page.getByRole('button', { name: '跳转歌词：第二句', exact: true }).click()
    await expect
      .poll(() =>
        page
          .locator('audio')
          .evaluate((audio: HTMLAudioElement) => audio.currentTime >= 5 && audio.currentTime < 8),
      )
      .toBe(true)
    await page.screenshot({ path: 'test-results/music-party-player-solo.png' })
    await page.getByRole('button', { name: '一起听', exact: true }).click()
    await page.getByRole('button', { name: '创建多人一起听' }).click()
    await expect(page.getByRole('heading', { name: '3 人一起听' })).toBeVisible()
    await expect(page.locator('.member')).toHaveCount(3)
    await page.getByRole('button', { name: '查看房间成员' }).click()
    memberIds = [123, 456, 789, 1000]
    await page.getByRole('button', { name: '刷新成员', exact: true }).click()
    await expect(page.getByRole('heading', { name: '4 人一起听' })).toBeVisible()
    await expect(page.locator('.member')).toHaveCount(4)
    memberIds = [123, 456, 789]
    await page.getByRole('button', { name: '刷新成员', exact: true }).click()
    await expect(page.locator('.member')).toHaveCount(3)
    await page.getByRole('button', { name: '关闭房间成员' }).click()
    expect(calls.filter((call) => call.path === '/api/middle/im/chatroom/send')).toHaveLength(0)
    await page.getByRole('button', { name: '房间聊天', exact: true }).click()
    await expect(page.getByRole('log')).toContainText('手机端的聊天内容 <b>原样显示</b>')
    expect(await page.locator('.chat-bubble b').count()).toBe(0)
    await page.getByRole('button', { name: '加载更早消息' }).click()
    await expect(page.getByRole('log')).toContainText('更早的聊天记录')
    await page.getByLabel('聊天内容').fill('桌面端发送测试')
    await page.getByLabel('聊天内容').dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    expect(calls.filter((call) => call.path === '/api/middle/im/chatroom/send')).toHaveLength(0)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByLabel('聊天内容')).toHaveValue('')
    await page.getByRole('button', { name: '刷新聊天', exact: true }).click()
    await expect(page.locator('.chat-bubble').filter({ hasText: '桌面端发送测试' })).toHaveCount(1)
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
    )
    await page.getByRole('button', { name: '刷新聊天', exact: true }).click()
    await expect(page.getByRole('button', { name: '推送 聊天推荐歌曲', exact: true })).toBeVisible()
    await expect(
      page.getByRole('log').locator('strong').filter({ hasText: '新听友' }),
    ).toBeVisible()
    await page.getByRole('button', { name: '查看图片：开心' }).click()
    await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(page.getByRole('dialog', { name: '图片预览' })).toHaveCount(0)
    await expect(page.getByLabel('官方房间聊天', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '选择表情', exact: true }).click()
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
    await page.screenshot({ path: 'test-results/music-party-chat.png' })
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('官方房间聊天', { exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: '收起播放界面' })).toBeVisible()
    await expect(page.getByRole('button', { name: '本机暂停' })).toBeVisible()
    await expect
      .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThan(4.5)
    await expect
      .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title))
      .toBe('测试歌曲111')
    expect(
      await app.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('desktop-previous')!.enabled,
      ),
    ).toBe(false)
    const beforeHide = calls.filter((call) => call.path.endsWith('/exit')).length
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
      .toBe(false)
    expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(false)
    expect(calls.filter((call) => call.path.endsWith('/exit')).length).toBe(beforeHide)
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('desktop-show')!
      item.click(item, undefined, {} as any)
    })
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('desktop-toggle')!
      item.click(item, undefined, {} as any)
    })
    await expect(page.getByRole('button', { name: '恢复同听' })).toBeVisible()
    await page.getByRole('button', { name: '立即同步' }).click()
    expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
    await page.getByRole('button', { name: '恢复同听' }).click()
    currentSong = '222'
    version++ // A different official-client member changes the room song.
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲222', { timeout: 10000 })
    const mutationsBeforeWake = calls.filter(
      (call) => call.path.endsWith('/song/operate') || call.path.endsWith('/chatroom/send'),
    ).length
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('suspend')
    })
    await expect
      .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
      .toBe(true)
    currentSong = '555'
    version++
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('resume')
    })
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲555', { timeout: 10000 })
    expect(
      calls.filter(
        (call) => call.path.endsWith('/song/operate') || call.path.endsWith('/chatroom/send'),
      ).length,
    ).toBe(mutationsBeforeWake)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await expect
      .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
      .toBe(true)
    currentSong = '222'
    version++
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲222', { timeout: 10000 })
    await page.getByRole('button', { name: '收起播放界面' }).click()
    await page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByLabel('搜索音乐库').fill('333')
    await page.locator('.wide-search').getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('button', { name: '推送 测试歌曲333' }).click()
    await expect(page.getByText('已推送「测试歌曲333」到官方多人房间')).toBeVisible()
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲222')
    await expect(page.getByLabel('播放进度')).toBeDisabled()
    await page.getByRole('button', { name: '打开播放界面' }).click()
    await page.getByRole('button', { name: '下一首', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(/没有切歌权限/)
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲222')
    await page.screenshot({ path: 'test-results/music-party-multiplayer.png' })
    await page.getByRole('button', { name: '收起播放界面' }).click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '观测记录' }).click()
    expect(await page.locator('main').innerText()).not.toContain('mock-secret')
    const chatTrace = page
      .locator('.trace-list button')
      .filter({ hasText: 'multiChatSend' })
      .first()
    await chatTrace.click()
    expect(await page.locator('pre').innerText()).not.toContain('桌面端发送测试')
    expect(await page.locator('pre').innerText()).not.toContain('失败测试')
    await page.getByRole('button', { name: '正在播放', exact: true }).click()
    await expect(page.getByRole('button', { name: /^跳转歌词/ })).toHaveCount(0)
    await page.getByRole('button', { name: '播放队列', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '房间待播列表' })).toBeVisible()
    await page.locator('.album-artwork').click()
    await expect(page.getByRole('dialog', { name: '房间待播列表' })).toHaveCount(0)
    await page.getByRole('button', { name: '播放队列', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '房间待播列表' })).toHaveCount(0)
    await page.getByRole('button', { name: '离开房间', exact: true }).click()
    expect(calls.filter((call) => call.path.endsWith('/exit'))).toHaveLength(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '离开多人房间？' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '收起播放界面' })).toBeVisible()
    await page.getByRole('button', { name: '离开房间', exact: true }).click()
    await page.getByRole('button', { name: '确认离开' }).click()
    await expect(page.getByText('已离开多人房间', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '播放队列', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '播放队列', exact: true })).toBeVisible()
    await expect(page.locator('.queue-track-copy strong')).toHaveText('测试歌曲111')
    await expect(page.getByRole('button', { name: '清空队列', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭播放队列' }).click()
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
    await page.getByRole('button', { name: '一起听', exact: true }).click()
    await page
      .getByLabel('一起听邀请链接')
      .fill(
        String.raw`[官方多人邀请](https://st.music.163.com/listen-together/multishare/index.html?roomId=multi-test-room\&inviterUid=456\&isFLT=false)`,
      )
    await page.getByRole('button', { name: '加入房间', exact: true }).click()
    await expect(page.getByRole('heading', { name: '3 人一起听' })).toBeVisible()
    expect(calls.find((call) => call.path.endsWith('/ack'))!.args.data).toMatchObject({
      roomId: 'multi-test-room',
      inviterUid: '456',
      agree: true,
    })
    await page.getByRole('button', { name: '离开房间', exact: true }).click()
    await page.getByRole('button', { name: '确认离开' }).click()
    await expect(page.getByText('已离开多人房间', { exact: true })).toBeVisible()
    // Account is now already in a room on the official phone app. Restore must load music and queue.
    active = true
    currentSong = '444'
    version++
    await page.getByRole('button', { name: '一起听', exact: true }).click()
    await page.getByRole('button', { name: '恢复当前房间' }).click()
    await expect(page.getByRole('heading', { name: '3 人一起听' })).toBeVisible()
    await page.getByRole('button', { name: '播放队列', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '房间待播列表' })).toBeVisible()
    await expect(page.getByText('1 首待播', { exact: true })).toBeVisible()
    await expect(page.locator('.queue-track-copy strong')).toHaveText('测试歌曲333')
    queue = Array.from({ length: 45 }, (_, i) => ({
      songId: String(700 + (i % 5)),
      songBizId: String(900000 + i),
      songRcmdUid: '123',
    }))
    version++
    await page.getByRole('button', { name: '刷新待播列表' }).click()
    await expect(page.getByText('45 首待播', { exact: true })).toBeVisible()
    await expect(page.locator('.queue-track')).toHaveCount(45)
    expect(
      calls
        .filter((call) => call.path.endsWith('/wait/song/list'))
        .map((call) => JSON.parse(call.args.data.page).cursor),
    ).toEqual(expect.arrayContaining(['20', '40']))

    await expect(page.getByRole('button', { name: '清空队列', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('播放模式', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/music-party-room-queue.png' })
    await page.getByRole('button', { name: '关闭播放队列' }).click()
    await expect(page.getByRole('button', { name: '播放队列', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    const noticeClose = page.getByRole('button', { name: '关闭通知', exact: true })
    if (await noticeClose.isVisible()) await noticeClose.click()
    await page.screenshot({ path: 'test-results/music-party-player-room.png' })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1000, height: 720 }),
    )
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(1000)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const leaveBounds = await page
      .getByRole('button', { name: '离开房间', exact: true })
      .boundingBox()
    const barBounds = await page.getByLabel('底部播放栏').boundingBox()
    expect(leaveBounds!.y + leaveBounds!.height).toBeLessThan(barBounds!.y)
    await page.screenshot({ path: 'test-results/music-party-player-compact.png' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => window.together.updatePreferences({ theme: 'light' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.screenshot({ path: 'test-results/music-party-player-light.png' })
    await page.evaluate(() => window.together.updatePreferences({ theme: 'dark' }))
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 850 }),
    )
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲444')
    heartbeatSeconds = 30
    await page.getByRole('button', { name: '立即同步' }).click()
    const beforeRegular = calls.filter((call) => call.path.endsWith('/heartbeat')).length
    await expect
      .poll(() => calls.filter((call) => call.path.endsWith('/heartbeat')).length, {
        timeout: 4000,
      })
      .toBeGreaterThan(beforeRegular)
    const beforeBoundaryMutations = calls.filter((call) =>
      call.path.endsWith('/song/operate'),
    ).length
    boundaryChecks = 0
    const boundaryStart = Date.now()
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.currentTime = 29.99
    })
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲666', { timeout: 5000 })
    expect(Date.now() - boundaryStart).toBeLessThan(5000)
    expect(boundaryChecks).toBeGreaterThanOrEqual(2)
    expect(calls.filter((call) => call.path.endsWith('/song/operate')).length).toBe(
      beforeBoundaryMutations,
    )
    boundaryChecks = -1
    currentSong = '444'
    version++
    await page.getByRole('button', { name: '立即同步' }).click()
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲444')

    await expect
      .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
      .toBeGreaterThan(4.5)
    expect(calls.filter((call) => call.path.endsWith('/ack'))).toHaveLength(1)
    expect(calls.filter((call) => call.path.endsWith('/room/create'))).toHaveLength(1)
    await page.getByRole('button', { name: '收起播放界面' }).click()
    await page.getByRole('button', { name: '我的歌单', exact: true }).click()
    await expect(page.getByText('全部歌单 · 51 个')).toBeVisible()
    await page.getByRole('button', { name: /^歌单1 205/ }).click()
    await expect(page.getByText('已加载 100 / 205 首')).toBeVisible()
    await page.getByRole('button', { name: '加载更多歌曲' }).click()
    await expect(page.getByText('已加载 200 / 205 首')).toBeVisible()
    await page.getByRole('button', { name: '加载更多歌曲' }).click()
    await expect(page.getByText('已加载 205 / 205 首')).toBeVisible()
    await page.getByRole('button', { name: '推送 测试歌曲5000' }).click()
    expect(
      calls
        .filter((call) => call.path.endsWith('/song/operate') && call.args.data.operate === 1)
        .at(-1)!.args.data.songId,
    ).toBe('5000')
    await page.getByRole('button', { name: '我喜欢的音乐', exact: true }).click()
    await expect(page.getByText('已加载 2 / 2 首')).toBeVisible()
    await page.getByRole('button', { name: '取消喜欢 测试歌曲111', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '取消喜欢这首歌？' })).toBeVisible()
    expect(calls.filter((call) => call.path === '/like')).toHaveLength(0)
    await page.mouse.click(5, 5)
    await expect(page.getByRole('dialog', { name: '取消喜欢这首歌？' })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '取消喜欢 测试歌曲111', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '取消喜欢 测试歌曲111', exact: true }).click()
    await page.getByRole('button', { name: '确认取消喜欢' }).click()
    await expect(page.getByText('已加载 1 / 1 首')).toBeVisible()
    expect(calls.find((call) => call.path === '/like')!.args.like).toBe('false')
    await page.getByRole('button', { name: '打开播放界面' }).click()
    await expect(page.getByLabel('当前歌曲歌词')).toContainText('第二句')
    await page.getByRole('button', { name: '离开房间', exact: true }).click()
    await page.getByRole('button', { name: '确认离开' }).click()
    await expect(page.getByText('已离开多人房间', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '收起播放界面' }).click()
    await page.getByRole('button', { name: '我的歌单', exact: true }).click()
    await page.getByRole('button', { name: /^歌单1 205/ }).click()
    await expect(page.getByRole('button', { name: '播放全部' })).toBeEnabled()
    await page.getByRole('button', { name: '播放全部' }).click()
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲5000')
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.currentTime = 29.99
    })
    await expect(page.locator('.now-playing strong')).toHaveText('测试歌曲5001', { timeout: 10000 })
    await page.getByRole('button', { name: '播放队列', exact: true }).click()
    await expect(page.getByText('205 首', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/music-party-library.png' })
    await page.getByRole('button', { name: '关闭播放队列' }).click()
    await page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByLabel('搜索音乐库').fill('测试')
    await page.locator('.wide-search').getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByRole('button', { name: '播放 搜索歌曲' })).toBeVisible()
    await page.locator('.filter-tabs').getByRole('button', { name: '歌单', exact: true }).click()
    await expect(page.getByRole('button', { name: /搜索歌单/ })).toBeVisible()
    await page.locator('.filter-tabs').getByRole('button', { name: '歌手', exact: true }).click()
    await page.getByRole('button', { name: '搜索歌手', exact: true }).click()
    await expect(page.getByRole('button', { name: '播放 歌手歌曲' })).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const searches = calls.filter((call) => call.path === '/cloudsearch').length
    await page.getByRole('button', { name: '删除搜索记录 111', exact: true }).click()
    await expect(page.getByRole('button', { name: '删除搜索记录 111', exact: true })).toHaveCount(0)
    expect(calls.filter((call) => call.path === '/cloudsearch')).toHaveLength(searches)
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('music-party-search-history')!)),
    ).not.toContain('111')
    await page.getByRole('button', { name: '清空搜索记录' }).click()
    await expect(page.locator('.search-history')).toHaveCount(0)
    await page.getByRole('button', { name: '收藏的专辑', exact: true }).click()
    await expect(page.getByText('全部专辑 · 51 张')).toBeVisible()
    await page.getByRole('button', { name: /^收藏专辑1 专辑歌手/ }).click()
    await expect(page.getByText('已加载 2 / 2 首')).toBeVisible()
    await expect(page.getByRole('button', { name: '播放 专辑第一首', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '播放全部', exact: true }).click()
    await expect
      .poll(() => calls.filter((call) => call.path === '/song/url/v1').at(-1)?.args.id)
      .toBe('6100')
    await page.screenshot({ path: 'test-results/music-party-album.png' })
    expect(errors).toEqual([])
    const invalid = await page.evaluate(() =>
      window.together.call({ method: 'multiStatus', args: { cookie: 'bad' } }),
    )
    expect(invalid.ok).toBe(false)
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

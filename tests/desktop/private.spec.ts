import {
  createChineseProfile,
  showPrivateList,
  settingsGroup,
  openTool,
  panelPage,
  loginFixture,
  serveSeekableWav,
  widenPanel,
} from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { rm } from 'node:fs/promises'
import { inviteText } from '../../src/shared/private-messages'

test('private inbox joins official invitations and shares only after recipient confirmation', async () => {
  const self = { userId: 123, nickname: '我' },
    alice = { userId: 456, nickname: 'Alice · 喜欢在一起听房间分享音乐的超长完整昵称' },
    bob = { userId: 789, nickname: 'Bob' }
  const stamp = Date.now() - 10000
  let active: string | null = null,
    delayAlice = false,
    delaySend = false,
    failSend = false,
    failRead = true,
    aliceLastTime = stamp
  let currentRoomSong = '111',
    roomVersion = 1
  const pendingResponse: { finish: (() => void) | null } = { finish: null }
  const pendingSend: { finish: (() => void) | null } = { finish: null }
  const flushPending = () => {
    const callback = pendingResponse.finish
    pendingResponse.finish = null
    callback?.()
  }
  const calls: { route: string; args: any }[] = []
  const link = inviteText('invited-room', '456')
  const msg = (id: number, from: any, to: any, text: string, time = stamp + id) => ({
    id,
    fromUser: from,
    toUser: to,
    time,
    msg: JSON.stringify({ type: 1, msg: text }),
  })
  const nativeCaption = '我们一起听歌吧！分享你喜欢的歌给大家，一起玩转多人一起听～'
  const sharedSongTitle = '私信分享歌曲 · 可以换行完整显示的很长歌曲名称与特别演出版本'
  const sharedSongCaption = '分享一首耐听的歌曲，分享说明与歌曲卡片一起显示'
  const nativeLink = 'orpheus://nm/multiListenTogether/joinRoom?roomId=invited-room&inviterId=456'
  const nativeCard = {
    ...msg(2, alice, self, nativeCaption),
    msg: JSON.stringify({
      msg: nativeCaption,
      generalMsg: {
        nativeUrl: `orpheus://nm/redirect?url1=${encodeURIComponent(nativeLink)}&url2=${encodeURIComponent(link.slice(link.indexOf('https://')))}`,
      },
    }),
  }
  const history = [
    msg(1, alice, self, '手机私信 <b>原样显示</b>'),
    nativeCard,
    msg(3, alice, self, inviteText('expired-room', '456')),
    {
      ...msg(4, alice, self, ''),
      msg: JSON.stringify({ picInfo: { url: 'https://p1.music.126.net/chat-test.png' } }),
    },
    {
      ...msg(7, self, alice, '', stamp + 4),
      msg: JSON.stringify({
        msg: '图片',
        pics: [
          { title: '第一张照片', url: 'https://p1.music.126.net/one.png' },
          { title: '第二张照片', url: 'https://p1.music.126.net/two.png' },
        ],
      }),
    },
    {
      ...msg(8, alice, self, ''),
      msg: JSON.stringify({
        voice: { title: '语音附件', voiceUrl: 'https://p1.music.126.net/voice.m4a' },
        video: { title: '视频附件', videoUrl: 'https://p1.music.126.net/clip.mp4' },
        file: { name: '歌词文件', url: 'https://p1.music.126.net/words.txt' },
      }),
    },
    {
      ...msg(5, alice, self, ''),
      msg: JSON.stringify({
        msg: sharedSongCaption,
        song: { id: 777, name: sharedSongTitle, artists: [{ name: '歌手' }] },
      }),
    },
    {
      ...msg(6, alice, self, ''),
      msg: JSON.stringify({ album: { id: 888, name: '私信分享专辑' } }),
    },
  ]
  const songInfo = () => ({
    playSong: { songId: currentRoomSong, songBizId: `1000${currentRoomSong}`, songRcmdUid: 123 },
    nextSongs: [],
    version: roomVersion,
    playedTime: 3000,
    songDuration: 30000,
    waitSongCount: 0,
  })
  const snapshot = () => ({
    roomId: active,
    roomPlaySongInfo: songInfo(),
    multiRoomInfoDTO: { chatRoomId: '9988' },
    multiLtRoomUserAgg: {
      onlineNums: 3,
      onlineUserInfos: [123, 456, 789].map((uid) => ({ uid, nickname: `听友${uid}` })),
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
    if (req.url === '/artwork.png') {
      res.setHeader('Content-Type', 'image/png')
      res.end(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
          'base64',
        ),
      )
      return
    }
    if (new URL(req.url!, 'http://localhost').pathname === '/audio.wav') {
      serveSeekableWav(req, res, pcm)
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const args = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const path = new URL(req.url!, 'http://localhost').pathname
    const route = path === '/api' ? args.uri : path
    calls.push({ route, args })
    let body: any = { code: 200 }
    switch (route) {
      case '/login/status':
        body = { data: { code: 200, profile: args.cookie.includes('MUSIC_U=mock') ? self : null } }
        break
      case '/login/qr/key':
        body = { code: 200, data: { unikey: 'key' } }
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
        body = { code: 803, cookie: 'MUSIC_U=mock; Path=/;' }
        break
      case '/user/playlist':
        body = { code: 200, playlist: [], more: false }
        break
      case '/album/sublist':
        body = { code: 200, data: [], hasMore: false }
        break
      case '/album':
        body = {
          code: 200,
          album: { id: args.id },
          songs: [{ id: 889, name: '专辑里的歌曲', ar: [{ name: '专辑歌手' }], dt: 30000 }],
        }
        break
      case '/song/detail':
        body = {
          code: 200,
          songs: String(args.ids)
            .split(',')
            .map((id) => ({
              id,
              name: id === '777' ? sharedSongTitle : `房间歌曲${id}`,
              ar: [{ name: '歌手' }],
              dt: 30000,
            })),
        }
        break
      case '/song/url/v1':
        body = { code: 200, data: [{ id: args.id, url: `http://127.0.0.1:${port}/audio.wav` }] }
        break
      case '/api/communication/msg/unread/count/clean':
        body =
          args.data.userId === '789' && failRead
            ? { code: 503, message: '已读服务暂时不可用' }
            : { code: 200 }
        break
      case '/likelist':
        body = { code: 200, ids: [] }
        break
      case '/msg/private':
        body = {
          code: 200,
          more: !args.offset,
          msgs: args.offset
            ? [
                {
                  fromUser: { userId: 999, nickname: 'Carol' },
                  toUser: self,
                  lastMsg: '{"msg":"older conversation"}',
                  lastMsgTime: 1,
                },
              ]
            : [
                {
                  fromUser: alice,
                  toUser: self,
                  lastMsg: history.at(-1)!.msg,
                  lastMsgTime: aliceLastTime,
                  newMsgCount: 3,
                },
                {
                  fromUser: bob,
                  toUser: self,
                  lastMsg: '{"msg":"hi"}',
                  lastMsgTime: stamp - 1,
                  newMsgCount: 1,
                },
              ],
        }
        break
      case '/msg/private/history':
        if (args.uid === '456' && delayAlice) {
          pendingResponse.finish = () => {
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                code: 200,
                more: false,
                msgs: [msg(999, alice, self, '旧会话延迟响应')],
              }),
            )
          }
          return
        }
        body = {
          code: 200,
          more: args.uid === '456' && !args.before,
          msgs:
            args.uid !== '456'
              ? [msg(80, bob, self, 'Bob 的消息')]
              : args.before
                ? [msg(90, alice, self, '更早私信', stamp - 5000)]
                : [...history].reverse(),
        }
        break
      case '/user/follows':
        body = {
          code: 200,
          follow: args.offset ? [{ userId: 1001, nickname: '下一页联系人' }] : [bob],
          more: !args.offset,
        }
        break
      case '/send/text':
        if (delaySend) {
          pendingSend.finish = () => {
            history.push(msg(300 + history.length, self, alice, args.msg, Date.now()))
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ code: 200, msgs: [], more: false }))
          }
          return
        }
        if (failSend) {
          body = { code: 403, message: '当前不能发送私信' }
          break
        }
        history.push(
          msg(
            100 + history.length,
            self,
            args.user_ids === '456' ? alice : bob,
            args.msg,
            Date.now(),
          ),
        )
        body = { code: 200, msgs: [], more: false }
        break
      case '/register/checktoken/v3':
        body = { code: 200, token: 'mock-token' }
        break
      case '/api/listen/together/multi/landing/info/get':
        body = {
          code: 200,
          data: {
            roomStatus: args.data.roomId === 'expired-room' ? 'EXPIRED' : 'AVAILABLE',
            songData: { name: '邀请里的歌曲' },
          },
        }
        break
      case '/api/listen/together/multi/match/status/get':
        body = { code: 200, data: { multiLtRoomSnapshot: active ? snapshot() : null } }
        break
      case '/api/listen/together/multi/match/ack':
        active = args.data.roomId
        body = { code: 200, data: { success: true, multiLtRoomSnapshot: snapshot() } }
        break
      case '/api/listen/together/multi/match/heartbeat':
        body = { code: 200, data: { heartBeatDuration: 1, roomPlaySongInfo: songInfo() } }
        break
      case '/api/listen/together/multi/played/song/info':
        body = { code: 200, data: { liked: false, songInfo: { zanCnt: 0 } } }
        break
      case '/api/listen/together/multi/match/song/operate':
        body = { code: 200, data: { success: true, roomSongInfo: songInfo() } }
        break
      case '/api/listen/together/multi/match/msg/history':
        body = {
          code: 200,
          data: {
            records: [
              {
                sendUid: 456,
                sendTime: stamp,
                msgType: 0,
                nickname: 'Alice',
                imChatRoomMsgBody: { text: '分开发送的文字' },
              },
              {
                sendUid: 456,
                sendTime: stamp,
                msgType: 0,
                nickname: 'Alice',
                imChatRoomMsgBody: {
                  text: '照片说明',
                  pictures: [
                    { url: 'https://p1.music.126.net/photo1.png' },
                    { url: 'https://p1.music.126.net/photo2.png' },
                  ],
                },
              },
              {
                sendUid: 123,
                sendTime: stamp + 1,
                msgType: 0,
                nickname: '我',
                imChatRoomMsgBody: { image: { url: 'https://p1.music.126.net/photo3.png' } },
              },
            ],
            page: { more: false },
          },
        }
        break
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port,
    profile = await createChineseProfile('music-party-inbox-')
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
    const player = await app.firstWindow()
    let page = player.locator('body')
    await app.evaluate(({ shell }) => {
      ;(globalThis as any).__openedMusicLinks = []
      shell.openExternal = async (url) => {
        ;(globalThis as any).__openedMusicLinks.push(url)
      }
    })
    await player.locator('audio:not([controls])').evaluate((audio: HTMLAudioElement) => {
      audio.muted = true
    })
    await app.evaluate(({ session, net }, port) => {
      session.defaultSession.protocol.handle('https', (request) => {
        const url = new URL(request.url)
        if (url.hostname === 'p1.music.126.net')
          return net.fetch(
            `http://127.0.0.1:${port}/${url.pathname === '/voice.m4a' ? 'audio.wav' : 'artwork.png'}`,
          )
        return net.fetch(request, { bypassCustomProtocolHandlers: true })
      })
    }, port)
    const errors: string[] = []
    player.on('pageerror', (error) => errors.push(error.message))
    await loginFixture(app, player)
    page = await openTool(app, player, 'private')
    await widenPanel(app, page)
    await showPrivateList(page)
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText(
      '手机私信 <b>原样显示</b>',
    )
    expect(await page.locator('.private-messages b').count()).toBe(0)
    const incomingCard = page.locator('article.chat-message').filter({
      hasText: '手机私信 <b>原样显示</b>',
    })
    await expect(incomingCard.locator('.chat-author > span')).toHaveText(alice.nickname)
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
    await expect(
      page.getByRole('button', { name: `播放 ${sharedSongTitle}`, exact: true }),
    ).toBeVisible()
    const privateLog = page.getByRole('log', { name: '私信消息' })
    const photoBubble = privateLog.locator('[data-message-id="server:4"] .chat-bubble')
    await expect(photoBubble.getByRole('button', { name: '查看图片：图片' })).toBeVisible()
    await expect(photoBubble.locator('.message-caption')).toHaveCount(0)
    const captioned = privateLog.locator('[data-message-id="server:7"] article.mine')
    await expect(captioned.locator('.chat-bubble')).toHaveCount(1)
    await expect(captioned.locator('.chat-bubble .message-caption')).toHaveText('图片')
    await expect(captioned.locator('.chat-bubble .message-image')).toHaveCount(2)
    const media = privateLog.locator('[data-message-id="server:8"] .chat-bubble')
    await expect(media.locator('audio, video')).toHaveCount(2)
    await media.locator('audio').evaluate(async (el: HTMLAudioElement) => {
      el.muted = true
      await el.play()
    })
    await expect
      .poll(() => media.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
      .toBeGreaterThan(0)
    await media.locator('audio').evaluate((el: HTMLAudioElement) => el.pause())
    await expect(media.getByRole('button', { name: '打开资源 歌词文件' })).toBeEnabled()
    const inviteBubble = privateLog.locator('[data-message-id="server:2"] .chat-bubble')
    await expect(inviteBubble.locator('.message-caption')).toHaveText(nativeCaption)
    await expect(inviteBubble.getByRole('button', { name: '检查邀请' })).toBeEnabled()
    const songShare = page.locator('.message-share-card').filter({ hasText: sharedSongTitle })
    await expect(songShare).toContainText(sharedSongCaption)
    await expect(songShare.locator('.message-resource-kind')).toHaveText('单曲')
    await expect(songShare.locator('.message-resource strong')).toHaveText(sharedSongTitle)
    await expect(
      page.getByRole('button', { name: '查看专辑 私信分享专辑', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '查看专辑 私信分享专辑', exact: true }).click()
    const album = await panelPage(app, 'detail-album-888')
    const albumView = album
    await expect(
      albumView.getByRole('button', { name: '播放 专辑里的歌曲', exact: true }),
    ).toBeVisible()
    expect(calls.filter((call) => call.route === '/album').at(-1)?.args.id).toBe('888')
    expect(await app.evaluate(() => (globalThis as any).__openedMusicLinks)).toEqual([])
    await albumView
      .getByRole('navigation', { name: '页面导航' })
      .getByRole('button', { name: '返回' + alice.nickname, exact: true })
      .click()
    await expect(albumView).toBeHidden()
    await player.bringToFront()
    await page.getByRole('button', { name: '查看图片：图片' }).click()
    await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible()
    await player.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '图片预览' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Emoji', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Emoji', exact: true })
      .getByRole('button', { name: '🎵', exact: true })
      .click()
    await expect(page.getByLabel('私信内容')).toHaveValue('🎵')
    await page.getByLabel('私信内容').fill('')
    expect(
      await page.locator('.private-layout').evaluate((element) => {
        const panel = element.getBoundingClientRect()
        const main = element.closest('.desktop-panel')!.getBoundingClientRect()
        return panel.left >= main.left && panel.right <= main.right && panel.top > main.top
      }),
    ).toBe(true)
    await expect(
      player.evaluate(() => window.together.openMessageLink('file:///tmp/test')),
    ).rejects.toThrow('网易云链接')

    const aliceRow = page.locator('.conversation-list > button').filter({ hasText: 'Alice' })
    const bobRow = page.locator('.conversation-list > button').filter({ hasText: 'Bob' })
    await expect(aliceRow.locator('.unread-count')).toHaveCount(0)
    await expect(bobRow.locator('.unread-count')).toHaveText('1')
    expect(
      calls
        .filter((c) => c.route === '/api/communication/msg/unread/count/clean')
        .map((c) => c.args.data.userId),
    ).toEqual(['456'])
    await showPrivateList(page)
    await page.getByRole('button', { name: '刷新私信会话' }).click()
    await expect(aliceRow.locator('.unread-count')).toHaveCount(0)
    await showPrivateList(page)
    await bobRow.click()
    await expect(page.getByText('已读状态同步失败：已读服务暂时不可用')).toBeVisible()
    await expect(bobRow.locator('.unread-count')).toHaveText('1')
    failRead = false
    await page.getByRole('button', { name: '重试同步已读' }).click()
    await expect(bobRow.locator('.unread-count')).toHaveCount(0)
    // A new incoming message is unread while a different conversation is open.
    aliceLastTime = Date.now()
    history.push(msg(200, alice, self, '新收到的私信', aliceLastTime))
    await showPrivateList(page)
    await page.getByRole('button', { name: '刷新私信会话' }).click()
    await expect(aliceRow.locator('.unread-count')).toHaveText('3')
    expect(
      calls.filter(
        (c) =>
          c.route === '/api/communication/msg/unread/count/clean' && c.args.data.userId === '456',
      ),
    ).toHaveLength(1)
    await showPrivateList(page)
    await aliceRow.click()
    await expect(aliceRow.locator('.unread-count')).toHaveCount(0)
    expect(
      calls.filter(
        (c) =>
          c.route === '/api/communication/msg/unread/count/clean' && c.args.data.userId === '456',
      ),
    ).toHaveLength(2)

    await expect(page.getByRole('button', { name: '更多会话', exact: true })).toHaveCount(0)
    await showPrivateList(page)
    await page.locator('.conversation-list').evaluate((box) => {
      box.scrollTop = box.scrollHeight
    })
    await expect(page.locator('.conversation-list')).toContainText('Carol')
    await aliceRow.click()
    await expect(page.getByRole('button', { name: '加载更早私信' })).toHaveCount(0)
    await page.getByRole('log', { name: '私信消息' }).evaluate((box) => {
      box.scrollTop = 0
    })
    await page.getByRole('log', { name: '私信消息' }).hover()
    await player.mouse.wheel(0, -500)
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText('更早私信')
    expect(
      calls.find((c) => c.route === '/msg/private/history' && c.args.before)!.args.before,
    ).toBe(stamp + 1)
    const cards = page.locator('.private-invite-card')
    await expect(cards).toHaveCount(2)
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText(nativeCaption)
    await cards.nth(1).getByRole('button', { name: '检查邀请' }).click()
    await expect(cards.nth(1)).toContainText('邀请已过期')
    await player.evaluate(() => window.together.updatePreferences({ language: 'en' }))
    await expect(cards.nth(1)).toContainText('The invite expired or the room has ended')
    await player.evaluate(() => window.together.updatePreferences({ language: 'zh-CN' }))
    await expect(cards.nth(1)).toContainText('邀请已过期')
    expect(calls.some((c) => c.route.endsWith('/ack'))).toBe(false)
    await cards.nth(0).getByRole('button', { name: '检查邀请' }).click()
    await player.screenshot({ path: 'test-results/music-party-native-invite.png' })
    await cards.nth(0).getByRole('button', { name: '加入一起听' }).click()
    const room = await panelPage(app, 'room')
    await expect(room.getByRole('button', { name: '查看房间成员', exact: true })).toContainText(
      '3 人',
    )
    expect(calls.find((c) => c.route.endsWith('/ack'))!.args.data).toMatchObject({
      roomId: 'invited-room',
      inviterUid: '456',
    })
    await openTool(app, player, 'room')
    await player
      .locator('.adaptive-player-bar')
      .getByRole('button', { name: '房间聊天', exact: true })
      .click()
    const roomChat = await panelPage(app, 'chat')
    const roomLog = roomChat.getByRole('log')
    await expect(roomLog.locator('article.chat-message')).toHaveCount(3)
    const roomAlbum = roomLog
      .locator('article')
      .filter({ hasText: '照片说明' })
      .locator('.chat-bubble')
    await expect(roomAlbum).toHaveCount(1)
    await expect(roomAlbum.locator('.message-image')).toHaveCount(2)
    await expect(
      roomLog.locator('article.mine .chat-bubble > .message-image:only-child'),
    ).toBeVisible()
    const chatHistoryCalls = () =>
      calls.filter((call) => call.route.endsWith('/msg/history')).length
    const firstHistoryPage = chatHistoryCalls()
    await expect.poll(chatHistoryCalls, { timeout: 11000 }).toBeGreaterThan(firstHistoryPage)
    await expect(roomLog.locator('article.chat-message')).toHaveCount(3)
    for (const tool of await roomChat.locator('.composer-tools > .icon-btn').all()) {
      const rect = (await tool.boundingBox())!
      expect([rect.width, rect.height]).toEqual([28, 28])
    }
    await openTool(app, player, 'room')
    await room.getByRole('button', { name: '私信邀请', exact: true }).click()
    await page.getByRole('button', { name: `试听或推歌 ${sharedSongTitle}`, exact: true }).click()
    await expect(page.getByRole('dialog', { name: '歌曲操作', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '试听', exact: true }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText(sharedSongTitle)
    const stopAudition = player.getByRole('button', { name: '停止试听', exact: true })
    await expect(stopAudition).toHaveCount(1)
    await expect(stopAudition.locator('svg.lucide-square')).toBeVisible()
    await expect(page.getByRole('button', { name: '暂停试听', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '继续试听', exact: true })).toHaveCount(0)
    await expect(
      player.getByRole('button', { name: '返回房间当前歌曲', exact: true }),
    ).toBeVisible()
    await expect(player.getByLabel('播放进度', { exact: true })).toBeEnabled()
    await expect
      .poll(() =>
        app.evaluate(
          ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('desktop-previous')!.enabled,
        ),
      )
      .toBe(true)
    // Even auditioning the same song ID does not expose room attribution or reactions.
    currentRoomSong = '777'
    roomVersion++
    const queue = await openTool(app, player, 'queue')
    const roomTrackTitle = queue.locator('.queue-playing-copy strong')
    await expect(roomTrackTitle).toHaveText(sharedSongTitle)
    await expect(player.locator('.footer-room-like')).toBeDisabled()
    await expect(queue.locator('.queue-track-overline').first()).toBeVisible()
    currentRoomSong = '222'
    roomVersion++
    await expect(roomTrackTitle).toHaveText('房间歌曲222')
    await queue.locator('.panel-titlebar').getByRole('button', { name: '关闭房间待播列表' }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText(sharedSongTitle)
    await stopAudition.click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('房间歌曲222')
    await expect(stopAudition).toHaveCount(0)
    await expect(player.getByRole('button', { name: '本机暂停', exact: true })).toBeVisible()
    await expect
      .poll(() =>
        player
          .locator('audio:not([controls])')
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      )
      .toBeGreaterThanOrEqual(2.8)
    await expect(player.getByLabel('播放进度', { exact: true })).toBeDisabled()
    await expect
      .poll(() =>
        app.evaluate(
          ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('desktop-previous')!.enabled,
        ),
      )
      .toBe(false)
    expect(calls.filter((call) => call.route.endsWith('/song/operate'))).toHaveLength(0)
    // Stopping a second audition preserves an earlier local pause in the room.
    await player.mouse.move(200, 150)
    await player.getByRole('button', { name: '本机暂停', exact: true }).click()
    await expect(player.getByRole('button', { name: '恢复同听', exact: true })).toBeVisible()
    await openTool(app, player, 'room')
    await room.getByRole('button', { name: '私信邀请', exact: true }).click()
    await page.getByRole('button', { name: `试听或推歌 ${sharedSongTitle}`, exact: true }).click()
    await page.getByRole('button', { name: '试听', exact: true }).click()
    await expect(stopAudition).toHaveCount(1)
    await expect
      .poll(() =>
        player.locator('audio:not([controls])').evaluate((audio: HTMLAudioElement) => audio.paused),
      )
      .toBe(false)
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('desktop-toggle')!
      item.click(item, undefined, {} as any)
    })
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('房间歌曲222')
    await expect(stopAudition).toHaveCount(0)
    await expect(player.getByRole('button', { name: '恢复同听', exact: true })).toBeVisible()
    expect(
      await player
        .locator('audio:not([controls])')
        .evaluate((audio: HTMLAudioElement) => audio.paused),
    ).toBe(true)
    expect(calls.filter((call) => call.route.endsWith('/song/operate'))).toHaveLength(0)
    await player.mouse.move(200, 150)
    await player.getByRole('button', { name: '恢复同听', exact: true }).click()
    await expect(player.getByRole('button', { name: '本机暂停', exact: true })).toBeVisible()
    await openTool(app, player, 'room')
    await room.getByRole('button', { name: '私信邀请', exact: true }).click()
    await page.getByRole('button', { name: `试听或推歌 ${sharedSongTitle}`, exact: true }).click()
    await page.getByRole('button', { name: '推歌', exact: true }).click()
    await expect
      .poll(() => calls.filter((call) => call.route.endsWith('/song/operate')).length)
      .toBe(1)
    expect(calls.find((call) => call.route.endsWith('/song/operate'))!.args.data).toMatchObject({
      songId: '777',
      operate: 1,
    })
    await page.getByRole('button', { name: '邀请到当前房间' }).click()
    await expect(page.getByRole('dialog')).toContainText('Alice')
    expect(calls.filter((c) => c.route === '/send/text')).toHaveLength(0)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    expect(calls.filter((c) => c.route === '/send/text')).toHaveLength(0)
    await page.getByRole('button', { name: '邀请到当前房间' }).click()
    await page.getByRole('button', { name: '确认发送邀请' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(calls.find((c) => c.route === '/send/text')!.args).toMatchObject({
      user_ids: '456',
      msg: inviteText('invited-room', '123'),
    })
    await page.getByLabel('私信内容').fill('文字私信测试')
    await page.getByRole('button', { name: '发送私信', exact: true }).click()
    await expect(page.getByLabel('私信内容')).toHaveValue('')
    await page.getByRole('button', { name: '刷新当前私信' }).click()
    await expect(
      page.locator('.private-messages .chat-bubble').filter({ hasText: '文字私信测试' }),
    ).toHaveCount(1)
    const outgoingCard = page.locator('article.chat-message.mine').filter({
      hasText: '文字私信测试',
    })
    expect(
      await outgoingCard.evaluate((card) => {
        const avatar = card.querySelector('.chat-message-avatar')!.getBoundingClientRect()
        const body = card.querySelector('.chat-message-body')!.getBoundingClientRect()
        return avatar.left >= body.right - 1
      }),
    ).toBe(true)
    delaySend = true
    await page.getByLabel('私信内容').fill('切换期间发送结果')
    await page.getByRole('button', { name: '发送私信', exact: true }).click()
    await expect.poll(() => !!pendingSend.finish).toBe(true)
    await showPrivateList(page)
    await bobRow.click()
    await showPrivateList(page)
    await aliceRow.click()
    const settleSend = pendingSend.finish
    pendingSend.finish = null
    delaySend = false
    settleSend?.()
    await expect(page.getByLabel('私信内容')).toHaveValue('')
    await expect(
      page.locator('article.chat-message.mine').filter({ hasText: '切换期间发送结果' }),
    ).toHaveCount(1)
    await expect(
      page.locator('article.chat-message.mine').filter({ hasText: '切换期间发送结果' }),
    ).not.toContainText('发送中')
    failSend = true
    await page.getByLabel('私信内容').fill('保留失败草稿')
    await page.getByRole('button', { name: '发送私信', exact: true }).click()
    await expect(page.locator('.private-messages .chat-failed')).toContainText('当前不能发送私信')
    await expect(page.getByLabel('私信内容')).toHaveValue('保留失败草稿')
    const notice = page.getByRole('button', { name: '关闭通知', exact: true })
    if (await notice.isVisible()) await notice.click()
    await player.screenshot({
      path: 'test-results/music-party-private.png',
      animations: 'disabled',
    })
    await page.getByLabel('私信内容').focus()
    await widenPanel(app, page, 390, 550)
    await expect(page.getByLabel('私信内容')).toHaveValue('保留失败草稿')
    const composer = await page.locator('.private-compose').boundingBox()
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(550)
    expect(composer!.x + composer!.width).toBeLessThanOrEqual(390)
    expect(
      await page.getByRole('log', { name: '私信消息' }).evaluate((log) => {
        const bounds = log.getBoundingClientRect()
        return (
          log.scrollWidth <= log.clientWidth + 1 &&
          [
            ...log.querySelectorAll(
              '.chat-message, .chat-author, .message-share-card, .message-resource, .message-image, .private-invite-card',
            ),
          ].every((card) => {
            const rect = card.getBoundingClientRect()
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
          })
        )
      }),
    ).toBe(true)
    await player.screenshot({
      path: 'test-results/music-party-private-compact.png',
      animations: 'disabled',
    })
    await player.evaluate(() => window.together.updatePreferences({ theme: 'light' }))
    await player.screenshot({
      path: 'test-results/music-party-private-light.png',
      animations: 'disabled',
    })
    await widenPanel(app, page)
    await showPrivateList(page)
    await page.getByRole('button', { name: '选择好友发私信' }).click()
    await expect(page.getByRole('dialog', { name: '选择私信收件人' })).toBeVisible()
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '下一页联系人 1001' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '更多联系人' })).toHaveCount(0)
    await player.mouse.click(5, 5)
    await expect(page.getByRole('dialog', { name: '选择私信收件人' })).toHaveCount(0)
    await aliceRow.click()
    await expect(page.getByLabel('私信内容')).toHaveValue('保留失败草稿')

    await showPrivateList(page)
    await page.getByRole('button', { name: '选择好友发私信' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Bob 789' }).click()
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText('Bob 的消息')
    delayAlice = true
    await showPrivateList(page)
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await expect.poll(() => !!pendingResponse.finish).toBe(true)
    await showPrivateList(page)
    await page.locator('.conversation-list').getByRole('button', { name: /^Bob/ }).click()
    flushPending()
    delayAlice = false
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText('Bob 的消息')
    expect(await page.getByRole('log', { name: '私信消息' }).innerText()).not.toContain(
      '旧会话延迟响应',
    )
    for (const [width, height] of [
      [1159, 750],
      [740, 590],
      [321, 682],
    ]) {
      await widenPanel(app, page, width, height)
      await player.evaluate(
        (size) =>
          window.together.updatePreferences({
            theme: size === 740 ? 'light' : 'dark',
            fontScale: size < 520 ? 150 : 100,
          }),
        width,
      )
      const input = page.getByLabel('私信内容')
      await input.fill('多行草稿\n第二行\n第三行')
      for (const el of [
        page.locator('.private-thread-heading'),
        page.locator('.private-compose'),
      ]) {
        await expect(el).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect(el).toHaveCSS('border-radius', '0px')
        await expect(el).toHaveCSS('box-shadow', 'none')
      }
      await expect(input).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('button', { name: '发送私信', exact: true })).toBeInViewport({
        ratio: 1,
      })
      if (width === 321) {
        for (const label of ['邀请到当前房间', '刷新当前私信']) {
          const action = page.getByRole('button', { name: label, exact: true })
          const rect = (await action.boundingBox())!
          expect([rect.width, rect.height]).toEqual([30, 30])
          await action.hover()
          await expect(action).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        }
      }
      await showPrivateList(page)
      const sidebar = page.locator('.conversation-pane')
      await expect(sidebar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(sidebar).toHaveCSS('border-radius', '0px')
      await bobRow.click()
      await expect(input).toHaveValue('多行草稿\n第二行\n第三行')
    }
    await player.evaluate(() => window.together.updatePreferences({ fontScale: 100 }))
    await widenPanel(app, page)
    page = await openTool(app, player, 'settings')
    await settingsGroup(page, '更新与帮助')
    await page.getByRole('button', { name: '观测记录' }).click()
    page = await panelPage(app, 'diagnostics')
    await page.locator('.trace-list button').filter({ hasText: 'privateSend' }).first().click()
    expect(await page.locator('pre').innerText()).not.toContain('保留失败草稿')
    expect(errors).toEqual([])
  } finally {
    pendingSend.finish?.()
    flushPending()
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

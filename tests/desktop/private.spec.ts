import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    if (new URL(req.url!, 'http://localhost').pathname === '/audio.wav') {
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('Content-Length', pcm.length)
      res.end(pcm)
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
        body = { code: 200, data: { heartBeatDuration: 20, roomPlaySongInfo: songInfo() } }
        break
      case '/api/listen/together/multi/played/song/info':
        body = { code: 200, data: { liked: false, songInfo: { zanCnt: 0 } } }
        break
      case '/api/listen/together/multi/match/song/operate':
        body = { code: 200, data: { success: true, roomSongInfo: songInfo() } }
        break
      case '/api/listen/together/multi/match/msg/history':
        body = { code: 200, data: { records: [], page: { more: false } } }
        break
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port,
    profile = await mkdtemp(join(tmpdir(), 'music-party-inbox-'))
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
    await app.evaluate(({ shell }) => {
      ;(globalThis as any).__openedMusicLinks = []
      shell.openExternal = async (url) => {
        ;(globalThis as any).__openedMusicLinks.push(url)
      }
    })
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
      audio.muted = true
    })
    await page.route('https://p1.music.126.net/chat-test.png', (route) =>
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
    await page.getByRole('button', { name: '扫码登录', exact: true }).click()
    await expect(page.getByRole('button', { name: '一起听', exact: true })).toBeVisible()
    await page.locator('.sidebar').getByRole('button', { name: /^私信/ }).click()
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
    const songShare = page.locator('.message-share-card').filter({ hasText: sharedSongTitle })
    await expect(songShare).toContainText(sharedSongCaption)
    await expect(songShare.locator('.message-resource-kind')).toHaveText('单曲')
    await expect(songShare.locator('.message-resource strong')).toHaveText(sharedSongTitle)
    await expect(
      page.getByRole('button', { name: '查看专辑 私信分享专辑', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '查看专辑 私信分享专辑', exact: true }).click()
    const albumView = page.getByRole('dialog', { name: '专辑：私信分享专辑', exact: true })
    await expect(
      albumView.getByRole('button', { name: '播放 专辑里的歌曲', exact: true }),
    ).toBeVisible()
    expect(calls.filter((call) => call.route === '/album').at(-1)?.args.id).toBe('888')
    expect(await app.evaluate(() => (globalThis as any).__openedMusicLinks)).toEqual([])
    await albumView.getByRole('button', { name: '关闭专辑：私信分享专辑', exact: true }).click()
    await expect(albumView).toHaveCount(0)
    await page.getByRole('button', { name: '查看图片：图片' }).click()
    await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible()
    await page.keyboard.press('Escape')
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
        const main = element.closest('main')!.getBoundingClientRect()
        return panel.left > main.left && panel.right < main.right && panel.top > main.top
      }),
    ).toBe(true)
    await expect(
      page.evaluate(() => window.together.openMessageLink('file:///tmp/test')),
    ).rejects.toThrow('网易云链接')

    const aliceRow = page.locator('.conversation-list').getByRole('button', { name: /^Alice/ })
    const bobRow = page.locator('.conversation-list').getByRole('button', { name: /^Bob/ })
    await expect(aliceRow.locator('.unread-count')).toHaveCount(0)
    await expect(bobRow.locator('.unread-count')).toHaveText('1')
    expect(
      calls
        .filter((c) => c.route === '/api/communication/msg/unread/count/clean')
        .map((c) => c.args.data.userId),
    ).toEqual(['456'])
    await page.getByRole('button', { name: '刷新私信会话' }).click()
    await expect(aliceRow.locator('.unread-count')).toHaveCount(0)
    await bobRow.click()
    await expect(page.getByText('已读状态同步失败：已读服务暂时不可用')).toBeVisible()
    await expect(bobRow.locator('.unread-count')).toHaveText('1')
    failRead = false
    await page.getByRole('button', { name: '重试同步已读' }).click()
    await expect(bobRow.locator('.unread-count')).toHaveCount(0)
    // A new incoming message is unread while a different conversation is open.
    aliceLastTime = Date.now()
    history.push(msg(200, alice, self, '新收到的私信', aliceLastTime))
    await page.getByRole('button', { name: '刷新私信会话' }).click()
    await expect(aliceRow.locator('.unread-count')).toHaveText('3')
    expect(
      calls.filter(
        (c) =>
          c.route === '/api/communication/msg/unread/count/clean' && c.args.data.userId === '456',
      ),
    ).toHaveLength(1)
    await aliceRow.click()
    await expect(aliceRow.locator('.unread-count')).toHaveCount(0)
    expect(
      calls.filter(
        (c) =>
          c.route === '/api/communication/msg/unread/count/clean' && c.args.data.userId === '456',
      ),
    ).toHaveLength(2)

    await expect(page.getByRole('button', { name: '更多会话', exact: true })).toHaveCount(0)
    await page.locator('.conversation-list').evaluate((box) => {
      box.scrollTop = box.scrollHeight
    })
    await expect(page.locator('.conversation-list')).toContainText('Carol')
    await expect(page.getByRole('button', { name: '加载更早私信' })).toHaveCount(0)
    await page.getByRole('log', { name: '私信消息' }).evaluate((box) => {
      box.scrollTop = 0
    })
    await page.getByRole('log', { name: '私信消息' }).hover()
    await page.mouse.wheel(0, -500)
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText('更早私信')
    expect(
      calls.find((c) => c.route === '/msg/private/history' && c.args.before)!.args.before,
    ).toBe(stamp + 1)
    const cards = page.locator('.private-invite-card')
    await expect(cards).toHaveCount(2)
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText(nativeCaption)
    await cards.nth(1).getByRole('button', { name: '检查邀请' }).click()
    await expect(cards.nth(1)).toContainText('邀请已过期')
    expect(calls.some((c) => c.route.endsWith('/ack'))).toBe(false)
    await cards.nth(0).getByRole('button', { name: '检查邀请' }).click()
    await page.screenshot({ path: 'test-results/music-party-native-invite.png' })
    await cards.nth(0).getByRole('button', { name: '加入一起听' }).click()
    await expect(page.getByRole('heading', { name: '3 人一起听' })).toBeVisible()
    expect(calls.find((c) => c.route.endsWith('/ack'))!.args.data).toMatchObject({
      roomId: 'invited-room',
      inviterUid: '456',
    })
    await page.getByRole('button', { name: '私信邀请', exact: true }).click()
    await page.getByRole('button', { name: `试听或推歌 ${sharedSongTitle}`, exact: true }).click()
    await expect(page.getByRole('dialog', { name: '歌曲操作', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '试听', exact: true }).click()
    await expect(page.locator('.now-playing strong')).toHaveText(sharedSongTitle)
    const stopAudition = page.getByRole('button', { name: '停止试听', exact: true })
    await expect(stopAudition).toHaveCount(1)
    await expect(stopAudition.locator('svg.lucide-square')).toBeVisible()
    await expect(page.getByRole('button', { name: '暂停试听', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '继续试听', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '返回一起听', exact: true })).toBeVisible()
    await expect(page.getByLabel('播放进度', { exact: true })).toBeEnabled()
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
    await page.getByRole('button', { name: '打开播放界面', exact: true }).click()
    await page.getByRole('button', { name: '立即同步', exact: true }).click()
    await expect(page.getByRole('button', { name: '一起听点赞', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '播放队列', exact: true }).click()
    await expect(page.locator('.queue-playing .queue-track-overline')).toHaveCount(0)
    await expect(page.locator('.queue-playing-like')).toHaveCount(0)
    await page.getByRole('button', { name: '关闭播放队列', exact: true }).click()
    currentRoomSong = '222'
    roomVersion++
    await page.getByRole('button', { name: '立即同步', exact: true }).click()
    await expect(page.locator('.now-playing strong')).toHaveText(sharedSongTitle)
    await stopAudition.click()
    await expect(page.locator('.now-playing strong')).toHaveText('房间歌曲222')
    await expect(stopAudition).toHaveCount(0)
    await expect(page.getByRole('button', { name: '本机暂停', exact: true })).toBeVisible()
    await expect
      .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeGreaterThanOrEqual(2.8)
    await expect(page.getByLabel('播放进度', { exact: true })).toBeDisabled()
    await expect
      .poll(() =>
        app.evaluate(
          ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('desktop-previous')!.enabled,
        ),
      )
      .toBe(false)
    expect(calls.filter((call) => call.route.endsWith('/song/operate'))).toHaveLength(0)
    // Stopping a second audition preserves an earlier local pause in the room.
    await page.mouse.move(200, 150)
    await page.getByRole('button', { name: '本机暂停', exact: true }).click()
    await expect(page.getByRole('button', { name: '恢复同听', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '私信邀请', exact: true }).click()
    await page.getByRole('button', { name: `试听或推歌 ${sharedSongTitle}`, exact: true }).click()
    await page.getByRole('button', { name: '试听', exact: true }).click()
    await expect(stopAudition).toHaveCount(1)
    await expect
      .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused))
      .toBe(false)
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('desktop-toggle')!
      item.click(item, undefined, {} as any)
    })
    await expect(page.locator('.now-playing strong')).toHaveText('房间歌曲222')
    await expect(stopAudition).toHaveCount(0)
    await expect(page.getByRole('button', { name: '恢复同听', exact: true })).toBeVisible()
    expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
      true,
    )
    expect(calls.filter((call) => call.route.endsWith('/song/operate'))).toHaveLength(0)
    await page.mouse.move(200, 150)
    await page.getByRole('button', { name: '恢复同听', exact: true }).click()
    await expect(page.getByRole('button', { name: '本机暂停', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '打开播放界面', exact: true }).click()
    await page.getByRole('button', { name: '私信邀请', exact: true }).click()
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
    await bobRow.click()
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
    await page.screenshot({ path: 'test-results/music-party-private.png', animations: 'disabled' })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1000, height: 720 }),
    )
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1000)
    const composer = await page.locator('.private-compose').boundingBox()
    const player = await page.getByLabel('底部播放栏').boundingBox()
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(player!.y)
    expect(await page.locator('main').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(
      true,
    )
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
    await page.screenshot({
      path: 'test-results/music-party-private-compact.png',
      animations: 'disabled',
    })
    await page.evaluate(() => window.together.updatePreferences({ theme: 'light' }))
    await page.screenshot({
      path: 'test-results/music-party-private-light.png',
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '选择好友发私信' }).click()
    await expect(page.getByRole('dialog', { name: '选择私信收件人' })).toBeVisible()
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '下一页联系人 1001' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '更多联系人' })).toHaveCount(0)
    await page.mouse.click(5, 5)
    await expect(page.getByRole('dialog', { name: '选择私信收件人' })).toHaveCount(0)
    await expect(page.getByLabel('私信内容')).toHaveValue('保留失败草稿')

    await page.getByRole('button', { name: '选择好友发私信' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Bob 789' }).click()
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText('Bob 的消息')
    delayAlice = true
    await page
      .locator('.conversation-list')
      .getByRole('button', { name: /^Alice/ })
      .click()
    await expect.poll(() => !!pendingResponse.finish).toBe(true)
    await page.locator('.conversation-list').getByRole('button', { name: /^Bob/ }).click()
    flushPending()
    delayAlice = false
    await expect(page.getByRole('log', { name: '私信消息' })).toContainText('Bob 的消息')
    expect(await page.getByRole('log', { name: '私信消息' }).innerText()).not.toContain(
      '旧会话延迟响应',
    )
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '观测记录' }).click()
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

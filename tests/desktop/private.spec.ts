import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inviteText } from '../../src/shared/private-messages'

test('private inbox joins official invitations and shares only after recipient confirmation', async () => {
  const self = { userId: 123, nickname: '我' },
    alice = { userId: 456, nickname: 'Alice' },
    bob = { userId: 789, nickname: 'Bob' }
  const stamp = Date.now() - 10000
  let active: string | null = null,
    delayAlice = false,
    failSend = false,
    failRead = true,
    aliceLastTime = stamp
  const pendingResponse: { finish: (() => void) | null } = { finish: null }
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
  ]
  const snapshot = () => ({
    roomId: active,
    multiRoomInfoDTO: { chatRoomId: '9988' },
    multiLtRoomUserAgg: {
      onlineNums: 3,
      onlineUserInfos: [123, 456, 789].map((uid) => ({ uid, nickname: `听友${uid}` })),
    },
  })
  const server = createServer(async (req, res) => {
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
        body = { code: 200, follow: [bob], more: false }
        break
      case '/send/text':
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
        body = { code: 200, data: { heartBeatDuration: 20 } }
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

    await page.getByRole('button', { name: '更多会话', exact: true }).click()
    await expect(page.locator('.conversation-list')).toContainText('Carol')
    await page.getByRole('button', { name: '加载更早私信' }).click()
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
    flushPending()
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

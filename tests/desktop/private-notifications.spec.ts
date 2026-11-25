import { mouseSide, openTool, showPrivateList, panelPage, widenPanel } from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Mini pushes open a player conversation while background HTTP stays idle and online contacts sort first', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'music-party-private-notices-'))
  const app = await electron.launch({
    args: [
      '.',
      `--ozone-platform=${process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'}`,
      '--password-store=basic',
    ],
    env: {
      ...process.env,
      MUSIC_PARTY_API_URL: 'http://127.0.0.1:9',
      MUSIC_PARTY_PROFILE: profile,
      ELECTRON_RENDERER_URL: '',
    },
  })
  try {
    const player = await app.firstWindow()
    await widenPanel(app, player, 760, 610)
    let page = player.locator('body')
    await app.evaluate(({ ipcMain }) => {
      const self = { userId: 123, nickname: '我' },
        alice = { userId: 456, nickname: 'Alice' },
        bob = { userId: 789, nickname: 'Bob' }
      const state = {
        calls: [] as { method: string; args?: any }[],
        timestamp: Date.now(),
        history: [] as any[],
        delayHistory: true,
        pendingHistory: null as null | (() => void),
        pendingSnapshot: null as null | (() => void),
        snapshotRequested: false,
      }
      ;(globalThis as any).__privateNotices = state
      ipcMain.removeHandler('api')
      ipcMain.handle('api', async (_event, request) => {
        const { method, args = {} } = request
        state.calls.push(request)
        let body: any = { code: 200 }
        if (method === 'account') body = { data: { profile: self } }
        if (method === 'playlists') body = { code: 200, playlist: [], more: false }
        if (method === 'albums') body = { code: 200, data: [], hasMore: false }
        if (method === 'likes') body = { code: 200, ids: [] }
        if (method === 'multiStatus') body = { code: 200, data: { multiLtRoomSnapshot: null } }
        if (method === 'privateConversations')
          body = {
            code: 200,
            more: false,
            msgs: [alice, bob].map((peer) => ({
              fromUser: peer,
              toUser: self,
              lastMsg: JSON.stringify({
                type: 1,
                msg: peer.userId === 456 ? '后台消息第二条' : '更早的 Bob 消息',
              }),
              lastMsgTime: peer.userId === 456 ? state.timestamp + 2 : state.timestamp - 10000,
              newMsgCount: peer.userId === 456 ? 2 : 0,
            })),
          }
        if (method === 'privatePresence')
          body = { code: 200, data: { uid: args.uid, online: args.uid === '789' } }
        if (method === 'privateHistory') {
          const historyBody = () => ({
            ok: true,
            data: { code: 200, more: false, msgs: [...state.history].reverse() },
          })
          if (state.delayHistory) {
            state.delayHistory = false
            return await new Promise((resolve) => {
              state.pendingHistory = () => {
                state.pendingHistory = null
                resolve(historyBody())
              }
            })
          }
          return historyBody()
        }
        if (method === 'privateSend')
          state.history.push({
            id: 300,
            fromUser: self,
            toUser: alice,
            time: state.timestamp + 3,
            msg: JSON.stringify({ type: 1, msg: args.text }),
          })
        if (method === 'follows') body = { code: 200, follow: [alice, bob], more: false }
        return { ok: true, data: body }
      })
      ipcMain.removeHandler('private-notifications')
      ipcMain.handle('private-notifications', async () => {
        state.snapshotRequested = true
        return await new Promise((resolve) => {
          state.pendingSnapshot = () => {
            state.pendingSnapshot = null
            resolve({
              accountUid: '123',
              session: 'notice-test-session',
              cursor: 0,
              connected: false,
              reset: false,
              events: [],
            })
          }
        })
      })
    })
    await player.clock.install()
    await player.reload()
    await player.bringToFront()
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() !== 'about:blank')!
        .focus(),
    )
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__privateNotices.snapshotRequested))
      .toBe(true)
    await player.clock.runFor(120000)
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__privateNotices.calls.filter((call: any) =>
            ['privateConversations', 'privateHistory'].includes(call.method),
          ).length,
      ),
    ).toBe(0)
    const pushMessages = async (sequences: number[], peer = { userId: 456, nickname: 'Alice' }) => {
      const time = await player.evaluate(() => Date.now())
      await app.evaluate(
        ({ BrowserWindow }, { ids, time, peer }) => {
          const state = (globalThis as any).__privateNotices
          state.timestamp = time
          const events = ids.map((sequence) => {
            const text =
              ['后台消息第一条', '后台消息第二条', '再次收到的消息'][sequence - 1] ??
              peer.nickname + ' 的第 ' + sequence + ' 条消息'
            state.history.push({
              id: 100 + sequence,
              fromUser: peer,
              toUser: { userId: 123, nickname: '我' },
              time: state.timestamp + sequence,
              msg: JSON.stringify({
                type: 1,
                msg: text,
                ...(sequence === 2 ? { album: { id: 101, name: '一张专辑' } } : {}),
              }),
            })
            return {
              sequence,
              notice: {
                kind: 'message',
                id: `notice-${sequence}`,
                peerUid: String(peer.userId),
                senderUid: String(peer.userId),
                senderName: peer.nickname,
                messageId: String(100 + sequence),
                timestamp: state.timestamp + sequence,
                messageType: 0,
                text,
                self: false,
              },
            }
          })
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL() !== 'about:blank')!
            .webContents.send('private-notifications', {
              accountUid: '123',
              session: 'notice-test-session',
              cursor: ids.at(-1),
              connected: true,
              reset: false,
              events,
            })
        },
        { ids: sequences, time, peer },
      )
    }
    await widenPanel(app, player, 385, 682)
    const compactMenu = player.getByRole('button', { name: '全部功能', exact: true })
    await expect(compactMenu).toBeVisible()
    await expect(compactMenu.locator('.unread-dot')).toHaveCount(0)
    await widenPanel(app, player, 760, 610)
    await pushMessages([1, 2])
    const bubbles = player.locator('[data-notice="private"] .notice-peers')
    await expect(bubbles).toContainText('后台消息第二条')
    await expect(bubbles).not.toContainText('后台消息第一条')
    await expect(bubbles).toBeInViewport()
    expect(app.windows()).toHaveLength(1)
    await expect(player.locator('[data-panel="private"]')).toBeHidden()
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__privateNotices.calls.filter(
            (call: any) => call.method === 'privateRead',
          ).length,
      ),
    ).toBe(0)
    await app.evaluate(() => (globalThis as any).__privateNotices.pendingSnapshot?.())
    await bubbles.getByRole('button', { name: /Alice/ }).click()
    const privateWindow = await panelPage(app, 'private')
    const conversation = privateWindow.locator('.private-compact')
    await expect(conversation).toBeVisible()
    await expect(player.locator('.adaptive-player-bar .playhead')).toBeAttached()
    await expect(conversation.getByText('正在读取私信…')).toBeVisible()
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__privateNotices.calls.filter(
            (call: any) => call.method === 'privateRead',
          ).length,
      ),
    ).toBe(0)
    await app.evaluate(() => (globalThis as any).__privateNotices.pendingHistory?.())
    await expect(conversation.getByRole('log')).toContainText('后台消息第二条')
    const quote = conversation.getByRole('log').locator('.chat-bubble')
    await expect(quote).toHaveCount(1)
    await expect(quote.locator('.message-caption')).toHaveText('后台消息第二条')
    await expect(quote.getByRole('button', { name: '查看专辑 一张专辑' })).toBeVisible()
    await expect
      .poll(() =>
        app.evaluate(() =>
          (globalThis as any).__privateNotices.calls.some(
            (call: any) => call.method === 'privateRead',
          ),
        ),
      )
      .toBe(true)
    const content = conversation.getByLabel('私信内容')
    await content.fill('第一行')
    await content.press('Enter')
    await content.pressSequentially('第二行')
    await expect(content).toHaveValue('第一行\n第二行')
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__privateNotices.calls.filter(
            (call: any) => call.method === 'privateSend',
          ).length,
      ),
    ).toBe(0)
    await content.press('Control+Enter')
    await expect(content).toHaveValue('')
    const sent = await app.evaluate(() =>
      (globalThis as any).__privateNotices.calls.filter(
        (call: any) => call.method === 'privateSend',
      ),
    )
    expect(sent).toHaveLength(1)
    expect(sent[0].args).toMatchObject({ uid: '456', text: '第一行\n第二行' })
    await content.fill('保留下来的草稿')
    // A compact conversation docks to the bottom in portrait and to the side in landscape.
    for (const [width, height] of [
      [390, 650],
      [760, 610],
      [1100, 720],
    ]) {
      await widenPanel(app, player, width, height)
      const card = player.locator('.surface-drawer[data-panel="private"]')
      await expect(card).toBeInViewport({ ratio: 1 })
      await expect(card.getByRole('button', { name: '打开完整对话' })).toBeVisible()
      const headerTools = card.locator('.panel-titlebar .icon-btn')
      await expect(headerTools).toHaveCount(2)
      for (const button of await headerTools.all()) {
        await expect(button).toHaveCSS('width', '32px')
        await expect(button).toHaveCSS('height', '32px')
        await expect(button).toHaveCSS('border-radius', '5px')
      }
      await expect(content).toHaveValue('保留下来的草稿')
      await expect(player.locator('[data-panel="library"]')).toBeVisible()
      const rect = (await card.boundingBox())!
      if (width < 520)
        expect(rect.y + rect.height).toBeCloseTo(
          (await player.locator('.footer-slot').boundingBox())!.y,
          0,
        )
      else {
        expect(rect.x + rect.width).toBeCloseTo(width, 0)
        expect(rect.y).toBe(0)
        await expect(player.getByRole('group', { name: '窗口控制' })).toHaveCount(0)
      }
    }
    await player.keyboard.press('Escape')
    await expect(player.locator('[data-panel="library"]')).toBeVisible()
    await expect(conversation).toBeHidden()
    const backgroundBefore = await app.evaluate(
      () =>
        (globalThis as any).__privateNotices.calls.filter((call: any) =>
          ['privateConversations', 'privateHistory'].includes(call.method),
        ).length,
    )
    await player.clock.runFor(120000)
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__privateNotices.calls.filter((call: any) =>
            ['privateConversations', 'privateHistory'].includes(call.method),
          ).length,
      ),
    ).toBe(backgroundBefore)
    await pushMessages([3])
    await expect(bubbles).toContainText('再次收到的消息')
    await bubbles.getByRole('button', { name: /Alice/ }).click()
    await expect(conversation).toBeVisible()
    await privateWindow.getByRole('button', { name: '打开完整对话' }).click()
    const fullPage = player.locator('.surface-page[data-panel="private"]')
    await expect(conversation).toBeHidden()
    for (const [width, height] of [
      [1100, 720],
      [760, 610],
      [321, 682],
    ]) {
      await widenPanel(app, player, width, height)
      await expect(fullPage.getByLabel('私信内容')).toHaveValue('保留下来的草稿')
      await expect(
        fullPage.getByRole('navigation', { name: '页面导航' }).locator('[aria-current="page"]'),
      ).toHaveText('Alice')
      await expect(player.locator('.drawer-scrim')).toHaveCount(0)
      await player.screenshot({
        path: test.info().outputPath('private-' + width + '.png'),
        animations: 'disabled',
      })
    }
    await fullPage.getByRole('button', { name: '返回私信列表' }).click()
    await expect(fullPage.locator('.conversation-pane')).toBeVisible()
    await mouseSide(player, 'forward', 100, 180)
    await expect(fullPage.getByLabel('私信内容')).toHaveValue('保留下来的草稿')
    await mouseSide(player, 'back', 100, 180)
    await expect(fullPage.locator('.conversation-pane')).toBeVisible()
    page = await panelPage(app, 'private')
    await showPrivateList(page)
    await expect(page.locator('.private-connection')).toHaveText('实时')
    await expect(page.locator('.conversation-list > button').first().locator('strong')).toHaveText(
      'Bob',
    )
    await expect(
      page.locator('.conversation-list > button').first().getByLabel('在线'),
    ).toBeVisible()
    await expect(page.locator('.conversation-list > button').nth(1).locator('strong')).toHaveText(
      'Alice',
    )
    await player.screenshot({
      path: test.info().outputPath('compact-inbox.png'),
      animations: 'disabled',
    })
    await mouseSide(player, 'back', 100, 180)
    await expect(player.locator('.surface-page[data-panel="library"]')).toBeVisible()
    await openTool(app, player, 'private')
    await expect(fullPage.locator('.conversation-pane')).toBeVisible()
    await expect(player.locator('.drawer-scrim')).toHaveCount(0)

    await fullPage.getByRole('button', { name: /^Alice/ }).click()
    const threadName = fullPage.locator('.private-thread-heading strong')
    const input = fullPage.getByLabel('私信内容')
    await input.fill('只发给 Alice 的草稿')
    const bob = { userId: 789, nickname: 'Bob' }
    await pushMessages([4], bob)
    await expect(bubbles.getByRole('button', { name: /Bob/ })).toBeVisible()
    await player.clock.runFor(7100)
    await expect(bubbles).toBeHidden()
    await expect(threadName).toHaveText('Alice')
    await expect(input).toHaveValue('只发给 Alice 的草稿')
    await pushMessages([5], bob)
    await bubbles.getByRole('button', { name: /Bob/ }).click()
    await expect(threadName).toHaveText('Bob')
    await expect(input).toHaveValue('')
    await expect(conversation).toBeHidden()
    await input.fill('只发给 Bob 的草稿')
    await mouseSide(player, 'back', 100, 180)
    await expect(threadName).toHaveText('Alice')
    await expect(input).toHaveValue('只发给 Alice 的草稿')
    await openTool(app, player, 'library')
    await pushMessages([6])
    await pushMessages([7], bob)
    await expect(bubbles.getByRole('button', { name: /Alice/ })).toBeVisible()
    await widenPanel(app, player, 385, 682)
    await expect(compactMenu.locator('.unread-dot')).toBeVisible()
    await expect(compactMenu).toHaveAccessibleDescription(/^\d+ 条未读私信$/)
    const unread = (await compactMenu.getAttribute('aria-description'))!.split(' ')[0]
    await compactMenu.click()
    const inboxEntry = player
      .getByRole('navigation', { name: '全部功能' })
      .getByRole('button', { name: '私信', exact: true })
    await expect(inboxEntry.locator('small')).toHaveText(unread)
    await expect(inboxEntry).toHaveAccessibleDescription(unread + ' 条未读')
    await player.keyboard.press('Escape')
    await bubbles.getByRole('button', { name: /Bob/ }).click()
    await expect(conversation).toBeVisible()
    await expect(conversation.getByRole('log')).toContainText('Bob 的第 7 条消息')
    await expect(content).toHaveValue('只发给 Bob 的草稿')
  } finally {
    await app
      .evaluate(() => {
        const state = (globalThis as any).__privateNotices
        state?.pendingSnapshot?.()
        state?.pendingHistory?.()
      })
      .catch(() => {})
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})

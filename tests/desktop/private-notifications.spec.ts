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
    const page = await app.firstWindow()
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
    await page.clock.install()
    await page.reload()
    await page.bringToFront()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__privateNotices.snapshotRequested))
      .toBe(true)
    await page.clock.runFor(120000)
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__privateNotices.calls.filter((call: any) =>
            ['privateConversations', 'privateHistory'].includes(call.method),
          ).length,
      ),
    ).toBe(0)
    await app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__privateNotices
      const events = [1, 2].map((sequence) => {
        const text = sequence === 1 ? '后台消息第一条' : '后台消息第二条'
        state.history.push({
          id: 100 + sequence,
          fromUser: { userId: 456, nickname: 'Alice' },
          toUser: { userId: 123, nickname: '我' },
          time: state.timestamp + sequence,
          msg: JSON.stringify({ type: 1, msg: text }),
        })
        return {
          sequence,
          notice: {
            kind: 'message',
            id: `notice-${sequence}`,
            peerUid: '456',
            senderUid: '456',
            senderName: 'Alice',
            messageId: String(100 + sequence),
            timestamp: state.timestamp + sequence,
            messageType: 0,
            text,
            self: false,
          },
        }
      })
      BrowserWindow.getAllWindows()[0].webContents.send('private-notifications', {
        accountUid: '123',
        session: 'notice-test-session',
        cursor: 2,
        connected: true,
        reset: false,
        events,
      })
    })
    const bubbles = page.getByLabel('新私信通知')
    await expect(bubbles).toContainText('后台消息第二条')
    await expect(bubbles).not.toContainText('后台消息第一条')
    const position = await bubbles.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(position!.x).toBeGreaterThan(viewport.width / 2)
    expect(position!.y).toBeLessThan(viewport.height / 2)
    expect(viewport.width - position!.x - position!.width).toBeGreaterThanOrEqual(19)
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__privateNotices.calls.filter(
            (call: any) => call.method === 'privateRead',
          ).length,
      ),
    ).toBe(0)
    // Hover pauses this notification's eight-second preview; afterward the avatar remains.
    await bubbles.hover()
    await page.clock.runFor(9000)
    await expect(bubbles).toContainText('后台消息第二条')
    await page.mouse.move(30, 30)
    await page.clock.runFor(8100)
    await expect(bubbles.locator('.private-bubble-content')).toHaveCount(0)
    await page.mouse.move(40, 40)
    await expect(bubbles.getByRole('button', { name: /与Alice对话/ })).toBeVisible()
    // A stale initial snapshot must not downgrade live push metadata to disconnected.
    await app.evaluate(() => (globalThis as any).__privateNotices.pendingSnapshot?.())
    await bubbles.getByRole('button', { name: /与Alice对话/ }).click()
    const conversation = page.getByRole('dialog', { name: '与 Alice 对话' })
    await expect(conversation).toBeVisible()
    await expect(conversation.locator('.private-connection')).toHaveText('实时')
    await expect(page.getByLabel('播放界面', { exact: true })).toBeVisible()
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
    await conversation.getByRole('button', { name: '关闭与 Alice 对话' }).click()
    await page.clock.runFor(200)
    await expect(conversation).toBeHidden()
    await expect(
      page.getByLabel('新私信通知').getByRole('button', { name: /与Alice对话/ }),
    ).toBeVisible()
    const backgroundBefore = await app.evaluate(
      () =>
        (globalThis as any).__privateNotices.calls.filter((call: any) =>
          ['privateConversations', 'privateHistory'].includes(call.method),
        ).length,
    )
    await page.clock.runFor(120000)
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__privateNotices.calls.filter((call: any) =>
            ['privateConversations', 'privateHistory'].includes(call.method),
          ).length,
      ),
    ).toBe(backgroundBefore)
    await page.locator('.sidebar').getByRole('button', { name: /^私信/ }).click()
    await expect(page.locator('.conversation-list > button').first().locator('strong')).toHaveText(
      'Bob',
    )
    await expect(
      page.locator('.conversation-list > button').first().getByLabel('在线'),
    ).toBeVisible()
    await expect(page.locator('.conversation-list > button').nth(1).locator('strong')).toHaveText(
      'Alice',
    )
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

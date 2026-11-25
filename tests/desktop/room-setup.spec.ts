import {
  createChineseProfile,
  expectQueueHeaderFits,
  expectRoomHeaderSingleLine,
  openTool,
  panelPage,
  widenPanel,
} from './windows'
import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { rm } from 'node:fs/promises'

test('room creation, rematching, cancellation and notification ACK keep the selected matching song', async () => {
  test.setTimeout(90000)
  const wav = Buffer.alloc(44 + 8000 * 2 * 30)
  wav.write('RIFF')
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(16000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(wav.length - 44, 40)
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'audio/wav')
    response.end(wav)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const audioUrl = `http://127.0.0.1:${(server.address() as any).port}/audio.wav`
  const profile = await createChineseProfile('music-party-room-setup-')
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
    let page = player.locator('body')
    // Isolate the renderer workflow; production service payload/permissions are unit-tested.
    await app.evaluate(({ ipcMain }, url) => {
      const state = {
        calls: [] as any[],
        accountUid: 123,
        active: true,
        song: '111',
        roomId: 'setup-room',
        roomBizType: 1,
        matchingSong: '',
        matchStarted: 0,
        notices: [] as any[],
        pendingLike: null as null | (() => void),
      }
      ;(globalThis as any).__roomSetup = state
      const track = (id: string) => ({
        id,
        name: `歌曲${id}`,
        ar: [{ name: '测试歌手' }],
        al: { name: '测试专辑', picUrl: '' },
        dt: 30000,
      })
      const playback = () => ({
        playSong: { songId: state.song, songBizId: `900${state.song}`, songRcmdUid: '123' },
        nextSongs: [],
        version: 1,
        playedTime: 0,
        songDuration: 30000,
      })
      const snapshot = () => ({
        roomId: state.roomId,
        roomPlaySongInfo: playback(),
        multiRoomInfoDTO: {
          chatRoomId: '8877',
          roomBizType: state.roomBizType,
          creatorId: state.roomBizType === 3 ? 789 : 123,
        },
        multiLtRoomUserAgg: {
          onlineNums: state.roomBizType === 3 ? 2 : 1,
          onlineUserInfos: [
            { uid: 123, nickname: '测试用户' },
            ...(state.roomBizType === 3 ? [{ uid: 789, nickname: '周末听友' }] : []),
          ],
        },
      })
      ipcMain.removeHandler('api')
      ipcMain.handle('api', async (_event, request) => {
        const { method, args = {} } = request
        state.calls.push(request)
        let body: any = { code: 200 }
        if (method === 'account')
          body = { data: { profile: { userId: state.accountUid, nickname: '测试用户' } } }
        if (method === 'playlists') body = { code: 200, playlist: [], more: false }
        if (method === 'albums') body = { code: 200, data: [], hasMore: false }
        if (method === 'likes') body = { code: 200, ids: state.accountUid === 123 ? ['222'] : [] }
        if (method === 'like' && args.value === true)
          return await new Promise((resolve) => {
            state.pendingLike = () => {
              state.pendingLike = null
              resolve({ ok: true, data: { code: 200 } })
            }
          })
        if (method === 'multiRedHeart') body = { code: 200, data: { failedCode: 0, result: true } }
        if (method === 'song') body = { code: 200, songs: String(args.ids).split(',').map(track) }
        if (method === 'search') {
          const matches: Record<string, string[]> = {
            开房新歌: ['222', '333'],
            换房新歌: ['444', '222'],
          }
          body = { code: 200, result: { songs: (matches[args.keywords] || []).map(track) } }
        }
        if (method === 'stream') body = { code: 200, data: [{ url }] }
        if (method === 'lyrics') body = { code: 200, lrc: { lyric: '' } }
        if (method === 'privateConversations') body = { code: 200, msgs: [], more: false }
        if (method === 'multiCreate') {
          state.active = true
          state.song = args.songId
          state.roomBizType = args.allowStrangerMatch === true ? 2 : 1
          body = { code: 200, data: { success: true, multiLtRoomSnapshot: snapshot() } }
        }
        if (method === 'multiStatus')
          body = { code: 200, data: { multiLtRoomSnapshot: state.active ? snapshot() : null } }
        if (method === 'multiPreview')
          body = {
            code: 200,
            data: { inviter: { nickname: '模拟好友' }, songData: { name: '邀请预览歌曲' } },
          }
        if (method === 'multiHeartbeat')
          body = { code: 200, data: { heartBeatDuration: 30, roomPlaySongInfo: playback() } }
        if (method === 'multiSongInfo') body = { code: 200, data: { liked: false, songInfo: {} } }
        if (method === 'multiChatHistory')
          body = {
            code: 200,
            data: {
              records: Array.from({ length: 36 }, (_, i) => ({
                msgType: 0,
                sendUid: 456,
                sendTime: 1700000000000 + i,
                imChatRoomMsgBody: { text: '房间历史 ' + i },
              })),
              page: { more: false },
            },
          }
        if (method === 'multiQueue') {
          const offset = Number(args.cursor || 0)
          body = {
            data: {
              roomTagList: ['二次元', '电子', '流行'],
              songLists: Array.from({ length: 15 }, (_, i) => ({
                songInfo: {
                  resourceId: 1000 + offset + i,
                  bizId: 2000 + offset + i,
                  title: '待播 ' + (offset + i),
                },
              })),
              page: { more: offset < 30, cursor: String(offset + 15) },
            },
          }
        }
        if (method === 'multiLeave' || method === 'multiRematchLeave') {
          state.active = false
          body = { code: 200, data: { success: true } }
        }
        if (method === 'multiMatch') {
          state.matchingSong = args.songId
          state.matchStarted = Date.now()
          body = {
            code: 200,
            data: {
              success: true,
              startMatchTimeMills: state.matchStarted,
              maxWaitTimeMills: 60000,
            },
          }
        }
        if (method === 'multiMatchCancel') body = { code: 200, data: { success: true } }
        if (method === 'multiJoin') {
          state.active = true
          state.roomId = args.roomId
          state.song = state.matchingSong
          state.roomBizType = 3
          body = { code: 200, data: { success: true, multiLtRoomSnapshot: snapshot() } }
        }
        return { ok: true, data: body }
      })
      for (const channel of ['match-open', 'match-poll', 'match-close'])
        ipcMain.removeHandler(channel)
      ipcMain.handle('match-open', (_event, id) => {
        state.calls.push({ method: 'matchOpen', id })
        state.notices = []
      })
      ipcMain.handle('match-poll', () => state.notices.splice(0))
      ipcMain.handle('match-close', (_event, id) => {
        state.calls.push({ method: 'matchClose', id })
      })
    }, audioUrl)
    await player.reload()
    page = await openTool(app, player, 'search')
    await page.getByLabel('搜索音乐库').fill('111')
    await page
      .locator('.panel-header-slot .header-search')
      .getByRole('button', { name: '搜索', exact: true })
      .click()
    await page.getByRole('button', { name: '播放 歌曲111' }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('歌曲111')
    page = await openTool(app, player, 'room')
    const roomBadge = player.locator('.footer-room .transport-count')
    await expect(roomBadge).toHaveCount(0)
    const picker = player.getByRole('dialog', { name: '切换歌曲', exact: true })
    const choice = page.locator('.match-song-selected strong')
    const playingTitle = player.locator(
      '.footer-track-copy strong:visible, .immersive-song-heading h1:visible',
    )
    async function useMatchingSong(query: string, title: string, liked: boolean) {
      await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
      const search = picker.getByRole('searchbox', { name: '搜索匹配用歌曲' })
      await search.fill(query)
      await search.press('Enter')
      const results = picker.getByRole('group', { name: '匹配歌曲搜索结果' })
      await expect(results.getByRole('button')).toHaveCount(2)
      await expect(results.getByRole('img', { name: '已红心', exact: true })).toBeVisible()
      await expect(results.getByRole('img', { name: '未红心', exact: true })).toBeVisible()
      const row = results.getByRole('button', { name: new RegExp(title) })
      const indicator = row.getByRole('img', { name: liked ? '已红心' : '未红心', exact: true })
      await expect(indicator).toBeInViewport()
      const box = (await indicator.boundingBox())!
      await player.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect(picker).toBeHidden()
      await expect(choice).toHaveText(title)
      const mutations = await app.evaluate(() =>
        (globalThis as any).__roomSetup.calls.filter((c: any) =>
          ['like', 'multiRedHeart'].includes(c.method),
        ),
      )
      expect(mutations).toHaveLength(0)
    }
    await test.step('an existing account room can be left without interrupting personal playback', async () => {
      await expect(page.getByRole('heading', { name: '继续一起听' })).toBeVisible()
      await expect(page.getByText('1 人一起听', { exact: true })).toBeVisible()
      await expect(page.getByText('测试用户', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '用当前歌曲创建' })).toBeDisabled()
      await page.getByRole('button', { name: '退出当前房间', exact: true }).click()
      await player
        .getByRole('dialog', { name: '退出当前房间？' })
        .getByRole('button', { name: '取消', exact: true })
        .click()
      expect(
        await app.evaluate(
          () =>
            (globalThis as any).__roomSetup.calls.filter((c: any) => c.method === 'multiLeave')
              .length,
        ),
      ).toBe(0)
      await page.getByRole('button', { name: '退出当前房间', exact: true }).click()
      await player.getByRole('button', { name: '确认离开', exact: true }).click()
      await expect(page.getByRole('heading', { name: '继续一起听' })).toBeHidden()
      await expect(playingTitle).toHaveText('歌曲111')
      await expect
        .poll(() => player.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused))
        .toBe(false)
    })
    await test.step('a short portrait room sheet keeps the title and playback controls reachable at 150% display size', async () => {
      await widenPanel(app, player, 321, 350)
      await player.evaluate(() => window.together.updatePreferences({ fontScale: 150 }))
      const heading = page.locator('.panel-titlebar')
      await expect(heading).toBeInViewport({ ratio: 1 })
      await expectRoomHeaderSingleLine(page)
      const top = (await heading.boundingBox())!.y
      const contents = page.locator('.panel-content')
      await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
      await expect(picker).toBeVisible()
      const search = picker.getByRole('searchbox', { name: '搜索匹配用歌曲' })
      await expect(search).toBeInViewport({ ratio: 0.95 })
      await expect(picker.getByRole('button', { name: '搜索', exact: true })).toBeInViewport({
        ratio: 0.95,
      })
      await search.fill('找不到这首')
      await search.press('Enter')
      await expect(picker.getByRole('status')).toHaveText('没有找到匹配的歌曲')
      await expect(
        picker.getByRole('group', { name: '匹配歌曲搜索结果' }).getByRole('button'),
      ).toHaveCount(0)
      await player.keyboard.press('Escape')
      await expect(picker).toBeHidden()
      await expect(choice).toHaveText('歌曲111')
      await expect(playingTitle).toHaveText('歌曲111')
      await page
        .getByLabel('一起听邀请链接')
        .fill(
          'https://st.music.163.com/listen-together/multishare/index.html?roomId=preview-room&inviterUid=456',
        )
      await page.getByRole('button', { name: '预览邀请', exact: true }).click()
      const preview = contents.getByText('邀请预览歌曲', { exact: true })
      await expect(preview).toHaveCount(1)
      await contents.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await expect(preview).toBeInViewport({ ratio: 1 })
      expect(await contents.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      expect((await heading.boundingBox())!.y).toBe(top)
      const sheet = (await player.locator('.surface-drawer').boundingBox())!
      expect(sheet.y + sheet.height).toBeCloseTo(
        (await player.locator('.footer-slot').boundingBox())!.y,
        0,
      )
      await player.locator('.adaptive-player-bar .primary-play').click({ trial: true })
      await heading.getByRole('button', { name: '关闭一起听', exact: true }).click()
      await expect(player.locator('.surface-drawer')).toHaveCount(0)
      page = await openTool(app, player, 'room')
      await player.evaluate(() => window.together.updatePreferences({ fontScale: 100 }))
      await widenPanel(app, player, 740, 590)
    })
    await expect(page.getByRole('searchbox', { name: '搜索匹配用歌曲' })).toHaveCount(0)
    await useMatchingSong('开房新歌', '歌曲222', true)
    await expect(playingTitle).toHaveText('歌曲111')
    const beforeCreate = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(
      beforeCreate.some((c: any) => c.method === 'search' && c.args?.keywords === '开房新歌'),
    ).toBe(true)
    expect(
      beforeCreate.filter((c: any) => ['multiCreate', 'multiMatch', 'multiAdd'].includes(c.method)),
    ).toHaveLength(0)
    await page.getByRole('button', { name: '关闭一起听' }).click()
    page = await openTool(app, player, 'search')
    await page.getByLabel('搜索音乐库').fill('333')
    await page
      .locator('.panel-header-slot .header-search')
      .getByRole('button', { name: '搜索', exact: true })
      .click()
    await page.getByRole('button', { name: '播放 歌曲333' }).click()
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('歌曲333')
    page = await openTool(app, player, 'room')
    await expect(page.locator('.match-song-selected strong')).toHaveText('歌曲222')
    await page.getByLabel('允许陌生人匹配', { exact: true }).check()
    await page.getByRole('button', { name: '用当前歌曲创建', exact: true }).click()
    await expect(page.getByRole('button', { name: '查看房间成员', exact: true })).toContainText(
      '1 人',
    )
    await expect(roomBadge).toHaveText('1')
    const creation = await app.evaluate(() =>
      (globalThis as any).__roomSetup.calls.find((call: any) => call.method === 'multiCreate'),
    )
    expect(creation.args).toEqual({ songId: '222', allowStrangerMatch: true })
    await expect(page.getByRole('heading', { name: '房间信息' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '遇见新的听友' })).toBeVisible()
    const facts = page.locator('.room-facts')
    const chineseLabels = ['在线成员', '房间类型', '创建者', '音乐标签']
    await expect(facts.locator('dt')).toHaveText(chineseLabels)
    await expect(facts.locator('dd')).toHaveText([
      '1 人',
      '公开好友房',
      '测试用户',
      '二次元 · 电子 · 流行',
    ])
    for (const row of await facts.locator(':scope > div').all()) {
      const labelSize = await row.locator('dt').evaluate((el) => getComputedStyle(el).fontSize)
      await expect(row.locator('dd')).toHaveCSS('font-size', labelSize)
      for (const link of await row.getByRole('button').all())
        await expect(link).toHaveCSS('font-size', labelSize)
    }
    await expect(page.getByRole('button', { name: '复制邀请链接' })).toBeVisible()
    await expect(page.getByRole('button', { name: '私信邀请' })).toBeVisible()
    const room = page
    await test.step('room sheets follow their content and adjacent drawers share the available rectangle', async () => {
      const footer = player.locator('.adaptive-player-bar')
      const chat = player.locator('.surface-drawer[data-panel=chat]')
      const queue = player.locator('.surface-drawer[data-panel=queue]')
      await player.emulateMedia({ reducedMotion: 'reduce' })
      await widenPanel(app, player, 374, 902)
      const leave = (await room.locator('.room-leave').boundingBox())!
      const barTop = (await footer.boundingBox())!.y
      expect(barTop - leave.y - leave.height).toBeCloseTo(16, 0)
      const dismissNotice = player.getByRole('button', { name: '关闭播放提示' })
      if (await dismissNotice.isVisible()) await dismissNotice.click()
      await player.evaluate(() => window.together.updatePreferences({ theme: 'dark' }))
      await expect(player.locator('html')).toHaveAttribute('data-theme', 'dark')
      await player.mouse.move(2, 2)
      await player.screenshot({
        path: test.info().outputPath('room-portrait.png'),
        animations: 'disabled',
      })
      await footer.getByRole('button', { name: '房间聊天', exact: true }).click()
      const content = chat.getByLabel('聊天内容', { exact: true })
      await content.fill('切换回来仍保留的草稿')
      const log = chat.locator('.chat-messages')
      await expect(log).toContainText('房间历史 35')
      await log.evaluate((el) => {
        el.scrollTop = 100
      })
      await expect(chat.getByRole('button', { name: '回到最新消息' })).toBeVisible()
      expect(await log.evaluate((el) => el.scrollTop)).toBeCloseTo(100, 0)
      await footer.getByRole('button', { name: '播放队列', exact: true }).click()
      await expect(queue.locator('.queue-track')).toHaveCount(45)
      const list = queue.locator('.queue-drawer-list')
      await list.evaluate((el) => {
        el.scrollTop = 1500
      })
      await queue.getByRole('button', { name: '返回房间聊天', exact: true }).click()
      await expect(content).toHaveValue('切换回来仍保留的草稿')
      await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBeCloseTo(100, 0)
      await footer.getByRole('button', { name: '播放队列', exact: true }).click()
      await expect(queue.locator('.queue-track')).toHaveCount(45)
      expect(await list.evaluate((el) => el.scrollTop)).toBeCloseTo(1500, 0)
      await player.keyboard.press('Escape')
      await player.keyboard.press('Escape')
      await expect(room.locator('.room-leave')).toBeVisible()
      expect((await room.locator('.room-leave').boundingBox())!.y).toBeCloseTo(leave.y, 0)
      await player.keyboard.press('Escape')
      for (const now of [false, true]) {
        if (now) await footer.getByRole('button', { name: '展开正在播放', exact: true }).click()
        await expect(footer.getByRole('slider', { name: '播放进度' })).toBeDisabled()
        await expect(footer.getByTitle('进度由一起听房间同步')).toHaveCount(0)
        await expect(footer.getByText('房间同步', { exact: true })).toHaveCount(0)
        await expect(footer.getByRole('button', { name: '收起正在播放' })).toHaveCount(0)
        await footer.getByRole('button', { name: '房间聊天', exact: true }).click()
        for (const [width, height] of [
          [321, 682],
          [740, 590],
          [900, 722],
          [1159, 750],
        ]) {
          await player.evaluate(
            (fontScale) => window.together.updatePreferences({ fontScale }),
            width === 321 ? 150 : 100,
          )
          await widenPanel(app, player, width, height)
          await expectRoomHeaderSingleLine(chat)
          const expandedRoom = await player.evaluate(
            () => matchMedia('(min-width: 1040px)').matches,
          )
          const roomLabel = footer.locator('.footer-room-label')
          await expect(roomBadge).toBeVisible({ visible: !expandedRoom })
          await expect(roomLabel).toBeVisible({ visible: expandedRoom })
          if (expandedRoom) await expect(roomLabel).toHaveText('1 人一起听')
          const bar = (await footer.boundingBox())!
          const chatBox = (await chat.boundingBox())!
          const viewport = await player.evaluate(() => ({ width: innerWidth, height: innerHeight }))
          expect(Math.abs(bar.y + bar.height - viewport.height)).toBeLessThanOrEqual(1)
          expect(Math.abs(chatBox.x + chatBox.width - viewport.width)).toBeLessThanOrEqual(1)
          expect(chatBox.y + chatBox.height).toBeCloseTo(bar.y, 0)
          if (viewport.width >= 520) expect(chatBox.y).toBe(0)
          else expect(Math.abs(chatBox.width - viewport.width)).toBeLessThanOrEqual(1)
          const windowButtonsVisible = !now && viewport.width < 520
          const windowControls = player.getByRole('group', { name: '窗口控制' })
          await expect(windowControls).toHaveCount(windowButtonsVisible ? 1 : 0)
          if (windowButtonsVisible)
            await player.getByRole('button', { name: '最大化', exact: true }).click({ trial: true })
          await footer.getByRole('button', { name: '播放队列', exact: true }).click()
          await expect(queue).toBeVisible()
          await expect(windowControls).toHaveCount(windowButtonsVisible ? 1 : 0)
          expect(await queue.boundingBox()).toEqual(chatBox)
          await expect(queue.getByRole('heading', { name: '房间待播列表' })).toBeVisible()
          await expectQueueHeaderFits(queue)
          await expectRoomHeaderSingleLine(queue)
          const orderBar = queue.locator('.room-queue-order')
          await expect(orderBar).toContainText('待播顺序由一起听房间同步')
          const centerOffset = await orderBar.evaluate((bar) => {
            const label = bar.getBoundingClientRect()
            const items = Array.from(bar.children, (child) => child.getBoundingClientRect())
            const top = Math.min(...items.map((rect) => rect.top))
            const bottom = Math.max(...items.map((rect) => rect.bottom))
            return Math.abs((top + bottom - label.top - label.bottom) / 2)
          })
          expect(centerOffset).toBeLessThanOrEqual(1)
          await queue.getByRole('button', { name: '返回房间聊天', exact: true }).click()
        }
        await footer.getByRole('button', { name: '播放队列', exact: true }).click()
        await queue.getByRole('button', { name: '关闭房间待播列表', exact: true }).click()
        await expect(player.locator('.surface-drawer')).toHaveCount(0)
      }
      await player.getByRole('button', { name: '返回浏览', exact: true }).click()
      await footer.getByRole('button', { name: '一起听', exact: true }).click()
    })
    await useMatchingSong('换房新歌', '歌曲444', false)
    await expect(playingTitle).toHaveText('歌曲222')
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__roomSetup.calls.filter((c: any) =>
            ['multiRematchLeave', 'multiMatch', 'multiAdd'].includes(c.method),
          ).length,
      ),
    ).toBe(0)
    await room.getByRole('button', { name: '重新匹配', exact: true }).click()
    await expect(page.getByRole('button', { name: '取消匹配', exact: true })).toBeVisible()
    let calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.find((call: any) => call.method === 'multiRematchLeave').args.roomId).toBe(
      'setup-room',
    )
    expect(calls.filter((call: any) => call.method === 'multiMatch').at(-1).args.songId).toBe('444')
    await page.getByRole('button', { name: '取消匹配', exact: true }).click()
    await expect(page.getByRole('button', { name: '取消匹配', exact: true })).toBeHidden()
    calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.filter((call: any) => call.method === 'multiMatchCancel')).toHaveLength(1)
    await room.getByRole('button', { name: '匹配房间', exact: true }).click()
    await expect(page.locator('.match-progress')).toContainText('正在寻找房间')
    await app.evaluate(() => {
      const state = (globalThis as any).__roomSetup
      state.notices.push({
        timestamp: state.matchStarted + 1,
        notice: { kind: 'ready', roomId: 'matched-room' },
      })
    })
    await expect(room.getByRole('heading', { name: '房间信息' })).toBeVisible()
    await expect(facts.locator('dt')).toHaveText(chineseLabels)
    await expect(facts.locator('dd')).toHaveText([
      '2 人',
      '公开匹配房',
      '周末听友',
      '二次元 · 电子 · 流行',
    ])
    await player.evaluate(() => window.together.updatePreferences({ language: 'en' }))
    await expect(facts.locator('dt')).toHaveText([
      'Online members',
      'Room type',
      'Created by',
      'Music tags',
    ])
    await expect(facts.locator('dd')).toHaveText([
      '2 online',
      'Public matching room',
      '周末听友',
      '二次元 · 电子 · 流行',
    ])
    await player.evaluate(() => window.together.updatePreferences({ language: 'zh-CN' }))
    calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.find((call: any) => call.method === 'multiJoin').args).toEqual({
      roomId: 'matched-room',
      inviterUid: '0',
    })
    expect(
      calls
        .filter((call: any) => call.method === 'multiMatch')
        .map((call: any) => call.args.songId),
    ).toEqual(['444', '444'])
    await expect(
      player.locator('.footer-track-copy strong:visible, .immersive-song-heading h1:visible'),
    ).toHaveText('歌曲444')
    await player.getByRole('button', { name: '喜欢当前歌曲', exact: true }).click()
    await expect(player.getByRole('button', { name: '喜欢当前歌曲', exact: true })).toBeDisabled()
    calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.filter((call: any) => call.method === 'like')).toHaveLength(1)
    expect(calls.filter((call: any) => call.method === 'multiRedHeart')).toHaveLength(0)
    await app.evaluate(() => (globalThis as any).__roomSetup.pendingLike?.())
    await expect(
      player.getByRole('button', { name: '取消喜欢当前歌曲', exact: true }),
    ).toBeEnabled()
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as any).__roomSetup.calls.filter(
              (call: any) => call.method === 'multiRedHeart',
            ).length,
        ),
      )
      .toBe(1)
    calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.find((call: any) => call.method === 'like').args).toEqual({
      id: '444',
      value: true,
    })
    expect(calls.find((call: any) => call.method === 'multiRedHeart').args).toEqual({
      roomId: 'matched-room',
      songId: '444',
      bizId: '900444',
    })
    await player.getByRole('button', { name: '取消喜欢当前歌曲', exact: true }).click()
    page = await panelPage(app, 'confirm')
    await expect(
      player.getByRole('dialog', { name: '取消喜欢这首歌？', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '确认取消喜欢', exact: true }).click()
    await expect(player.getByRole('dialog', { name: '取消喜欢这首歌？', exact: true })).toBeHidden()
    await expect(player.getByRole('button', { name: '喜欢当前歌曲', exact: true })).toBeEnabled()
    calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.filter((call: any) => call.method === 'multiRedHeart')).toHaveLength(1)
    expect(calls.filter((call: any) => call.method === 'like').at(-1).args).toEqual({
      id: '444',
      value: false,
    })
    await test.step('the picker restores recent queries for the same account and reruns the selected query', async () => {
      await player.reload()
      page = await openTool(app, player, 'room')
      await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
      const query = picker.getByRole('button', { name: '换房新歌', exact: true })
      await expect(query).toBeVisible()
      const requestCount = () =>
        app.evaluate(
          () =>
            (globalThis as any).__roomSetup.calls.filter(
              (c: any) => c.method === 'search' && c.args.keywords === '换房新歌',
            ).length,
        )
      const beforeRepeat = await requestCount()
      await query.click()
      await expect(picker.getByRole('searchbox')).toHaveValue('换房新歌')
      await expect(picker.getByRole('button', { name: /歌曲444/ })).toBeVisible()
      expect(await requestCount()).toBe(beforeRepeat + 1)

      await app.evaluate(() => {
        const state = (globalThis as any).__roomSetup
        state.accountUid = 456
        state.active = false
      })
      await player.reload()
      page = await openTool(app, player, 'room')
      await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
      await expect(picker.getByRole('searchbox')).toBeVisible()
      await expect(query).toHaveCount(0)
    })
  } finally {
    await app.evaluate(() => (globalThis as any).__roomSetup?.pendingLike?.()).catch(() => {})
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

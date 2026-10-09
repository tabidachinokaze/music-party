import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('room creation, rematching, cancellation and notification ACK keep the selected matching song', async () => {
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
  const profile = await mkdtemp(join(tmpdir(), 'music-party-room-setup-'))
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
    // Isolate the renderer workflow; production service payload/permissions are unit-tested.
    await app.evaluate(({ ipcMain }, url) => {
      const state = {
        calls: [] as any[],
        active: false,
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
        multiRoomInfoDTO: { chatRoomId: '8877', roomBizType: state.roomBizType },
        multiLtRoomUserAgg: {
          onlineNums: 1,
          onlineUserInfos: [{ uid: 123, nickname: '测试用户' }],
        },
      })
      ipcMain.removeHandler('api')
      ipcMain.handle('api', async (_event, request) => {
        const { method, args = {} } = request
        state.calls.push(request)
        let body: any = { code: 200 }
        if (method === 'account')
          body = { data: { profile: { userId: 123, nickname: '测试用户' } } }
        if (method === 'playlists') body = { code: 200, playlist: [], more: false }
        if (method === 'albums') body = { code: 200, data: [], hasMore: false }
        if (method === 'likes') body = { code: 200, ids: [] }
        if (method === 'like' && args.value === true)
          return await new Promise((resolve) => {
            state.pendingLike = () => {
              state.pendingLike = null
              resolve({ ok: true, data: { code: 200 } })
            }
          })
        if (method === 'multiRedHeart') body = { code: 200, data: { failedCode: 0, result: true } }
        if (method === 'song') body = { code: 200, songs: String(args.ids).split(',').map(track) }
        if (method === 'search') body = { code: 200, result: { songs: [track(args.keywords)] } }
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
        if (method === 'multiHeartbeat')
          body = { code: 200, data: { heartBeatDuration: 30, roomPlaySongInfo: playback() } }
        if (method === 'multiSongInfo') body = { code: 200, data: { liked: false, songInfo: {} } }
        if (method === 'multiChatHistory')
          body = { code: 200, data: { records: [], page: { more: false } } }
        if (method === 'multiRematchLeave') {
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
    await page.reload()
    await page.locator('.sidebar').getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByLabel('搜索音乐库').fill('111')
    await page
      .locator('.music-header .header-search')
      .getByRole('button', { name: '搜索', exact: true })
      .click()
    await page.getByRole('button', { name: '播放 歌曲111' }).click()
    await expect(page.locator('.now-playing strong')).toHaveText('歌曲111')
    await page.getByRole('button', { name: '打开播放界面' }).click()
    await page.getByRole('button', { name: '一起听', exact: true }).click()
    await page.getByLabel('搜索匹配用歌曲').fill('222')
    await page
      .locator('.match-song-picker')
      .getByRole('button', { name: '搜索', exact: true })
      .click()
    await page.getByLabel('匹配歌曲搜索结果').getByRole('button').click()
    await expect(page.locator('.match-song-selected strong')).toHaveText('歌曲222')
    await page.getByRole('button', { name: '关闭一起听' }).click()
    await page.getByRole('button', { name: '搜索并选歌' }).click()
    await page.getByLabel('搜索音乐库').fill('333')
    await page
      .locator('.music-header .header-search')
      .getByRole('button', { name: '搜索', exact: true })
      .click()
    await page.getByRole('button', { name: '播放 歌曲333' }).click()
    await expect(page.locator('.now-playing strong')).toHaveText('歌曲333')
    await page.getByRole('button', { name: '打开播放界面' }).click()
    await page.getByRole('button', { name: '一起听', exact: true }).click()
    await expect(page.locator('.match-song-selected strong')).toHaveText('歌曲222')
    await page.getByLabel('允许陌生人匹配（公开好友房）').check()
    await page.getByRole('button', { name: '创建', exact: true }).click()
    await expect(page.getByRole('heading', { name: '1 人一起听' })).toBeVisible()
    const creation = await app.evaluate(() =>
      (globalThis as any).__roomSetup.calls.find((call: any) => call.method === 'multiCreate'),
    )
    expect(creation.args).toEqual({ songId: '222', allowStrangerMatch: true })
    await expect(page.locator('.room-identity')).toContainText('公开好友房')
    await page.getByRole('button', { name: '重新匹配', exact: true }).click()
    await page
      .getByRole('dialog', { name: '一起听' })
      .getByRole('button', { name: '重新匹配', exact: true })
      .click()
    await expect(page.getByRole('button', { name: '取消匹配', exact: true })).toBeVisible()
    let calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.find((call: any) => call.method === 'multiRematchLeave').args.roomId).toBe(
      'setup-room',
    )
    expect(calls.filter((call: any) => call.method === 'multiMatch').at(-1).args.songId).toBe('222')
    await page.getByRole('button', { name: '取消匹配', exact: true }).click()
    await expect(page.getByRole('button', { name: '取消匹配', exact: true })).toBeHidden()
    calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.filter((call: any) => call.method === 'multiMatchCancel')).toHaveLength(1)
    await page
      .getByRole('dialog', { name: '一起听' })
      .getByRole('button', { name: '匹配房间', exact: true })
      .click()
    await expect(page.locator('.match-progress')).toContainText('正在寻找房间')
    await app.evaluate(() => {
      const state = (globalThis as any).__roomSetup
      state.notices.push({
        timestamp: state.matchStarted + 1,
        notice: { kind: 'ready', roomId: 'matched-room' },
      })
    })
    await expect(page.getByRole('dialog', { name: '一起听' })).toBeHidden()
    await expect(page.locator('.room-identity')).toContainText('公开匹配房')
    calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.find((call: any) => call.method === 'multiJoin').args).toEqual({
      roomId: 'matched-room',
      inviterUid: '0',
    })
    expect(
      calls
        .filter((call: any) => call.method === 'multiMatch')
        .map((call: any) => call.args.songId),
    ).toEqual(['222', '222'])
    await expect(page.locator('.now-playing strong')).toHaveText('歌曲222')
    await page.getByRole('button', { name: '喜欢封面歌曲', exact: true }).click()
    await expect(page.getByRole('button', { name: '喜欢封面歌曲', exact: true })).toBeDisabled()
    calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.filter((call: any) => call.method === 'like')).toHaveLength(1)
    expect(calls.filter((call: any) => call.method === 'multiRedHeart')).toHaveLength(0)
    await app.evaluate(() => (globalThis as any).__roomSetup.pendingLike?.())
    await expect(page.getByRole('button', { name: '取消喜欢封面歌曲', exact: true })).toBeEnabled()
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
      id: '222',
      value: true,
    })
    expect(calls.find((call: any) => call.method === 'multiRedHeart').args).toEqual({
      roomId: 'matched-room',
      songId: '222',
      bizId: '900222',
    })
    await page.getByRole('button', { name: '取消喜欢封面歌曲', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '取消喜欢这首歌？' })).toBeVisible()
    await page.getByRole('button', { name: '确认取消喜欢', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '取消喜欢这首歌？' })).toBeHidden()
    await expect(page.getByRole('button', { name: '喜欢封面歌曲', exact: true })).toBeEnabled()
    calls = await app.evaluate(() => (globalThis as any).__roomSetup.calls)
    expect(calls.filter((call: any) => call.method === 'multiRedHeart')).toHaveLength(1)
    expect(calls.filter((call: any) => call.method === 'like').at(-1).args).toEqual({
      id: '222',
      value: false,
    })
  } finally {
    await app.evaluate(() => (globalThis as any).__roomSetup?.pendingLike?.()).catch(() => {})
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

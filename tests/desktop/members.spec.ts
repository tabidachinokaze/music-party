import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('members show complete recommendation counts, distinct played occurrences and own pending actions', async () => {
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
  const audioUrl = `http://127.0.0.1:${(server.address() as any).port}/audio.wav`,
    profile = await mkdtemp(join(tmpdir(), 'music-party-members-'))
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
    const page = await app.firstWindow(),
      errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ ipcMain }, url) => {
      const state = {
        calls: [] as any[],
        version: 1,
        failPlayed: false,
        pending: [
          { bizId: '102', uid: '9', songId: '111' },
          { bizId: '103', uid: '9', songId: '112' },
          { bizId: '104', uid: '123', songId: '113' },
          { bizId: '101', uid: '9', songId: '111' },
        ],
      }
      ;(globalThis as any).__memberTest = state
      const track = (id: string) => ({
        id,
        name: `歌曲${id}`,
        ar: [{ name: '测试歌手' }],
        al: { name: '测试专辑', picUrl: '' },
        dt: 30000,
      })
      const playback = () => ({
        playSong: { songId: '111', songBizId: '101', songRcmdUid: '9' },
        nextSongs: state.pending.map((entry) => ({
          songId: entry.songId,
          songBizId: entry.bizId,
          songRcmdUid: entry.uid,
        })),
        version: state.version,
        playedTime: 0,
        songDuration: 30000,
        playingSongZanCnt: 12,
      })
      const snapshot = () => ({
        roomId: 'members-room',
        roomPlaySongInfo: playback(),
        multiRoomInfoDTO: { chatRoomId: '8877', roomBizType: 2 },
        multiLtRoomUserAgg: {
          onlineNums: 3,
          onlineUserInfos: [
            { uid: 123, nickname: '测试用户' },
            { uid: 9, nickname: 'Alice' },
            { uid: 456, nickname: 'Bob' },
          ],
        },
      })
      const row = ({ bizId, uid, songId }: { bizId: string; uid: string; songId: string }) => ({
        rcmdUid: uid,
        nickname: uid === '9' ? 'Alice' : uid === '123' ? '测试用户' : 'Bob',
        songInfo: {
          bizId,
          resourceId: songId,
          title: `歌曲${songId}`,
          artistName: ['测试歌手'],
          zanCnt: 2,
          upCnt: 0,
        },
      })
      ipcMain.removeHandler('api')
      ipcMain.handle('api', async (_event, request) => {
        const { method, args = {} } = request
        state.calls.push(request)
        let body: any = { code: 200 }
        if (method === 'account')
          body = { data: { profile: { userId: 123, nickname: '测试用户' } } }
        if (method === 'playlists') body = { playlist: [], more: false }
        if (method === 'albums') body = { data: [], hasMore: false }
        if (method === 'likes') body = { ids: [] }
        if (method === 'song') body = { songs: String(args.ids).split(',').map(track) }
        if (method === 'stream') body = { data: [{ url }] }
        if (method === 'lyrics') body = { lrc: { lyric: '' } }
        if (method === 'privateConversations') body = { msgs: [], more: false }
        if (method === 'multiStatus') body = { data: { multiLtRoomSnapshot: snapshot() } }
        if (method === 'multiHeartbeat')
          body = { data: { heartBeatDuration: 30, roomPlaySongInfo: playback() } }
        if (method === 'multiSongInfo') body = { data: { liked: false, songInfo: {} } }
        if (method === 'multiChatHistory') body = { data: { records: [], page: { more: false } } }
        if (method === 'multiQueue')
          body = { data: { songLists: state.pending.map(row), page: { more: false } } }
        if (method === 'multiPlayed') {
          if (state.failPlayed) {
            state.failPlayed = false
            return { ok: false, error: '推荐记录暂时不可用' }
          }
          body = {
            data: {
              songLists: (args.cursor
                ? [
                    { bizId: '101', uid: '9', songId: '111' },
                    { bizId: '99', uid: '456', songId: '114' },
                  ]
                : [
                    { bizId: '101', uid: '9', songId: '111' },
                    { bizId: '100', uid: '9', songId: '111' },
                  ]
              ).map(row),
              page: { more: !args.cursor, cursor: args.cursor ? '' : 'older' },
            },
          }
        }
        if (method === 'multiRemove') {
          state.pending = state.pending.filter((entry) => entry.bizId !== args.bizId)
          state.version++
          body = { data: { failedCode: 0, result: true } }
        }
        return { ok: true, data: body }
      })
    }, audioUrl)
    await page.reload()
    await page.getByRole('button', { name: '一起听', exact: true }).click()
    await page
      .getByRole('dialog', { name: '一起听', exact: true })
      .getByRole('button', { name: '恢复当前房间', exact: true })
      .click()
    await expect(page.getByRole('heading', { name: '3 人一起听' })).toBeVisible()
    await page.getByRole('button', { name: '查看房间成员', exact: true }).click()
    const members = page.getByRole('dialog', { name: '房间成员', exact: true })
    await expect(
      members.getByRole('button', { name: '查看 Alice 的推荐', exact: true }),
    ).toContainText('推荐 4 首')
    await expect(
      members.getByRole('button', { name: '查看 Bob 的推荐', exact: true }),
    ).toContainText('推荐 1 首')
    await expect(
      members.getByRole('button', { name: '查看 测试用户 的推荐', exact: true }),
    ).toContainText('推荐 1 首')
    await members.getByRole('button', { name: '查看 Alice 的推荐', exact: true }).click()
    await expect(members.getByText('共推荐 4 首', { exact: true })).toBeVisible()
    const waiting = members.getByRole('region', { name: '待播歌曲', exact: true }),
      played = members.getByRole('region', { name: '已播歌曲', exact: true })
    await expect(waiting.locator('.member-recommendation-song')).toHaveCount(2)
    await expect(played.locator('.member-recommendation-song')).toHaveCount(2)
    await expect(played.locator('[data-biz-id="101"]')).toContainText('12 赞')
    await expect(played.locator('[data-biz-id="100"]')).toContainText('2 赞')
    await expect(waiting.getByRole('button', { name: /^删除推荐/ })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/music-party-member-recommendations.png' })
    await members.getByRole('button', { name: '返回成员列表', exact: true }).click()
    await members.getByRole('button', { name: '查看 测试用户 的推荐', exact: true }).click()
    await members.getByRole('button', { name: '删除推荐 歌曲113', exact: true }).click()
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).__memberTest.calls.filter(
            (request: any) => request.method === 'multiRemove',
          ).length,
      ),
    ).toBe(0)
    await page.getByRole('button', { name: '确认删除推荐', exact: true }).click()
    await expect(members.getByText('共推荐 0 首', { exact: true })).toBeVisible()
    await app.evaluate(() => {
      ;(globalThis as any).__memberTest.failPlayed = true
    })
    await members.getByRole('button', { name: '刷新成员', exact: true }).click()
    await expect(members.getByRole('alert')).toContainText('推荐记录暂时不可用')
    await expect(members.getByText('共推荐 0 首', { exact: true })).toBeVisible()
    await members.getByRole('button', { name: '重试加载', exact: true }).click()
    await expect(members.getByRole('alert')).toHaveCount(0)
    await expect(members.getByText('共推荐 0 首', { exact: true })).toBeVisible()
    const cursors = await app.evaluate(() =>
      (globalThis as any).__memberTest.calls
        .filter((request: any) => request.method === 'multiPlayed')
        .map((request: any) => request.args.cursor || ''),
    )
    expect(cursors).toContain('older')
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})

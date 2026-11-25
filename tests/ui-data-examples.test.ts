import { expect, test } from 'vitest'
import examples from '../docs/ui-data/examples.json'
import { validate } from '../src/main/service'
import { parseLyrics } from '../src/renderer/src/music-data'
import { buildRoomQueueHandoff } from '../src/renderer/src/room-queue-handoff'
import { DEFAULT_PREFERENCES, validatePreferences, type DesktopInfo } from '../src/shared/desktop'
import { parseSnapshot } from '../src/shared/multiplayer'
import { parseRoomQueue } from '../src/shared/playback-queue'
import type { Method } from '../src/shared/types'

function response(method: Method) {
  const example = examples.calls.find(({ request }) => request.method === method)
  if (!example) throw new Error(`Missing example for ${method}`)
  return example.reply.data
}

test('documented IPC requests pass the same argument checks as the desktop bridge', () => {
  for (const { request } of [...examples.calls, ...examples.failures]) {
    // JSON widens method names to string. validate checks the name against the live allowlist.
    expect(
      () => validate({ ...request, method: request.method as Method }),
      request.method,
    ).not.toThrow()
  }
})

test('the room examples reconstruct the personal queue with the correct current occurrence', () => {
  const room = parseSnapshot(response('multiStatus').data?.multiLtRoomSnapshot, 0)
  const { entries: waiting } = parseRoomQueue(response('multiQueue'))
  const { entries: played } = parseRoomQueue(response('multiPlayed'))
  const handoff = buildRoomQueueHandoff({ waiting, played }, room.playback)
  expect(handoff).toEqual({ ids: ['4102', '4101', '4101', '4102'], index: 1 })
})

test('the translated lyric example follows the original timeline', () => {
  const lyrics = response('lyrics')
  const original = parseLyrics(lyrics.lrc?.lyric ?? '')
  const translated = parseLyrics(lyrics.tlyric?.lyric ?? '')
  expect(original.length).toBeGreaterThan(0)
  expect(translated.map((line) => line.time)).toEqual(original.map((line) => line.time))
})

test('the desktopInfo example is complete and its settings pass desktop validation', () => {
  const info = examples.desktop.find((example) => example.member === 'desktopInfo')?.result
  expect(info).toStrictEqual({
    maximized: expect.any(Boolean),
    preferences: { ...DEFAULT_PREFERENCES, ...validatePreferences(info?.preferences) },
    trayAvailable: expect.any(Boolean),
    fullScreen: expect.any(Boolean),
    fullScreenRevision: expect.any(Number),
    resolvedTheme: expect.stringMatching(/^(dark|light)$/),
    platform: expect.any(String),
    persistenceError: expect.any(String),
  } satisfies DesktopInfo)
})

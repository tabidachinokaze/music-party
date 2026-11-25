import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  readPersonalQueue,
  rememberRoom,
  rememberedRoom,
  savePersonalQueue,
} from '../src/renderer/src/playback-session'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})
afterEach(() => vi.unstubAllGlobals())

it('restores a duplicate by position beyond the first page, retaining its music links', () => {
  const song = {
    id: '11',
    name: 'A',
    artist: 'Artist',
    artists: [{ id: '3', name: 'Artist' }],
    album: 'Album',
    albumId: '5',
    cover: '',
    duration: 1000,
  }
  const ids = ['11', ...Array<string>(100).fill('22'), '11']
  const queue = { ids, index: 101, song }
  savePersonalQueue('1', queue)
  expect(readPersonalQueue('1')).toEqual(queue)
  expect(readPersonalQueue('2').ids).toEqual([])
  savePersonalQueue('2', { ids: ['22'], index: 0, song: null })
  savePersonalQueue('1', { ids: [], index: -1, song: null })
  expect(readPersonalQueue('1')).toEqual({ ids: [], index: -1, song: null })
  expect(readPersonalQueue('2').ids).toEqual(['22'])
})

it('recovers independently from missing song metadata or an unusable queue', () => {
  localStorage.setItem(
    'music-party:queue:1',
    JSON.stringify({ ids: ['1'], index: 0, song: { id: '2' } }),
  )
  expect(readPersonalQueue('1')).toEqual({ ids: ['1'], index: 0, song: null })
  for (const data of ['{', '{"ids":["2"],"index":7}', '{"ids":[null],"index":0}']) {
    localStorage.setItem('music-party:queue:1', data)
    expect(readPersonalQueue('1').ids).toEqual([])
  }
})

it('clears only the account whose room ended', () => {
  rememberRoom('1', 'first-room')
  rememberRoom('2', 'other-room')
  rememberRoom('1', null)
  expect(rememberedRoom('1')).toBeNull()
  expect(rememberedRoom('2')).toBe('other-room')
})

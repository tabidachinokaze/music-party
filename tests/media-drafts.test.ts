import { expect, it, vi } from 'vitest'
import { MediaDraftStore, type MediaDraftEntry } from '../src/renderer/src/media-drafts'
import type { MediaTarget } from '../src/shared/media'

const alice: MediaTarget = { kind: 'private', uid: '456' }
const bob: MediaTarget = { kind: 'private', uid: '789' }
const entry = (id: string, target: MediaTarget, size = 4): MediaDraftEntry => ({
  id,
  target,
  label: id,
  file: { name: `${id}.png`, kind: 'image', mime: 'image/png', data: new Uint8Array(size) },
  error: '',
  uncertain: false,
  requestId: '',
  progress: null,
})

it('retains distinct target drafts in runtime memory and clears every draft on account change', () => {
  const store = new MediaDraftStore()
  store.activateAccount('123')
  const first = entry('alice', alice)
  store.remember('123', first)
  store.remember('123', entry('bob', bob))
  expect(store.get('123', alice)).toBe(first)
  expect(store.get('123', bob)?.id).toBe('bob')
  expect(store.get('other', alice)).toBeNull()
  store.activateAccount(null)
  store.activateAccount('123')
  expect(store.get('123', alice)).toBeNull()
  expect(store.get('123', bob)).toBeNull()
  expect(store.remember('other', first)).toBe(false)
})

it('bounds target count and total file bytes, including video covers', () => {
  const store = new MediaDraftStore(2, 10)
  store.activateAccount('123')
  store.remember('123', entry('alice', alice))
  store.remember('123', entry('bob', bob))
  store.remember('123', entry('room', { kind: 'room', roomId: 'room' }))
  expect(store.get('123', alice)).toBeNull()
  const video = entry('video', alice, 7)
  video.file.cover = new Uint8Array(3)
  expect(store.remember('123', video)).toBe(true)
  expect(store.get('123', bob)).toBeNull()
  expect(store.get('123', { kind: 'room', roomId: 'room' })).toBeNull()
  expect(store.get('123', alice)).toBe(video)
  expect(store.remember('123', entry('oversized', bob, 11))).toBe(false)
})

it('shares one pending send per target and preserves unknown delivery across remounts', () => {
  const store = new MediaDraftStore()
  store.activateAccount('123')
  store.remember('123', entry('alice', alice))
  expect(store.begin('123', alice, 'alice', 'request-1')).toBe(true)
  expect(store.begin('123', alice, 'alice', 'request-2')).toBe(false)
  expect(store.remove('123', alice, 'alice')).toBe(false)
  expect(
    store.update('123', alice, 'alice', { uncertain: true, error: '等待结果' }, 'request-1'),
  ).toBe(true)
  expect(store.get('123', alice)?.uncertain).toBe(true)
  expect(store.get('123', alice)?.requestId).toBe('request-1')
  store.update(
    '123',
    alice,
    'alice',
    { requestId: '', uncertain: true, error: '结果未知' },
    'request-1',
  )
  expect(store.get('123', alice)?.uncertain).toBe(true)
  expect(store.get('123', alice)?.error).toBe('结果未知')
})

it('never applies an obsolete send result to a replacement draft or another account', () => {
  const store = new MediaDraftStore()
  store.activateAccount('123')
  store.remember('123', entry('first', alice))
  store.begin('123', alice, 'first', 'request-1')
  expect(store.remember('123', entry('replacement', alice))).toBe(false)
  store.update('123', alice, 'first', { requestId: '', uncertain: true }, 'request-1')
  expect(store.remember('123', entry('replacement', alice))).toBe(true)
  expect(store.remove('123', alice, 'first', 'request-1')).toBe(false)
  expect(store.update('123', alice, 'first', { uncertain: true }, 'request-1')).toBe(false)
  expect(store.get('123', alice)?.id).toBe('replacement')
  store.activateAccount('999')
  store.remember('999', entry('other-account', alice))
  expect(store.remove('123', alice, 'replacement')).toBe(false)
  expect(store.get('999', alice)?.id).toBe('other-account')
})

it('does not evict in-flight uploads to admit another draft', () => {
  const store = new MediaDraftStore(1, 8)
  store.activateAccount('123')
  store.remember('123', entry('alice', alice))
  store.begin('123', alice, 'alice', 'request-1')
  expect(store.remember('123', entry('bob', bob))).toBe(false)
  expect(store.get('123', alice)?.requestId).toBe('request-1')
  expect(store.get('123', bob)).toBeNull()
})

it('notifies mounted composers and releases subscriptions on unmount', () => {
  const store = new MediaDraftStore()
  const listener = vi.fn()
  const unsubscribe = store.subscribe(listener)
  store.activateAccount('123')
  store.remember('123', entry('alice', alice))
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
  store.remove('123', alice, 'alice')
  expect(listener).toHaveBeenCalledTimes(2)
})

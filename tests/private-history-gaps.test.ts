import { expect, it } from 'vitest'
import { PrivateHistoryGaps } from '../src/shared/private-history-gaps'
import type { PrivateMessage, PrivatePage } from '../src/shared/types'

const message = (time: number) => ({ time }) as PrivateMessage
const page = (before: number | null, more = true): PrivatePage => ({ messages: [], before, more })
it('ignores optimistic or failed sends when locating the confirmed history boundary', () => {
  const gaps = new PrivateHistoryGaps()
  gaps.observe([message(100), { ...message(1000), delivery: 'failed' }], page(300))
  expect(gaps.next()).toBe(300)
  gaps.accept(300, page(90))
  expect(gaps.next()).toBeNull()
})

it('remembers missing messages between a cached history and the newest server page', () => {
  const gaps = new PrivateHistoryGaps()
  gaps.observe([message(100)], page(300))
  expect(gaps.next()).toBe(300)
  expect(() => gaps.accept(300, page(null))).toThrow('缺少下一页游标')
  gaps.accept(300, page(200))
  expect(gaps.next()).toBe(200)
  gaps.accept(200, page(90))
  expect(gaps.next()).toBeNull()
})
it('merges overlapping gaps and retains unfilled ranges for a later refresh', () => {
  const gaps = new PrivateHistoryGaps()
  gaps.observe([message(100)], page(300))
  gaps.observe([message(250)], page(500))
  expect(gaps.next()).toBe(500)
  gaps.accept(500, page(350))
  expect(gaps.next()).toBe(350)
  gaps.accept(350, page(50, false))
  expect(gaps.next()).toBeNull()
})
it('rejects a repeated cursor and clears missing ranges when changing conversations', () => {
  const gaps = new PrivateHistoryGaps()
  gaps.observe([message(100)], page(300))
  expect(() => gaps.accept(300, page(300))).toThrow('未向前推进')
  expect(gaps.next()).toBe(300)
  gaps.clear()
  expect(gaps.next()).toBeNull()
})
it('does not fetch gaps for initial, overlapping or fully loaded history', () => {
  const gaps = new PrivateHistoryGaps()
  gaps.observe([], page(300))
  gaps.observe([message(400)], page(300))
  gaps.observe([message(100)], page(300, false))
  expect(gaps.next()).toBeNull()
})
it('keeps independent missing ranges when switching between conversations', () => {
  const gaps = new PrivateHistoryGaps()
  gaps.observe([message(100)], page(300))
  const saved = gaps.snapshot()
  gaps.clear()
  gaps.restore(saved)
  gaps.accept(300, page(200))
  expect(saved).toEqual([{ after: 100, before: 300 }])
  expect(gaps.next()).toBe(200)
})

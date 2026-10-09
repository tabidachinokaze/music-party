import { expect, it } from 'vitest'
import { privateBubbleTop } from '../src/renderer/src/private-bubble-layout'

it('keeps notifications below right-side header controls and ignores left-side controls', () => {
  expect(
    privateBubbleTop(1200, 800, [
      { left: 1000, right: 1180, top: 20, bottom: 68 },
      { left: 20, right: 300, top: 20, bottom: 250 },
    ]),
  ).toBe(80)
})
it('preserves viewport margins when no header is shown and when the window is short', () => {
  expect(privateBubbleTop(1200, 800, [])).toBe(20)
  expect(privateBubbleTop(320, 120, [{ left: 10, right: 300, top: 0, bottom: 70 }])).toBe(20)
})
it('ignores lower controls and waits until multiple overlapping top controls are all clear', () => {
  expect(
    privateBubbleTop(1200, 800, [
      { left: 1000, right: 1180, top: 20, bottom: 68 },
      { left: 1050, right: 1180, top: 80, bottom: 120 },
      { left: 900, right: 1180, top: 600, bottom: 700 },
    ]),
  ).toBe(132)
})

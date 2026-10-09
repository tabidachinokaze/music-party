import { expect, it } from 'vitest'
import { volumeAfterWheel } from '../src/renderer/src/volume-wheel'

it('turns a wheel event into five percentage points without floating point drift', () => {
  expect(volumeAfterWheel(0.6, -100)).toBe(0.65)
  expect(volumeAfterWheel(0.65, 100)).toBe(0.6)
  expect(volumeAfterWheel(0.23, -1)).toBe(0.28)
  expect(volumeAfterWheel(0.23, 1)).toBe(0.18)
})

it('clamps volume at mute and full volume, including overshooting from near the boundary', () => {
  expect(volumeAfterWheel(0.98, -120)).toBe(1)
  expect(volumeAfterWheel(1, -120)).toBe(1)
  expect(volumeAfterWheel(0.02, 120)).toBe(0)
  expect(volumeAfterWheel(0, 120)).toBe(0)
})

it('ignores horizontal-only events and invalid wheel data', () => {
  expect(volumeAfterWheel(0.6, 0)).toBeNull()
  expect(volumeAfterWheel(0.6, NaN)).toBeNull()
  expect(volumeAfterWheel(0.6, Infinity)).toBeNull()
  expect(volumeAfterWheel(NaN, 100)).toBeNull()
})

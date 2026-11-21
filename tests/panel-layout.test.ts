import { expect, it } from 'vitest'
import {
  dockAt,
  dockBounds,
  edgeDistance,
  placePanel,
  readablePlacement,
  snapDock,
  isPanelId,
} from '../src/shared/panels'

const main = { x: 600, y: 140, width: 360, height: 640 },
  area = { x: 0, y: 0, width: 1920, height: 1080 },
  size = { width: 380, height: 520 }
it('starts lyrics on the left, private on the right, and avoids an occupied slot', () => {
  const left = placePanel('lyrics', main, size, [area], [])
  const right = placePanel('private', main, size, [area], [left.bounds])
  expect(left).toEqual({ bounds: { x: 212, y: 140, ...size }, dock: { side: 'left', offset: 0 } })
  expect(right.bounds.x).toBe(968)
  expect(placePanel('search', main, size, [area], [left.bounds, right.bounds]).bounds).not.toEqual(
    left.bounds,
  )
})
it('retains offsets along each edge and detects deliberate near-edge drops', () => {
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const dock = { side, offset: 42 },
      box = dockBounds(main, size, dock)
    expect(edgeDistance(main, box, side)).toBe(8)
    expect(dockAt(main, box, side)).toEqual(dock)
    expect(snapDock(main, box, [])).toEqual(dock)
    expect(snapDock(main, box, [box])).toBeNull()
  }
  expect(snapDock(main, { x: 100, y: 40, ...size }, [])).toBeNull()
})
it('uses available space on another monitor and validates persisted positions', () => {
  const second = { x: -1024, y: 0, width: 1024, height: 768 }
  const small = { x: 0, y: 0, width: 360, height: 640 }
  const free = placePanel('private', small, size, [small, second], [])
  expect(free.bounds.x).toBeLessThan(0)
  expect(readablePlacement(free)).toBe(true)
  expect(readablePlacement({ bounds: { ...size, x: Infinity, y: 0 }, dock: null })).toBe(false)
  expect(isPanelId('detail-album-123')).toBe(true)
  expect(isPanelId('outside')).toBe(false)
})

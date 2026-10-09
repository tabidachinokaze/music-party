/** A wheel notch adjusts the local volume by five percentage points. */
export function volumeAfterWheel(volume: number, deltaY: number): number | null {
  if (!Number.isFinite(volume) || !Number.isFinite(deltaY) || deltaY === 0) return null
  return Math.max(0, Math.min(1, Math.round((volume - Math.sign(deltaY) * 0.05) * 100) / 100))
}

export type RepeatMode = 'order' | 'loop' | 'single'
export function nextQueueIndex(
  length: number,
  current: number,
  direction: -1 | 1,
  mode: RepeatMode,
  automatic = false,
): number | null {
  if (!length || current < 0) return null
  if (automatic && mode === 'single') return current
  const next = current + direction
  if (next >= 0 && next < length) return next
  return mode === 'loop' ? (next + length) % length : null
}

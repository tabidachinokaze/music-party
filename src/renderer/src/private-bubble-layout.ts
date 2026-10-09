type Rect = { left: number; right: number; top: number; bottom: number }

/** Keep the inbox below visible controls sharing its right-hand viewport column. */
export function privateBubbleTop(
  width: number,
  height: number,
  controls: readonly Rect[],
  bubbleWidth = 320,
  margin = 20,
) {
  const left = Math.max(margin, width - margin - bubbleWidth)
  let top = margin
  for (const rect of controls) {
    if (rect.right > left && rect.left < width - margin && rect.bottom > 0 && rect.top < height / 2)
      top = Math.max(top, rect.bottom + 12)
  }
  return Math.min(top, Math.max(margin, height - margin - 80))
}

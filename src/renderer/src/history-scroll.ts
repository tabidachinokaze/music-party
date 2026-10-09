export interface HistoryAnchor {
  messages: { id: string; offset: number }[]
  top: number
  height: number
}

/** Retain the visible message when pages are prepended or fill a middle gap. */
export function captureHistoryAnchor(box: HTMLElement): HistoryAnchor {
  const bounds = box.getBoundingClientRect()
  const messages: HistoryAnchor['messages'] = []
  for (const node of box.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const rect = node.getBoundingClientRect()
    if (rect.bottom <= bounds.top) continue
    if (rect.top >= bounds.bottom || messages.length === 3) break
    messages.push({ id: node.dataset.messageId!, offset: rect.top - bounds.top })
  }
  return { messages, top: box.scrollTop, height: box.scrollHeight }
}

export function restoreHistoryAnchor(box: HTMLElement, anchor: HistoryAnchor) {
  const bounds = box.getBoundingClientRect()
  for (const saved of anchor.messages) {
    const node = box.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(saved.id)}"]`)
    if (!node) continue
    box.scrollTop += node.getBoundingClientRect().top - bounds.top - saved.offset
    return
  }
  box.scrollTop = anchor.top + box.scrollHeight - anchor.height
}

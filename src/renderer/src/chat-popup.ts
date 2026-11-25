export function followChatAnchor(
  popup: HTMLElement,
  trigger: HTMLElement,
  preferredWidth: number,
  preferredHeight = Infinity,
) {
  const panel = trigger.closest<HTMLElement>('.player-modal, .private-thread, .shell-surface')
  const footer = document.querySelector<HTMLElement>('.adaptive-player-bar')
  const margin = 10,
    gap = 8
  function clearPosition() {
    for (const property of ['width', 'max-height', 'left', 'top', 'bottom'])
      popup.style.removeProperty(property)
  }
  function place() {
    if (!trigger.getClientRects().length) return
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight
    const footerTop = footer?.getClientRects().length
      ? footer.getBoundingClientRect().top
      : viewportHeight
    if (window.matchMedia('(max-width: 519px)').matches) {
      popup.style.left = '0px'
      popup.style.width = viewportWidth + 'px'
      popup.style.top = 'auto'
      popup.style.bottom = Math.max(0, viewportHeight - footerTop) + 'px'
      popup.style.maxHeight = Math.max(0, Math.min(footerTop - margin, preferredHeight)) + 'px'
      return
    }
    popup.style.removeProperty('bottom')
    const anchor = trigger.getBoundingClientRect()
    const bounds = panel?.getBoundingClientRect() ?? anchor
    const leftSpace = bounds.left - gap - margin
    const rightSpace = viewportWidth - margin - bounds.right - gap
    const sideSpace = Math.max(leftSpace, rightSpace)
    const alongside = sideSpace >= Math.min(244, preferredWidth)
    const width = Math.min(preferredWidth, alongside ? sideSpace : viewportWidth - 2 * margin)
    const left = alongside
      ? leftSpace >= rightSpace
        ? bounds.left - gap - width
        : bounds.right + gap
      : Math.max(margin, Math.min(bounds.right - width, viewportWidth - margin - width))
    let topLimit = margin
    let bottomLimit = Math.min(viewportHeight, footerTop) - margin
    if (alongside) {
      topLimit = Math.min(Math.max(margin, bounds.top), bottomLimit - 120)
    } else if (anchor.top - gap - topLimit >= 120) {
      bottomLimit = anchor.top - gap
    } else if (bottomLimit - anchor.bottom - gap >= 120) {
      topLimit = anchor.bottom + gap
    }
    popup.style.width = width + 'px'
    popup.style.maxHeight = Math.min(preferredHeight, bottomLimit - topLimit) + 'px'
    popup.style.left = left + 'px'
    popup.style.top =
      Math.max(topLimit, Math.min(anchor.bottom, bottomLimit) - popup.offsetHeight) + 'px'
  }
  const observer = new ResizeObserver(place)
  observer.observe(popup)
  if (panel) observer.observe(panel)
  if (footer) observer.observe(footer)
  document.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  place()
  return () => {
    observer.disconnect()
    clearPosition()
    document.removeEventListener('scroll', place, true)
    window.removeEventListener('resize', place)
  }
}

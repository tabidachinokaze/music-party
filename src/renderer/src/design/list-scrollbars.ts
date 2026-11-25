import { OverlayScrollbars } from 'overlayscrollbars'

// Use the platform scrollbar normally. Windows' “Always show scrollbars”,
// macOS and some Linux desktop preferences can switch it to a classic gutter.
export function watchListScrollbars() {
  const probe = document.createElement('div')
  probe.className = 'scrollbar-probe'
  probe.setAttribute('aria-hidden', 'true')
  document.body.append(probe)

  let stopClassic: (() => void) | undefined
  const update = () => {
    if (probe.clientWidth < probe.offsetWidth) {
      stopClassic ??= watchClassicViewports()
    } else {
      stopClassic?.()
      stopClassic = undefined
    }
  }
  const observer = new ResizeObserver(update)
  observer.observe(probe)
  update()
  return () => {
    observer.disconnect()
    stopClassic?.()
    probe.remove()
  }
}

function watchClassicViewports() {
  document.body.classList.add('classic-list-scrollbars')
  const selector = '[data-list-viewport]'
  const viewports = new Map<HTMLElement, OverlayScrollbars | undefined>()
  const refresh = (viewport: HTMLElement) => {
    if (!viewports.has(viewport)) return
    const instance = viewports.get(viewport)
    // Some panels become their own scroll viewport only in compact layouts.
    const scrollable = ['auto', 'scroll'].includes(getComputedStyle(viewport).overflowY)
    if (scrollable && !instance) {
      // Installation reattaches children. Preserve nested lists' restored position.
      const scrolled = [...viewport.querySelectorAll<HTMLElement>(selector)]
        .filter((child) => child.scrollTop || child.scrollLeft)
        .map((child) => ({ child, top: child.scrollTop, left: child.scrollLeft }))
      viewports.set(
        viewport,
        OverlayScrollbars(
          { target: viewport, elements: { viewport } },
          { scrollbars: { theme: 'mp-list-scrollbar', autoHide: 'never', clickScroll: 'instant' } },
        ),
      )
      for (const { child, top, left } of scrolled)
        child.scrollTo({ top, left, behavior: 'instant' })
    } else if (!scrollable && instance) {
      instance.destroy()
      viewports.set(viewport, undefined)
    }
  }
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) refresh(entry.target as HTMLElement)
  })
  const register = (viewport: HTMLElement) => {
    if (viewports.has(viewport)) return
    viewports.set(viewport, undefined)
    resize.observe(viewport)
    refresh(viewport)
  }
  const observeSubtree = (root: Element) => {
    if (root instanceof HTMLElement && root.matches(selector)) register(root)
    root.querySelectorAll<HTMLElement>(selector).forEach(register)
  }
  const mutations = new MutationObserver((records) => {
    for (const [viewport, instance] of viewports) {
      if (!viewport.isConnected) {
        resize.unobserve(viewport)
        instance?.destroy()
        viewports.delete(viewport)
      }
    }
    for (const { addedNodes } of records) {
      for (const node of addedNodes)
        if (node instanceof HTMLElement && node.isConnected) observeSubtree(node)
    }
  })
  observeSubtree(document.body)
  mutations.observe(document.body, { childList: true, subtree: true })
  return () => {
    mutations.disconnect()
    resize.disconnect()
    for (const instance of viewports.values()) instance?.destroy()
    document.body.classList.remove('classic-list-scrollbars')
  }
}

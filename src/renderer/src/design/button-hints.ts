/** Use Chromium's native tooltip for mouse users, including on disabled buttons. */
export function watchButtonHints() {
  let hovered: HTMLElement | null = null
  let generated: string | null = null
  const observer = new MutationObserver((changes) => {
    // An explicit title supplied by the component takes over immediately.
    if (changes.some((change) => change.target === hovered && change.attributeName === 'title')) {
      generated = null
    }
    update()
  })

  function update() {
    if (!hovered || (hovered.hasAttribute('title') && generated === null)) return
    const hint = (hovered.getAttribute('aria-label') || hovered.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (hint === generated) return
    if (hint) hovered.title = hint
    else hovered.removeAttribute('title')
    generated = hint || null
    observer.takeRecords() // Ignore our own title attribute change.
  }

  function track(button: HTMLElement | null) {
    if (button === hovered) return
    const titleChanged = observer
      .takeRecords()
      .some((change) => change.target === hovered && change.attributeName === 'title')
    observer.disconnect()
    if (!titleChanged && generated !== null && hovered?.title === generated) {
      hovered.removeAttribute('title')
    }
    hovered = button
    generated = null
    if (!hovered) return
    update()
    observer.observe(hovered, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title'],
    })
  }

  function buttonAt(target: EventTarget | null) {
    return target instanceof Element ? target.closest<HTMLElement>('button, [role="button"]') : null
  }
  const enter = (event: PointerEvent) => track(buttonAt(event.target))
  const leave = (event: PointerEvent) => track(buttonAt(event.relatedTarget))
  const reset = () => track(null)
  document.addEventListener('pointerover', enter, true)
  document.addEventListener('pointerout', leave, true)
  window.addEventListener('blur', reset)
  return () => {
    reset()
    document.removeEventListener('pointerover', enter, true)
    document.removeEventListener('pointerout', leave, true)
    window.removeEventListener('blur', reset)
  }
}

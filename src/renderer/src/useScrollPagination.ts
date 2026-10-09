import { useCallback, useEffect, useRef, useState } from 'react'

type Options = {
  enabled?: boolean
  loading: boolean
  hasMore: boolean
  blocked?: boolean
  scope: string
  contentKey?: string | number
  direction?: 'top' | 'bottom'
  autoFill?: boolean
  threshold?: number
  onLoad(): void | Promise<unknown>
}

function scrollParent(node: HTMLElement) {
  let parent = node.parentElement
  while (parent) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
    parent = parent.parentElement
  }
  return null
}

/** Load adjacent pages at the visible edge, with one request per list scope. */
export function useScrollPagination(options: Options) {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)
  const latest = useRef(options)
  latest.current = options
  const pending = useRef<{ scope: string; token: object } | null>(null)
  const sentinelRef = useCallback((node: HTMLDivElement | null) => setSentinel(node), [])
  const {
    scope,
    loading,
    hasMore,
    blocked,
    enabled = true,
    direction = 'bottom',
    autoFill = true,
    threshold = 80,
    contentKey,
  } = options

  useEffect(() => {
    if (!sentinel || !enabled || !hasMore || blocked) return
    const root = scrollParent(sentinel)
    if (!root) return
    let disposed = false
    let frame = 0
    let previousTop = root.scrollTop
    function atEdge() {
      if (!sentinel?.getClientRects().length || !root?.getClientRects().length) return false
      const edge = sentinel.getBoundingClientRect()
      const bounds = root.getBoundingClientRect()
      return edge.top <= bounds.bottom + threshold && edge.bottom >= bounds.top - threshold
    }
    function attempt(userScroll = false) {
      const current = latest.current
      if (
        disposed ||
        current.scope !== scope ||
        current.enabled === false ||
        current.loading ||
        !current.hasMore ||
        current.blocked ||
        pending.current?.scope === scope ||
        (!autoFill && !userScroll) ||
        !atEdge()
      )
        return
      const token = {}
      const before = current.contentKey
      pending.current = { scope, token }
      Promise.resolve()
        .then(() => {
          if (!disposed && latest.current.scope === scope) return current.onLoad()
        })
        .catch(() => {
          // The list owns its error state and explicit retry action.
        })
        .finally(() => {
          if (pending.current?.token === token) pending.current = null
          // A successful short page may still leave space for another page.
          if (!disposed && latest.current.contentKey !== before) schedule()
        })
    }
    function schedule() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => attempt())
    }
    function scroll() {
      const top = root!.scrollTop
      const towardEdge = direction === 'top' ? top < previousTop : top > previousTop
      previousTop = top
      attempt(towardEdge)
    }
    function wheel(event: WheelEvent) {
      if (direction === 'top' ? event.deltaY < 0 : event.deltaY > 0) attempt(true)
    }
    function key(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,[contenteditable="true"]')
      )
        return
      const keys =
        direction === 'top' ? ['ArrowUp', 'PageUp', 'Home'] : ['ArrowDown', 'PageDown', 'End']
      if (keys.includes(event.key)) attempt(true)
    }
    root.addEventListener('scroll', scroll, { passive: true })
    root.addEventListener('wheel', wheel, { passive: true })
    root.addEventListener('keydown', key)
    const observer = new IntersectionObserver(() => attempt(), {
      root,
      rootMargin: `${threshold}px 0px`,
    })
    observer.observe(sentinel)
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    schedule()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      resize.disconnect()
      root.removeEventListener('scroll', scroll)
      root.removeEventListener('wheel', wheel)
      root.removeEventListener('keydown', key)
    }
  }, [
    sentinel,
    enabled,
    hasMore,
    blocked,
    loading,
    scope,
    contentKey,
    direction,
    autoFill,
    threshold,
  ])

  return sentinelRef
}

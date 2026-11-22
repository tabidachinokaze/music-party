import { useLayoutEffect, useState } from 'react'
import type { PanelId, PanelStatus } from '../../../shared/panels'

const medium = window.matchMedia('(min-width: 560px)')
const wide = window.matchMedia('(min-width: 960px)')
function subscribe(callback: () => void) {
  medium.addEventListener('change', callback)
  wide.addEventListener('change', callback)
  return () => {
    medium.removeEventListener('change', callback)
    wide.removeEventListener('change', callback)
  }
}
const measure = () => (wide.matches ? 'wide' : medium.matches ? 'medium' : 'compact') as Layout
export type Layout = 'compact' | 'medium' | 'wide'
const isDialog = (id: PanelId) => ['windows', 'controls', 'login', 'add', 'confirm'].includes(id)
export const isDrawer = (id: PanelId) =>
  ['queue', 'room', 'match', 'members', 'chat', 'private'].includes(id)
const isPage = (id: PanelId) => !isDrawer(id) && !isDialog(id) && id !== 'lyrics'
const roots: PanelId[] = ['library', 'liked', 'albums', 'created', 'recent', 'search', 'settings']
const initial: PanelId[] = ['library']
function push(path: PanelId[], id: PanelId) {
  const previous = path.indexOf(id)
  return previous < 0 ? [...path, id] : path.slice(0, previous + 1)
}

export function useAdaptiveNavigation() {
  const [layout, setLayout] = useState(measure)
  const [path, setPath] = useState(initial)
  const [visited, setVisited] = useState(initial)
  const [dialogs, setDialogs] = useState<PanelId[]>([])
  const [touched, setTouched] = useState(false)
  const [compactContent, setCompactContent] = useState(false)
  useLayoutEffect(() => {
    function resize() {
      const next = measure()
      if (next === layout) return
      // Measure before the old panel is hidden so an open editor keeps its draft.
      const editing =
        !!document.querySelector('.modal-backdrop, :popover-open') ||
        !!document.activeElement?.matches('textarea,input:not([type=range]),[contenteditable=true]')
      setCompactContent(next === 'compact' && editing)
      setLayout(next)
    }
    const unsubscribe = subscribe(resize)
    resize()
    return unsubscribe
  }, [layout])
  const current = !touched && layout === 'medium' ? 'queue' : path.at(-1)!
  const browse = [...path].reverse().find(isPage) ?? 'library'
  const base = [...path].reverse().find((id) => !isDrawer(id))
  const now = layout === 'wide' && base === 'lyrics'
  const drawer = layout === 'wide' && isDrawer(current) ? current : null
  const pane =
    layout === 'wide'
      ? now
        ? 'lyrics'
        : browse
      : layout === 'medium' || compactContent
        ? current
        : null
  const dialog = dialogs.at(-1)
  const active = dialog || drawer || pane
  const entries = [...new Set([...visited, ...path, ...dialogs, ...(pane ? [pane] : [])])]
  const statuses: Partial<Record<PanelId, PanelStatus>> = Object.fromEntries(
    entries.map((id) => [id, { visible: active === id }]),
  )
  function show(id: PanelId) {
    if (isDialog(id)) {
      setDialogs((old) => push(old, id))
      return
    }
    setDialogs([])
    setTouched(true)
    setCompactContent(layout === 'compact')
    if (roots.includes(id)) setVisited((old) => (old.includes(id) ? old : [...old, id]))
    setPath((old) => {
      if (roots.includes(id)) return id === 'library' ? initial : ['library', id]
      const origin =
        !touched && layout === 'medium' && id !== 'queue' ? [...old, 'queue' as const] : old
      return push(origin, id)
    })
  }
  function hide(id: PanelId) {
    if (isDialog(id)) {
      setDialogs((old) => old.filter((item) => item !== id))
      return
    }
    setPath((old) =>
      old.includes(id) && id !== 'library' ? old.filter((item) => item !== id) : old,
    )
    if (id === current) {
      setTouched(true)
      if (path.length <= 2 && layout === 'compact') setCompactContent(false)
    }
  }
  const backAvailable =
    !!dialog ||
    !!drawer ||
    now ||
    (!!pane && path.length > 1) ||
    (layout === 'compact' && compactContent) ||
    (layout === 'medium' && !touched)
  function back() {
    if (dialog) hide(dialog)
    else if (pane || drawer) hide(drawer || pane!)
  }
  return {
    layout,
    pane,
    drawer,
    dialog,
    now,
    active,
    entries,
    current,
    statuses,
    show,
    hide,
    backAvailable,
    back,
    toPlayer: () => setCompactContent(false),
  }
}

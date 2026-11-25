import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PanelId, PanelStatus } from '../../../shared/panels'

import type { Conversation } from '../../../shared/types'
import {
  begin,
  closePanel,
  filterHistory,
  initial,
  panelOf,
  rootPath,
  toPanel,
  visit,
  visitDetail,
  type Detail,
} from './navigation-history'

const medium = window.matchMedia('(min-width: 520px)')
const wide = window.matchMedia('(min-width: 1040px)')
function subscribe(callback: () => void) {
  medium.addEventListener('change', callback)
  wide.addEventListener('change', callback)
  return () => {
    medium.removeEventListener('change', callback)
    wide.removeEventListener('change', callback)
  }
}
export const isCompactWindow = () => !medium.matches
export function useCompactWindow() {
  return useSyncExternalStore(subscribe, isCompactWindow)
}
const measure = () => (wide.matches ? 'wide' : medium.matches ? 'medium' : 'compact') as Layout
export type Layout = 'compact' | 'medium' | 'wide'
const isDialog = (id: PanelId) =>
  ['windows', 'controls', 'login', 'add', 'confirm', 'match-song'].includes(id)
const isDrawer = (id: PanelId) => ['queue', 'room', 'match', 'members', 'chat'].includes(id)
const lastBrowseKey = 'music-party.last-browse.v1'
// 192px cover + three 24px gutters + a 330px lyric column. Browser zoom reflows both axes.
const playbackColumns = window.matchMedia('(min-width: 594px) and (min-height: 480px)')
function subscribeColumns(notify: () => void) {
  playbackColumns.addEventListener('change', notify)
  return () => playbackColumns.removeEventListener('change', notify)
}
export function usePlaybackColumns() {
  return useSyncExternalStore(subscribeColumns, () => playbackColumns.matches)
}

export function useAdaptiveNavigation(hasSong: boolean, roomId: string | null) {
  const layout = useSyncExternalStore(subscribe, measure)
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(lastBrowseKey) as PanelId
      return begin((saved !== 'private' && rootPath(saved)) || initial)
    } catch {
      return begin(initial)
    }
  })
  const [visited, setVisited] = useState<PanelId[]>(['library'])
  const [dialogs, setDialogs] = useState<PanelId[]>([])
  const [quickPeer, setQuickPeer] = useState<Conversation | null>(null)
  const initialView = useRef(true)
  const hadSong = useRef(hasSong)
  const previousRoom = useRef(roomId)
  useLayoutEffect(() => {
    if (hasSong && initialView.current && layout !== 'wide') {
      initialView.current = false
      setHistory((old) => visit(old, toPanel(old.paths[old.index], 'lyrics')))
    }
    if ((hadSong.current && !hasSong) || previousRoom.current !== roomId) {
      setHistory((old) =>
        filterHistory(
          old,
          (step) =>
            (hasSong || step !== 'lyrics') &&
            (typeof step === 'string' || step.panel !== 'members' || step.roomId === roomId),
        ),
      )
    }
    hadSong.current = hasSong
    previousRoom.current = roomId
  }, [hasSong, layout, roomId])
  useLayoutEffect(() => {
    if (layout === 'wide')
      setDialogs((old) => (old.includes('windows') ? old.filter((id) => id !== 'windows') : old))
  }, [layout])
  const path = history.paths[history.index]
  const stack = path.map(panelOf)
  const current = stack.at(-1)!
  const pane = [...stack].reverse().find((id) => !isDrawer(id)) ?? 'library'
  useEffect(() => {
    if (rootPath(pane) && pane !== 'private') {
      try {
        localStorage.setItem(lastBrowseKey, pane)
      } catch {
        /* Browsing also works without local storage. */
      }
    }
  }, [pane])
  const drawer = quickPeer ? 'private' : isDrawer(current) ? current : null
  const dialog = dialogs.at(-1)
  const active = dialog || drawer || pane
  const entries = [...new Set([...visited, ...stack, ...dialogs, active])]
  const statuses: Partial<Record<PanelId, PanelStatus>> = Object.fromEntries(
    entries.map((id) => [id, { visible: active === id }]),
  )
  const peer =
    quickPeer ??
    path.find((step) => typeof step !== 'string' && step.panel === 'private')?.peer ??
    null
  const section =
    path.find((step) => typeof step !== 'string' && step.panel === 'settings')?.section ?? null
  const member = path.find(
    (step) => typeof step !== 'string' && step.panel === 'members' && step.roomId === roomId,
  )
  function openPage(id: PanelId) {
    initialView.current = false
    setQuickPeer(null)
    setDialogs([])
    if (!id.startsWith('detail-')) setVisited((old) => (old.includes(id) ? old : [...old, id]))
  }
  function show(id: PanelId) {
    if (id === 'windows' && layout === 'wide') return
    if (isDialog(id)) {
      setDialogs((old) => (old.includes(id) ? old.slice(0, old.indexOf(id) + 1) : [...old, id]))
      return
    }
    openPage(id)
    setHistory((old) => visit(old, toPanel(old.paths[old.index], id)))
  }
  function detail(step: Detail) {
    openPage(step.panel)
    setHistory((old) => visitDetail(old, step))
  }
  function hide(id: PanelId) {
    if (id === 'private' && quickPeer) setQuickPeer(null)
    else if (isDialog(id)) setDialogs((old) => old.filter((item) => item !== id))
    else setHistory((old) => closePanel(old, id))
  }
  function back() {
    if (dialog) hide(dialog)
    else if (quickPeer) setQuickPeer(null)
    else setHistory((old) => (old.index > 0 ? { ...old, index: old.index - 1 } : old))
  }
  function forward() {
    if (!dialog && !quickPeer)
      setHistory((old) =>
        old.index + 1 < old.paths.length ? { ...old, index: old.index + 1 } : old,
      )
  }
  function resetSession() {
    setQuickPeer(null)
    setDialogs([])
    setVisited(['library'])
    setHistory((old) =>
      begin(
        old.paths[old.index].filter((step) =>
          typeof step === 'string'
            ? step === 'lyrics' || (step !== 'private' && !!rootPath(step))
            : step.panel === 'settings',
        ),
      ),
    )
  }
  function goToLevel(index: number) {
    setHistory((old) => visit(old, old.paths[old.index].slice(0, index + 1)))
  }
  function reply(peer: Conversation) {
    if (pane === 'private') detail({ panel: 'private', peer })
    else setQuickPeer(peer)
  }
  return {
    layout,
    pane,
    drawer,
    dialog,
    now: pane === 'lyrics',
    active,
    entries,
    current,
    path,
    statuses,
    quickReply: !!quickPeer,
    peer,
    section,
    member: typeof member === 'object' && member.panel === 'members' ? member.member : null,
    show,
    detail,
    reply,
    hide,
    backAvailable: !!dialog || !!quickPeer || history.index > 0,
    previous: history.paths[history.index - 1]?.at(-1),
    back,
    forward,
    goToLevel,
    resetSession,
  }
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link2, Unlink2, X } from 'lucide-react'
import type { PanelAction, PanelId, PanelStatus, PrivateMode } from '../../../shared/panels'
import { SurfaceDocument, PanelHeaderTarget, InlineDialog } from './Surface'

interface Entry {
  id: PanelId
  target: Window
  root: HTMLElement
  clean(): void
}
const emptyStatus: PanelStatus = { visible: false, dock: null, candidate: null }
function mountWindow(id: PanelId): Entry {
  const target = window.open('about:blank', 'mp-' + id, 'popup')
  if (!target) throw new Error('无法打开工具窗口')
  const doc = target.document
  doc.documentElement.lang = 'zh-CN'
  const reflect = () => {
    for (const attr of ['data-theme', 'data-custom-accent', 'style']) {
      const value = document.documentElement.getAttribute(attr)
      if (value === null) doc.documentElement.removeAttribute(attr)
      else doc.documentElement.setAttribute(attr, value)
    }
  }
  reflect()
  const observer = new MutationObserver(reflect)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-custom-accent', 'style'],
  })
  const styles = () => {
    doc.head.querySelectorAll('[data-copied-style]').forEach((el) => el.remove())
    for (const original of document.head.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
      'style,link[rel="stylesheet"]',
    )) {
      const copy = original.cloneNode(true) as HTMLStyleElement | HTMLLinkElement
      if (original instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = original.href
      copy.dataset.copiedStyle = ''
      doc.head.append(copy)
    }
  }
  styles()
  const cssObserver = new MutationObserver(styles)
  cssObserver.observe(document.head, { childList: true, subtree: true, characterData: true })
  doc.body.className = 'panel-window'
  const root = doc.createElement('div')
  root.id = 'panel-root'
  doc.body.append(root)
  return {
    id,
    target,
    root,
    clean() {
      observer.disconnect()
      cssObserver.disconnect()
    },
  }
}

export function useDesktopPanels() {
  const registry = useRef(new Map<PanelId, Entry>())
  const [entries, setEntries] = useState<Entry[]>([])
  const [statuses, setStatuses] = useState<Partial<Record<PanelId, PanelStatus>>>({})
  const command = useCallback(
    (id: PanelId, action: PanelAction) => window.together.panelAction(id, action),
    [],
  )
  useEffect(() => {
    const stop = window.together.onPanelStatus((id, status) =>
      setStatuses((old) => ({ ...old, [id]: status })),
    )
    const registered = registry.current
    return () => {
      stop()
      for (const e of registered.values()) e.clean()
      registered.clear()
    }
  }, [])
  const show = useCallback(
    (
      id: PanelId,
      options: { privateMode?: PrivateMode; passive?: boolean; noticeRows?: number } = {},
    ) => {
      let entry = registry.current.get(id)
      if (!entry || entry.target.closed) {
        entry?.clean()
        entry = mountWindow(id)
        registry.current.set(id, entry)
        setEntries([...registry.current.values()])
      }
      void command(id, { type: 'show', ...options })
    },
    [command],
  )
  const hide = useCallback(
    (id: PanelId) => {
      if (registry.current.has(id)) void command(id, { type: 'hide' })
    },
    [command],
  )
  return {
    entries,
    statuses,
    show,
    hide,
    command,
    documentFor: (id: PanelId) => registry.current.get(id)?.root.ownerDocument,
  }
}
type Panels = ReturnType<typeof useDesktopPanels>

export function DesktopPanel({
  entry,
  panels,
  title,
  children,
  compact = false,
}: {
  entry: Entry
  panels: Panels
  title: string
  children: ReactNode
  compact?: boolean
}) {
  const { id, target } = entry,
    status = panels.statuses[id] ?? emptyStatus
  const [header, setHeader] = useState<HTMLDivElement | null>(null)
  const drag = useRef<number | null>(null)
  useEffect(() => {
    target.document.title = title + ' · Music Party'
  }, [target, title])
  useEffect(() => {
    const doc = entry.root.ownerDocument
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        !event.isComposing
      ) {
        event.preventDefault()
        const field = doc.querySelector<HTMLInputElement>('.panel-header-slot input[type="search"]')
        if (field) {
          field.focus()
          field.select()
        } else panels.show('search')
        return
      }
      if (
        event.key === 'Escape' &&
        !event.isComposing &&
        !event.defaultPrevented &&
        !doc.querySelector('[aria-modal="true"],:popover-open')
      ) {
        event.preventDefault()
        panels.hide(id)
      }
    }
    target.addEventListener('keydown', key)
    return () => target.removeEventListener('keydown', key)
  }, [entry, id, target, panels.hide, panels.show])
  return createPortal(
    <SurfaceDocument.Provider value={entry.root.ownerDocument}>
      <section
        className={'desktop-panel' + (compact ? ' compact-panel' : '')}
        hidden={!status.visible}
        data-panel={id}
        data-dock={status.dock ?? ''}
        data-snap={status.candidate ?? ''}
        aria-label={title}
      >
        <header
          className="panel-titlebar"
          onPointerDown={(e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('button,input,select,a')) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = e.pointerId
            void panels.command(id, { type: 'drag-start', x: e.screenX, y: e.screenY })
          }}
          onPointerMove={(e) => {
            if (drag.current === e.pointerId)
              void panels.command(id, { type: 'drag-move', x: e.screenX, y: e.screenY })
          }}
          onPointerUp={(e) => {
            if (drag.current !== e.pointerId) return
            drag.current = null
            void panels.command(id, { type: 'drag-end', x: e.screenX, y: e.screenY })
          }}
          onPointerCancel={(e) => {
            if (drag.current === e.pointerId) {
              drag.current = null
              void panels.command(id, { type: 'drag-end', x: e.screenX, y: e.screenY })
            }
          }}
        >
          <h1>{title}</h1>
          <div className="panel-header-slot" ref={setHeader} />
          <div className="window-tools">
            <button
              type="button"
              className="icon-btn"
              aria-label={status.dock ? '解除贴靠' : '贴靠到播放器'}
              title={status.dock ? '已贴靠播放器，点击解除' : '贴靠到播放器'}
              aria-pressed={!!status.dock}
              onClick={() => panels.command(id, { type: status.dock ? 'detach' : 'dock' })}
            >
              {status.dock ? <Link2 size={15} /> : <Unlink2 size={15} />}
            </button>
            <button
              className="icon-btn"
              aria-label={'关闭' + title}
              title={'关闭' + title}
              onClick={() => panels.hide(id)}
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="panel-content">
          <PanelHeaderTarget.Provider value={header}>
            <InlineDialog.Provider value={['room', 'match', 'members', 'add'].includes(id)}>
              {children}
            </InlineDialog.Provider>
          </PanelHeaderTarget.Provider>
        </div>
      </section>
    </SurfaceDocument.Provider>,
    entry.root,
    id,
  )
}

import { t } from '../../../shared/ui-language'
import { useContext } from 'react'
import { InlineDialog, useSurfaceActive } from '../windows/Surface'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useCompactWindow } from '../windows/useAdaptiveNavigation'
import { followChatAnchor } from '../chat-popup'
import type { ReactNode } from 'react'

type OverlayProps = {
  title: string
  onClose(): void
  children: ReactNode
  wide?: boolean
  dismissible?: boolean
  id?: string
  picker?: boolean
  sideAnchor?: HTMLElement | null
}
export function Overlay(props: OverlayProps) {
  const inline = useContext(InlineDialog)
  if (inline && !props.sideAnchor)
    return (
      <InlineDialog.Provider value={false}>
        <section className="panel-form" role="dialog" aria-label={props.title}>
          {props.children}
        </section>
      </InlineDialog.Provider>
    )
  return <FloatingOverlay {...props} />
}
function FloatingOverlay({
  title,
  onClose,
  children,
  wide = false,
  dismissible = true,
  sideAnchor,
  picker = false,
  id,
}: OverlayProps) {
  const active = useSurfaceActive()
  const portrait = useCompactWindow()
  const [openedInPortrait] = useState(portrait)
  const root = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  const close = useEffectEvent(onClose)
  const dismissOnEscape = useEffectEvent(() => {
    if (dismissible) setClosing(true)
  })
  useLayoutEffect(() => {
    if (sideAnchor && root.current) return followChatAnchor(root.current, sideAnchor, 360)
  }, [sideAnchor, active])
  useLayoutEffect(() => {
    if (!active) close()
  }, [active])
  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(
      () => close(),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160,
    )
    return () => clearTimeout(timer)
  }, [closing])
  useEffect(() => {
    if (!picker || !active) return
    // A selection panel can be replaced directly from the same composer's toolbar.
    const outside = (event: PointerEvent) => {
      const el = event.target
      if (!(el instanceof Element) || root.current?.contains(el) || sideAnchor?.contains(el)) return
      const top = [...document.querySelectorAll('.modal-backdrop > .player-modal')].at(-1)
      if (top === root.current) close()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [picker, sideAnchor, active])
  useEffect(() => {
    if (!active) return
    const previous = document.activeElement as HTMLElement | null
    const editor = sideAnchor?.closest('form.party-composer')?.querySelector('textarea')
    const focusable = () =>
      [
        ...(root.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) || []),
      ].filter((element) => element.getClientRects().length && !element.closest('[inert]'))
    focusable()[0]?.focus()
    const key = (event: KeyboardEvent) => {
      if (root.current?.querySelector('select:open, :popover-open')) return
      const dialogs = [
        ...document.querySelectorAll<HTMLElement>(
          '[aria-modal="true"], .modal-backdrop > .player-modal',
        ),
      ].filter((dialog) => dialog.getClientRects().length)
      if (dialogs.at(-1) !== root.current) return
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        dismissOnEscape()
      }
      if (event.key === 'Tab') {
        const items = focusable(),
          first = items[0],
          last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      const next = editor || previous
      if (next?.getClientRects().length && !next.closest('[inert]'))
        next.focus({ preventScroll: true })
    }
  }, [active, sideAnchor])
  if (!active) return null
  return createPortal(
    <div
      className={`modal-backdrop ${sideAnchor ? 'side-popup-backdrop' : ''}`}
      data-picker={picker || undefined}
      data-closing={closing}
      data-sheet-motion={closing ? portrait : openedInPortrait}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) setClosing(true)
      }}
    >
      <div
        ref={root}
        inert={closing}
        id={id}
        data-list-viewport={sideAnchor ? undefined : ''}
        className={`modal player-modal ${wide ? 'player-modal-wide' : ''}`}
        role="dialog"
        aria-modal={picker ? undefined : true}
        aria-label={title}
      >
        <div className="overlay-heading">
          <h2>{title}</h2>
          <button
            className="icon-btn"
            aria-label={t('common.close', { title })}
            disabled={!dismissible}
            onClick={() => setClosing(true)}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

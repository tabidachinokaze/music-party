import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Overlay({
  title,
  onClose,
  children,
  wide = false,
  sideAnchor,
}: {
  title: string
  onClose(): void
  children: ReactNode
  wide?: boolean
  sideAnchor?: HTMLElement | null
}) {
  const root = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  const close = useEffectEvent(onClose)
  const [position, setPosition] = useState<CSSProperties>({})
  useLayoutEffect(() => {
    if (!sideAnchor || !root.current) return
    const popup = root.current
    const place = () => {
      const anchor = sideAnchor.getBoundingClientRect()
      const panel = sideAnchor
        .closest('.chat-drawer,.private-conversation-bubble')
        ?.getBoundingClientRect()
      const margin = 20,
        width = Math.min(360, innerWidth - margin * 2)
      const edge = panel || anchor
      let left = edge.left < innerWidth / 2 ? edge.right + 12 : edge.left - width - 12
      left = Math.max(margin, Math.min(left, innerWidth - width - margin))
      const top = panel
        ? Math.max(margin, panel.top)
        : Math.max(
            margin,
            Math.min(anchor.bottom - popup.offsetHeight, innerHeight - popup.offsetHeight - margin),
          )
      setPosition({
        position: 'fixed',
        left,
        top,
        width,
        maxHeight: innerHeight - top - margin,
        margin: 0,
      })
    }
    const resize = new ResizeObserver(place)
    resize.observe(popup)
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    place()
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [sideAnchor])
  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(
      () => close(),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160,
    )
    return () => clearTimeout(timer)
  }, [closing])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => [
      ...(root.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ) || []),
    ]
    focusable()[0]?.focus()
    const key = (event: KeyboardEvent) => {
      const dialogs = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter(
        (dialog) => dialog.getClientRects().length,
      )
      if (dialogs.at(-1) !== root.current) return
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        setClosing(true)
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
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return createPortal(
    <div
      className={`modal-backdrop ${sideAnchor ? 'side-popup-backdrop' : ''}`}
      data-closing={closing}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setClosing(true)
      }}
    >
      <div
        ref={root}
        inert={closing}
        className={`modal player-modal ${wide ? 'player-modal-wide' : ''}`}
        style={position}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="overlay-heading">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label={`关闭${title}`} onClick={() => setClosing(true)}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

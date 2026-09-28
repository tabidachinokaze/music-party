import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Overlay({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose(): void
  children: ReactNode
  wide?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  const close = useEffectEvent(onClose)
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
      className="modal-backdrop"
      data-closing={closing}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setClosing(true)
      }}
    >
      <div
        ref={root}
        inert={closing}
        className={`modal player-modal ${wide ? 'player-modal-wide' : ''}`}
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

import type { ComponentProps, ReactNode } from 'react'
import { Overlay } from './player/Overlay'

export function ComposerPanel({
  title,
  anchor,
  onClose,
  tools,
  actions,
  status,
  children,
  contentProps,
  picker = false,
  id,
}: {
  title: string
  anchor: HTMLElement | null
  onClose(): void
  tools?: ReactNode
  actions?: ReactNode
  status?: ReactNode
  children: ReactNode
  contentProps?: ComponentProps<'div'>
  picker?: boolean
  id?: string
}) {
  return (
    <Overlay title={title} id={id} sideAnchor={anchor} onClose={onClose} picker={picker}>
      {tools && <div className="composer-panel-tools">{tools}</div>}
      <div
        {...contentProps}
        className={`composer-panel-content ${contentProps?.className || ''}`}
        data-list-viewport=""
      >
        {children}
      </div>
      {status}
      {actions && <div className="composer-panel-actions">{actions}</div>}
    </Overlay>
  )
}

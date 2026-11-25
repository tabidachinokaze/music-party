import { ui } from '../../../shared/ui-language'
import { type ButtonHTMLAttributes, type ReactNode } from 'react'

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={'mp-icon-button ' + className}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  )
}

export function UnreadBadge({ count }: { count: number }) {
  return count > 0 ? (
    <span className="mp-badge" aria-label={count + ui(' 条未读', ' unread')}>
      {count > 99 ? '99+' : count}
    </span>
  ) : null
}

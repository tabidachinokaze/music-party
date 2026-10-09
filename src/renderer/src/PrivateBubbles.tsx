import { useCallback, useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react'
import { MessageCircle, X } from 'lucide-react'
import type { Conversation } from '../../shared/types'
import { privateBubbleTop } from './private-bubble-layout'
import './private-bubbles.css'

interface PrivateBubbleProps {
  peers: readonly Conversation[]
  visible?: boolean
  enabled?: boolean
  onOpen(peer: Conversation): void
  onDismiss(uid: string): void
}

/** Compact notifications stay in the player; opening/replying is owned by its conversation view. */
function useBubbleTop(visible: boolean, count: number, width = 320) {
  const container = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(20)
  useEffect(() => {
    if (!visible || !count) return
    let animation = 0
    const measure = () => {
      cancelAnimationFrame(animation)
      animation = requestAnimationFrame(() => {
        const controls = [
          ...document.querySelectorAll<HTMLElement>(
            '.music-header, .listening-topline, .listening-room, [data-private-bubble-avoid]',
          ),
        ]
          .filter((node) => node.getClientRects().length)
          .map((node) => node.getBoundingClientRect())
        setTop(
          privateBubbleTop(
            window.innerWidth,
            window.innerHeight,
            controls,
            container.current?.getBoundingClientRect().width ?? width,
          ),
        )
      })
    }
    const resize = new ResizeObserver(measure)
    resize.observe(document.documentElement)
    for (const node of document.querySelectorAll(
      '.music-header, .listening-topline, .listening-room',
    ))
      resize.observe(node)
    const mutations = new MutationObserver(measure)
    // Expansion/fullscreen changes the app's class without necessarily resizing the window.
    const app = document.querySelector('.app-shell') ?? document.querySelector('#root')
    if (app)
      mutations.observe(app, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true,
      })
    window.addEventListener('resize', measure)
    measure()
    return () => {
      cancelAnimationFrame(animation)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [visible, count, width])
  return { container, top }
}

export function PrivateBubbles({
  peers,
  visible = true,
  enabled = true,
  onOpen,
  onDismiss,
}: PrivateBubbleProps) {
  const [toasts, setToasts] = useState(new Set<string>())
  const onToast = useCallback((uid: string, active: boolean) => {
    setToasts((previous) => {
      if (previous.has(uid) === active) return previous
      const next = new Set(previous)
      if (active) next.add(uid)
      else next.delete(uid)
      return next
    })
  }, [])
  const shown = enabled && (visible || toasts.size > 0)
  const { container, top } = useBubbleTop(shown, peers.length)
  if (!peers.length) return null
  return (
    <div
      ref={container}
      className="private-bubbles"
      style={{ '--private-bubble-top': `${top}px` } as CSSProperties}
      aria-label="新私信通知"
      hidden={!shown}
    >
      {peers.map((peer) => (
        <PrivateNotification
          key={peer.uid}
          peer={peer}
          onOpen={onOpen}
          onDismiss={onDismiss}
          onToast={onToast}
        />
      ))}
    </div>
  )
}

function PrivateNotification({
  peer,
  onOpen,
  onDismiss,
  onToast,
}: {
  peer: Conversation
  onOpen(peer: Conversation): void
  onDismiss(uid: string): void
  onToast(uid: string, active: boolean): void
}) {
  const [toast, setToast] = useState(peer.unread > 0),
    [paused, setPaused] = useState(false)
  const node = useRef<HTMLDivElement>(null),
    remaining = useRef(8000)
  const version = `${peer.time}:${peer.preview}:${peer.unread}`
  useEffect(() => {
    onToast(peer.uid, toast)
    return () => onToast(peer.uid, false)
  }, [peer.uid, toast, onToast])
  useEffect(() => {
    remaining.current = 8000
    setToast(peer.unread > 0)
  }, [version])
  useEffect(() => {
    if (!toast || paused) return
    const started = Date.now(),
      timer = setTimeout(() => setToast(false), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [version, toast, paused])
  return (
    <div
      ref={node}
      className="private-bubble"
      data-collapsed={!toast}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(node.current?.matches(':focus-within') ?? false)}
      onFocus={() => setPaused(true)}
      onBlur={() =>
        queueMicrotask(() => setPaused(node.current?.matches(':hover,:focus-within') ?? false))
      }
    >
      <button
        className="private-bubble-open"
        onClick={() => onOpen(peer)}
        aria-label={`与${peer.nickname}对话${peer.unread ? `，${peer.unread}条未读私信` : ''}`}
      >
        <span className="private-bubble-avatar">
          {peer.avatar ? <img src={peer.avatar} alt="" /> : <MessageCircle size={24} />}
          {peer.online === true && <span className="private-bubble-online" aria-label="在线" />}
          {peer.unread > 0 && (
            <span className="private-bubble-count">{peer.unread > 99 ? '99+' : peer.unread}</span>
          )}
        </span>
        {toast && (
          <span className="private-bubble-content">
            <strong>{peer.nickname}</strong>
            <span role="status">{peer.preview || '发来了一条私信'}</span>
          </span>
        )}
      </button>
      <button
        className="private-bubble-dismiss"
        aria-label={`收起${peer.nickname}的私信通知`}
        title="收起通知，不标记已读"
        onClick={() => onDismiss(peer.uid)}
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function PrivateConversationBubble({
  title,
  onClose,
  children,
}: {
  title: string
  onClose(): void
  children: import('react').ReactNode
}) {
  const { container, top } = useBubbleTop(true, 1, 380)
  const close = useEffectEvent(onClose)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    container.current
      ?.querySelector<HTMLTextAreaElement>('textarea')
      ?.focus({ preventScroll: true })
    const key = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.isComposing &&
        !event.defaultPrevented &&
        ![...document.querySelectorAll<HTMLElement>('[aria-modal="true"],:popover-open')].some(
          (node) => node.getClientRects().length,
        )
      ) {
        event.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  return (
    <div
      ref={container}
      className="private-conversation-bubble"
      role="dialog"
      aria-label={title}
      style={{ '--private-bubble-top': `${top}px` } as CSSProperties}
    >
      <div className="private-bubble-heading">
        <strong>{title}</strong>
        <button className="icon-btn" aria-label={`关闭${title}`} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {children}
    </div>
  )
}

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { animate } from 'animejs'
import {
  ArrowLeft,
  ChevronDown,
  Clock3,
  Disc3,
  Grid2X2,
  Headphones,
  Heart,
  Library,
  ListMusic,
  LogIn,
  Mail,
  MessageCircle,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import type { PanelId } from '../../../shared/panels'
import { InlineDialog, PanelHeaderTarget, SurfaceActive } from './Surface'
import type { useAdaptiveNavigation } from './useAdaptiveNavigation'

type Navigation = ReturnType<typeof useAdaptiveNavigation>
type OpenProps = { open(id: PanelId): void }
const links = [
  ['search', '搜索', Search],
  ['library', '音乐库', Library],
  ['liked', '我喜欢的音乐', Heart],
  ['recent', '最近播放', Clock3],
  ['created', '创建的歌单', ListMusic],
  ['albums', '收藏的专辑', Disc3],
] as const
export function Sidebar({
  open,
  active,
  nickname,
  avatar,
  unread,
}: OpenProps & { active: PanelId | null; nickname?: string; avatar?: string; unread: number }) {
  return (
    <aside className="main-sidebar" aria-label="主导航">
      <div className="brand-lockup">
        <span>
          <Headphones size={22} />
        </span>
        <strong>music party</strong>
      </div>
      <nav>
        {links.map(([id, name, Icon]) => (
          <button
            key={id}
            aria-current={active === id ? 'page' : undefined}
            onClick={() => open(id)}
          >
            <Icon size={18} />
            {name}
          </button>
        ))}
      </nav>
      <nav className="sidebar-secondary">
        <button onClick={() => open('room')}>
          <Headphones size={18} />
          一起听
        </button>
        <button onClick={() => open('private')}>
          <Mail size={18} />
          私信{unread > 0 && <small>{Math.min(99, unread)}</small>}
        </button>
        <button
          aria-current={active === 'settings' ? 'page' : undefined}
          onClick={() => open('settings')}
        >
          <Settings2 size={18} />
          设置
        </button>
        <button onClick={() => open('windows')}>
          <Grid2X2 size={18} />
          全部功能
        </button>
      </nav>
      <button className="sidebar-account" onClick={() => open(nickname ? 'settings' : 'login')}>
        {avatar ? <img src={avatar} alt="" /> : <LogIn size={17} />}
        <span>{nickname || '扫码登录'}</span>
      </button>
    </aside>
  )
}
export function CompanionTabs({ open, active }: OpenProps & { active: PanelId | null }) {
  return (
    <nav className="companion-tabs" aria-label="播放内容">
      {(
        [
          ['queue', '队列', ListMusic],
          ['lyrics', '歌词', Disc3],
          ['chat', '聊天', MessageCircle],
          ['library', '音乐库', Library],
        ] as const
      ).map(([id, name, Icon]) => (
        <button key={id} aria-current={active === id ? 'page' : undefined} onClick={() => open(id)}>
          <Icon size={15} />
          <span>{name}</span>
        </button>
      ))}
      <button aria-label="全部功能" title="全部功能" onClick={() => open('windows')}>
        <Grid2X2 size={16} />
      </button>
    </nav>
  )
}

export function useShellKeyboard(nav: Navigation) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (
      e.defaultPrevented ||
      e.isComposing ||
      document.querySelector('.modal-backdrop, :popover-open')
    )
      return
    if (e.key === 'Tab' && nav.dialog) {
      const dialog = document.querySelector<HTMLElement>('.surface-dialog')
      const items = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) || [],
      ).filter((item) => item.getClientRects().length)
      const first = items[0],
        last = items.at(-1)
      if (
        first &&
        last &&
        ((e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) ||
          (!e.shiftKey && document.activeElement === last))
      ) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
      return
    }
    if (e.key === 'Escape' && nav.backAvailable) {
      e.preventDefault()
      nav.back()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      if (nav.dialog) return
      const focusSearch = () => {
        const field = document.querySelector<HTMLInputElement>(
          '.desktop-panel:not([hidden],[inert]) .panel-header-slot input[type=search]',
        )
        if (field) {
          field.focus()
          field.select()
        }
        return !!field
      }
      if (!focusSearch()) {
        nav.show('search')
        requestAnimationFrame(focusSearch)
      }
    }
  })
  useEffect(() => {
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

export function Surface({
  id,
  title,
  placement,
  blocked,
  close,
  onMenu,
  children,
}: {
  id: PanelId
  title: string
  placement: 'page' | 'companion' | 'drawer' | 'dialog' | 'immersive' | 'hidden'
  blocked: boolean
  close?: () => void
  onMenu?: () => void
  children: ReactNode
}) {
  const [header, setHeader] = useState<HTMLElement | null>(null)
  const root = useRef<HTMLElement>(null)
  const floating = placement === 'dialog' || placement === 'drawer' || placement === 'immersive'
  useLayoutEffect(() => {
    const el = root.current
    if (!el || !floating || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const motion = animate(
      el,
      placement === 'drawer'
        ? { translateX: [32, 0], opacity: [0.6, 1], duration: 190, ease: 'outCubic' }
        : { translateY: [8, 0], opacity: [0.8, 1], duration: 170, ease: 'outQuad' },
    )
    return () => {
      motion.revert()
    }
  }, [placement, floating])
  useLayoutEffect(() => {
    if (!floating || blocked || document.querySelector('.modal-backdrop, :popover-open')) return
    const before = document.activeElement as HTMLElement | null
    const el = root.current
    if (!el?.contains(before)) el?.focus({ preventScroll: true })
    return () => {
      if (before?.isConnected && before.getClientRects().length && !before.closest('[inert]'))
        before.focus({ preventScroll: true })
    }
  }, [floating, blocked])
  return (
    <section
      ref={root}
      className={'desktop-panel panel-window shell-surface surface-' + placement}
      tabIndex={-1}
      data-panel={id}
      hidden={placement === 'hidden'}
      inert={blocked || placement === 'hidden'}
      aria-label={title}
      role={placement === 'dialog' ? 'dialog' : undefined}
      aria-modal={placement === 'dialog' ? true : undefined}
    >
      {placement !== 'immersive' && (
        <header className="panel-titlebar">
          {close && (placement === 'page' || placement === 'companion') && (
            <button
              className="icon-btn surface-back"
              aria-label={'关闭' + title}
              title="返回"
              onClick={close}
            >
              {placement === 'page' ? <ArrowLeft size={17} /> : <ChevronDown size={17} />}
            </button>
          )}
          <h1>{title}</h1>
          <div className="panel-header-slot" ref={setHeader} />
          {onMenu && (
            <button
              className="icon-btn surface-menu"
              aria-label="全部功能"
              title="全部功能"
              onClick={onMenu}
            >
              <Grid2X2 size={16} />
            </button>
          )}
          {close && (placement === 'dialog' || placement === 'drawer') && (
            <button className="icon-btn surface-close" aria-label={'关闭' + title} onClick={close}>
              <X size={18} />
            </button>
          )}
        </header>
      )}
      <div className="panel-content">
        <SurfaceActive.Provider value={!blocked && placement !== 'hidden'}>
          <PanelHeaderTarget.Provider value={header}>
            <InlineDialog.Provider value={['room', 'match', 'members', 'add'].includes(id)}>
              {children}
            </InlineDialog.Provider>
          </PanelHeaderTarget.Provider>
        </SurfaceActive.Provider>
      </div>
    </section>
  )
}

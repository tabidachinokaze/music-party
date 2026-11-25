import { t } from '../../../shared/ui-language'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { animate } from 'animejs'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Compass,
  Mail,
  Clock3,
  Disc3,
  Grid2X2,
  Minus,
  Square,
  Copy,
  Heart,
  UserRound,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import { UserAvatar } from '../design/UserAvatar'
import { IconButton, UnreadBadge } from '../design/Primitives'
import type { NavigationDirection } from '../../../shared/desktop'
import type { PanelId } from '../../../shared/panels'
import { InlineDialog, PanelHeaderTarget, SurfaceActive } from './Surface'
import { isCompactWindow, type Layout, type useAdaptiveNavigation } from './useAdaptiveNavigation'

type Navigation = ReturnType<typeof useAdaptiveNavigation>
type OpenProps = { open(id: PanelId): void }
export function WindowButtons({
  maximized,
  fullScreen,
}: {
  maximized: boolean
  fullScreen: boolean
}) {
  if (fullScreen) return null
  return (
    <div className="window-buttons" role="group" aria-label={t('adaptiveShell.windowControls')}>
      <IconButton
        label={t('common.minimize')}
        onClick={() => void window.together.windowAction('minimize')}
      >
        <Minus size={14} />
      </IconButton>
      <IconButton
        label={maximized ? t('adaptiveShell.restore') : t('adaptiveShell.maximize')}
        onClick={() => void window.together.windowAction('toggle-maximize')}
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </IconButton>
      <IconButton
        label={t('adaptiveShell.closeWindow')}
        onClick={() => void window.together.windowAction('close')}
      >
        <X size={15} />
      </IconButton>
    </div>
  )
}

export function WindowChrome({
  open,
  nickname,
  avatar,
  unread,
  blocked,
  onBack,
  layout,
  searchShortcut,
}: OpenProps & {
  nickname?: string
  avatar?: string
  unread: number
  blocked: boolean
  onBack?: () => void
  layout: Layout
  searchShortcut: boolean
}) {
  if (onBack)
    return (
      <div className="immersive-window-tools" inert={blocked}>
        <IconButton
          className="chrome-back"
          label={t('adaptiveShell.backToBrowsing')}
          onClick={onBack}
        >
          <ChevronDown size={17} />
        </IconButton>
      </div>
    )
  return (
    <header className="mp-window-chrome">
      <div className="mp-chrome-brand">
        <span className="mp-mark">
          <Disc3 size={13} strokeWidth={2.2} />
        </span>
        <strong>Music Party</strong>
      </div>
      <div className="mp-chrome-actions" inert={blocked}>
        {searchShortcut && (
          <IconButton
            className="chrome-search"
            label={t('common.searchAllMusic')}
            onClick={() => open('search')}
          >
            <Search size={16} />
          </IconButton>
        )}
        {layout !== 'wide' && (
          <IconButton
            className="chrome-menu"
            label={t('common.allFeatures')}
            aria-description={
              layout === 'compact' && unread
                ? t('adaptiveShell.unreadMessages', { count: unread })
                : undefined
            }
            onClick={() => open('windows')}
          >
            <Grid2X2 size={16} />
            {layout === 'compact' && unread > 0 && (
              <span className="unread-dot" aria-hidden="true" />
            )}
          </IconButton>
        )}
        <IconButton
          className="chrome-account"
          label={
            unread
              ? t('adaptiveShell.viewUnreadMessages')
              : nickname
                ? t('adaptiveShell.openSettings', { nickname })
                : t('adaptiveShell.signIn')
          }
          onClick={() => open(unread ? 'private' : nickname ? 'settings' : 'login')}
        >
          {nickname ? <UserAvatar name={nickname} src={avatar} /> : <UserRound size={16} />}
          <UnreadBadge count={unread} />
        </IconButton>
      </div>
    </header>
  )
}

export function Sidebar({
  open,
  trail,
  unread,
  likedCount,
}: OpenProps & {
  trail: PanelId[]
  unread: number
  likedCount?: number
}) {
  const mainLinks = [
    ['library', t('common.library'), Compass],
    ['search', t('common.search'), Search],
    ['liked', t('common.likedSongs'), Heart],
    ['recent', t('common.recentlyPlayed'), Clock3],
  ] as const
  const accountLinks = [
    ['private', t('common.messages'), Mail],
    ['settings', t('common.settings'), Settings2],
  ] as const
  const sidebarIds = new Set<PanelId>([...mainLinks, ...accountLinks].map(([id]) => id))
  const active = trail.filter((id) => sidebarIds.has(id)).at(-1)
  return (
    <aside
      data-list-viewport=""
      className="main-sidebar"
      aria-label={t('adaptiveShell.mainNavigation')}
    >
      {[mainLinks, accountLinks].map((links, group) => (
        <nav
          key={group}
          aria-label={
            group ? t('adaptiveShell.accountAndSettings') : t('adaptiveShell.musicNavigation')
          }
        >
          {links.map(([id, name, Icon]) => (
            <button
              key={id}
              title={name}
              aria-label={name}
              aria-description={
                id === 'liked' && likedCount !== undefined
                  ? t('music.trackCount', { count: likedCount })
                  : undefined
              }
              aria-current={active === id ? 'page' : undefined}
              onClick={() => open(id)}
            >
              <Icon size={16} />
              <span>{name}</span>
              {id === 'private' && <UnreadBadge count={unread} />}
              {id === 'liked' && likedCount !== undefined && (
                <small className="mp-nav-count">{likedCount}</small>
              )}
            </button>
          ))}
        </nav>
      ))}
    </aside>
  )
}
export function useShellKeyboard(nav: Navigation) {
  const navigate = useEffectEvent((direction: NavigationDirection) => {
    const popover = document.querySelector<HTMLElement>(':popover-open')
    if (popover) {
      if (direction === 'back') popover.hidePopover()
      return
    }
    if (document.querySelector('.modal-backdrop')) {
      if (direction === 'back')
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      return
    }
    if (direction === 'back') nav.back()
    else nav.forward()
  })
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (
      e.defaultPrevented ||
      e.isComposing ||
      document.querySelector('.modal-backdrop, :popover-open, select:open')
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
    } else if ((e.ctrlKey || e.metaKey) && ['f', 'k'].includes(e.key.toLowerCase())) {
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
    // Some drivers report each side button twice, through Electron and through Chromium.
    // Pair opposite sources in either order, without throttling consecutive physical presses.
    type Source = 'native' | 'renderer'
    let unmatched: { source: Source; direction: NavigationDirection; time: number }[] = []
    const onGesture = (direction: NavigationDirection, source: Source) => {
      const time = performance.now()
      unmatched = unmatched.filter((gesture) => time - gesture.time < 250)
      const pair = unmatched.findIndex(
        (gesture) => gesture.direction === direction && gesture.source !== source,
      )
      if (pair >= 0) {
        unmatched.splice(pair, 1)
        return
      }
      unmatched.push({ source, direction, time })
      navigate(direction)
    }
    const unsubscribe = window.together.onNavigate((direction) => onGesture(direction, 'native'))
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      if (e.type === 'mousedown') onGesture(e.button === 3 ? 'back' : 'forward', 'renderer')
    }
    const onNavigationKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.shiftKey) return
      const back = e.key === 'BrowserBack' || (e.altKey && e.key === 'ArrowLeft')
      const forward = e.key === 'BrowserForward' || (e.altKey && e.key === 'ArrowRight')
      if (!back && !forward) return
      e.preventDefault()
      e.stopPropagation()
      const direction = back ? 'back' : 'forward'
      if (e.altKey) navigate(direction)
      else onGesture(direction, 'renderer')
    }
    window.addEventListener('mousedown', onMouse, true)
    window.addEventListener('mouseup', onMouse, true)
    window.addEventListener('auxclick', onMouse, true)
    window.addEventListener('keydown', onNavigationKey, true)
    document.addEventListener('keydown', onKey)
    return () => {
      unsubscribe()
      window.removeEventListener('mousedown', onMouse, true)
      window.removeEventListener('mouseup', onMouse, true)
      window.removeEventListener('auxclick', onMouse, true)
      window.removeEventListener('keydown', onNavigationKey, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [])
}

type Crumb = { key: string; label: string; level: number }

export function usePanelEntrance(drawer: PanelId | null, dialog: PanelId | undefined) {
  const shell = useRef<HTMLDivElement>(null)
  const previousDrawer = useRef<PanelId | null>(null)
  useLayoutEffect(() => {
    const opening = dialog || (drawer && !previousDrawer.current)
    previousDrawer.current = drawer
    if (!opening || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const panel = shell.current?.querySelector<HTMLElement>(
      dialog ? '.surface-dialog' : '.surface-drawer',
    )
    if (!panel) return
    const motion = animate(panel, {
      clipPath: [
        isCompactWindow()
          ? 'inset(100% 0% 0% 0%)'
          : dialog
            ? 'inset(4% 0% 0% 0%)'
            : 'inset(0% 0% 0% 100%)',
        'inset(0% 0% 0% 0%)',
      ],
      duration: isCompactWindow() ? 210 : 180,
      ease: 'outCubic',
      onComplete: () => panel.style.removeProperty('clip-path'),
    })
    return () => {
      motion.revert()
    }
  }, [drawer, dialog])
  return shell
}

function PageNavigation({
  trail,
  onLevel,
  onBack,
  backLabel,
}: {
  trail: Crumb[]
  onLevel(level: number): void
  onBack?: () => void
  backLabel: string
}) {
  return (
    <nav className="page-navigation" aria-label={t('adaptiveShell.pageNavigation')}>
      {onBack && (
        <IconButton className="icon-btn surface-back" label={backLabel} onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
      )}
      <ol className="page-crumbs">
        {trail.map((crumb, index) => (
          <li key={crumb.key}>
            {index > 0 && (
              <span className="crumb-separator" aria-hidden="true">
                /
              </span>
            )}
            {index === trail.length - 1 ? (
              <h1 aria-current="page" title={crumb.label}>
                {crumb.label}
              </h1>
            ) : (
              <button type="button" title={crumb.label} onClick={() => onLevel(crumb.level)}>
                {crumb.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function Surface({
  id,
  title,
  placement,
  modal,
  blocked,
  close,
  trail,
  onLevel,
  onBack,
  backLabel,
  children,
}: {
  id: PanelId
  title: string
  placement: 'page' | 'drawer' | 'dialog' | 'immersive' | 'hidden'
  modal: boolean
  blocked: boolean
  close?: () => void
  trail: Crumb[]
  onLevel(level: number): void
  onBack?: () => void
  backLabel: string
  children: ReactNode
}) {
  const [header, setHeader] = useState<HTMLElement | null>(null)
  const root = useRef<HTMLElement>(null)
  const floating = placement === 'dialog' || placement === 'drawer' || placement === 'immersive'
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
      role={modal ? 'dialog' : undefined}
      aria-modal={modal || undefined}
    >
      {placement !== 'immersive' && (
        <header className="panel-titlebar">
          {placement === 'drawer' && !onBack && close && (
            <IconButton
              className="icon-btn drawer-collapse"
              label={t('common.close', { title })}
              onClick={close}
            >
              <ChevronRight size={17} />
            </IconButton>
          )}
          {trail.length ? (
            <PageNavigation trail={trail} onLevel={onLevel} onBack={onBack} backLabel={backLabel} />
          ) : (
            <h1>{title}</h1>
          )}
          <div className="panel-header-slot" ref={setHeader} />
          {close && (placement === 'dialog' || (placement === 'drawer' && onBack)) && (
            <button
              className="icon-btn surface-close"
              aria-label={t('common.close', { title })}
              onClick={close}
            >
              <X size={18} />
            </button>
          )}
        </header>
      )}
      <div data-list-viewport="" className="panel-content">
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

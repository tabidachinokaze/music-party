import { t } from '../../../shared/ui-language'
import { RoomMatchSong } from '../player/RoomSetup'
import { useState } from 'react'
import {
  AlignLeft,
  Check,
  ChevronRight,
  Clock3,
  Headphones,
  Heart,
  Library,
  ListMusic,
  LogIn,
  Mail,
  MessageCircle,
  Music2,
  Search,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react'
import type { PanelId } from '../../../shared/panels'
import { roomTypeLabel } from '../../../shared/multiplayer'
import type { useParty } from '../useParty'
import { MusicBrowser } from '../MusicBrowser'
import { BrowserSearch, type BrowserNavigationState } from '../BrowserNavigation'
import { PanelHeader } from './Surface'

const directoryItems = () =>
  [
    ['lyrics', t('common.lyrics'), AlignLeft],
    ['controls', t('common.playbackControls'), SlidersHorizontal],
    ['queue', t('common.playQueue'), ListMusic],
    ['search', t('common.search'), Search],
    ['library', t('common.library'), Library],
    ['room', t('common.listenTogether'), Headphones],
    ['chat', t('common.roomChat'), MessageCircle],
    ['private', t('common.messages'), Mail],
    ['settings', t('common.settings'), Settings2],
  ] as const
export const panelTitle = (id: PanelId) =>
  directoryItems().find(([key]) => id === key)?.[1] ??
  (
    {
      windows: t('common.allFeatures'),
      recent: t('common.recentlyPlayed'),
      created: t('panelPages.myPlaylists'),
      liked: t('common.likedSongs'),
      albums: t('common.savedAlbums'),
      login: t('common.signInWithQrCode'),
      members: t('common.roomMembers'),
      match: t('panelPages.matchARoom'),
      'match-song': t('common.changeSong'),
      add: t('common.addToPlaylist'),
      diagnostics: t('panelPages.activityLog'),
      confirm: t('panelPages.confirmAction'),
      feedback: t('panelPages.playbackNotification'),
    } as Record<string, string>
  )[id] ??
  t('panelPages.trackDetails')

export function WindowDirectory({
  open,
  current,
  unread,
  chatUnread,
  account,
}: {
  open(id: PanelId): void
  current: PanelId | null
  unread: number
  chatUnread: number
  account: ReturnType<typeof useParty>['account']
}) {
  return (
    <nav className="window-directory" aria-label={t('common.allFeatures')}>
      {directoryItems().map(([id, title, Icon]) => {
        const count = id === 'private' ? unread : id === 'chat' ? chatUnread : 0
        return (
          <button
            key={id}
            aria-label={title}
            aria-description={
              [
                id === current && t('common.open'),
                count > 0 && t('privateMessages.unread', { count }),
              ]
                .filter(Boolean)
                .join('，') || undefined
            }
            onClick={() => open(id)}
          >
            <Icon size={18} />
            <span>{title}</span>
            {count > 0 && <small>{count > 99 ? '99+' : count}</small>}
            {id === current ? (
              <Check size={14} aria-label={t('common.open')} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
        )
      })}
      <button
        className="directory-account"
        title={account ? t('panelPages.openSettings') : t('common.signInWithQrCode')}
        onClick={() => open(account ? 'settings' : 'login')}
      >
        {account?.avatarUrl ? <img alt="" src={account.avatarUrl} /> : <LogIn size={18} />}
        <span>{account?.nickname || t('common.signInWithQrCode')}</span>
        <ChevronRight size={14} />
      </button>
    </nav>
  )
}

export function LibraryPanel({
  search = false,
  category: view = 'library',
  onSection,
  ...props
}: Omit<React.ComponentProps<typeof MusicBrowser>, 'view'> & {
  search?: boolean
  onSection?(id: PanelId): void
  category?: 'library' | 'liked' | 'albums'
}) {
  const [nav, setNav] = useState<BrowserNavigationState | null>(null)
  const browse = !search && !props.initialSource && !props.createdOnly
  return (
    <div className="catalog">
      {nav && (
        <PanelHeader>
          <BrowserSearch navigation={nav} />
        </PanelHeader>
      )}
      {browse && (
        <div className="catalog-tabs" aria-label={t('panelPages.libraryCategories')}>
          {(
            [
              ['library', t('common.playlists'), Library],
              ['liked', t('panelPages.liked'), Heart],
              ['recent', t('common.recentlyPlayed'), Clock3],
              ['albums', t('common.savedAlbums'), Music2],
            ] as const
          ).map(([key, name, Icon]) => (
            <button key={key} aria-pressed={view === key} onClick={() => onSection?.(key)}>
              <Icon size={14} />
              {name}
            </button>
          ))}
        </div>
      )}
      <MusicBrowser
        {...props}
        key={search ? 'search' : view}
        view={search ? 'search' : view}
        openCurrent={onSection && (() => onSection('lyrics'))}
        onNavigation={setNav}
      />
    </div>
  )
}
export function RoomPanel({
  party: p,
  open,
  leave,
  onChooseSong,
}: {
  party: ReturnType<typeof useParty>
  open(id: PanelId): void
  leave(): void
  onChooseSong(): void
}) {
  const tags = p.room?.tags
  const creator =
    p.room?.creatorName ||
    (p.room?.creatorUid
      ? t('common.userId', { uid: p.room.creatorUid })
      : t('panelPages.unavailable'))
  return (
    <div className="room-lobby room-tools">
      <section className="room-card room-count">
        <h3>{t('panelPages.roomInformation')}</h3>
        <dl className="room-facts">
          <div>
            <dt>{t('panelPages.onlineMembers')}</dt>
            <dd>
              <button
                className="room-members-link"
                aria-label={t('common.viewRoomMembers')}
                title={t('common.viewRoomMembers')}
                onClick={() => open('members')}
              >
                {p.onlineCount === null
                  ? t('panelPages.viewMembers')
                  : t('panelPages.online', { count: p.onlineCount })}
              </button>
            </dd>
          </div>
          <div>
            <dt>{t('panelPages.roomType')}</dt>
            <dd>{roomTypeLabel(p.room?.roomBizType)}</dd>
          </div>
          <div>
            <dt>{t('panelPages.createdBy')}</dt>
            <dd>{creator}</dd>
          </div>
          <div>
            <dt>{t('panelPages.musicTags')}</dt>
            <dd>{tags?.length ? tags.join(' · ') : t('panelPages.noTagsYet')}</dd>
          </div>
        </dl>
      </section>

      <section className="room-card">
        <h3>{t('panelPages.meetNewListeners')}</h3>
        <p>{t('panelPages.findAnotherRoomToShareMusicWithNew')}</p>
        <RoomMatchSong party={p} onChooseSong={onChooseSong} />
        <div className="room-actions">
          <button
            className="secondary"
            disabled={!!p.busy || p.matching || !p.matchSong}
            onClick={() => p.act(t('common.findAnotherRoom'), p.rematchRoom)}
          >
            {t('common.findAnotherRoom')}
          </button>
        </div>
        <p>{t('panelPages.matchingAgainLeavesThisRoomToFindNew')}</p>
      </section>

      <div className="room-actions room-actions-footer">
        <button
          className="secondary"
          onClick={() => p.act(t('common.copyInvitationLink'), p.copyInvite)}
        >
          {t('common.copyInvitationLink')}
        </button>
        <button className="secondary" onClick={() => open('private')}>
          {t('panelPages.inviteViaMessage')}
        </button>
        <button className="secondary room-danger room-leave" onClick={leave}>
          {t('panelPages.leaveRoom')}
        </button>
      </div>
    </div>
  )
}

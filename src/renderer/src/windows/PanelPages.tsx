import { ui } from '../../../shared/ui-language'
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
    ['lyrics', ui('歌词', 'Lyrics'), AlignLeft],
    ['controls', ui('播放调节', 'Playback controls'), SlidersHorizontal],
    ['queue', ui('播放队列', 'Play queue'), ListMusic],
    ['search', ui('搜索', 'Search'), Search],
    ['library', ui('音乐库', 'Library'), Library],
    ['room', ui('一起听', 'Listen Together'), Headphones],
    ['chat', ui('房间聊天', 'Room chat'), MessageCircle],
    ['private', ui('私信', 'Messages'), Mail],
    ['settings', ui('设置', 'Settings'), Settings2],
  ] as const
export const panelTitle = (id: PanelId) =>
  directoryItems().find(([key]) => id === key)?.[1] ??
  (
    {
      windows: ui('全部功能', 'All features'),
      recent: ui('最近播放', 'Recently played'),
      created: ui('创建的歌单', 'My playlists'),
      liked: ui('我喜欢的音乐', 'Liked Songs'),
      albums: ui('收藏的专辑', 'Saved albums'),
      login: ui('扫码登录', 'Sign in with QR code'),
      members: ui('房间成员', 'Room members'),
      match: ui('匹配房间', 'Match a room'),
      'match-song': ui('切换歌曲', 'Change song'),
      add: ui('添加到歌单', 'Add to playlist'),
      diagnostics: ui('观测记录', 'Activity log'),
      confirm: ui('确认操作', 'Confirm action'),
      feedback: ui('播放提示', 'Playback notification'),
    } as Record<string, string>
  )[id] ??
  ui('曲目详情', 'Track details')

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
    <nav className="window-directory" aria-label={ui('全部功能', 'All features')}>
      {directoryItems().map(([id, title, Icon]) => {
        const count = id === 'private' ? unread : id === 'chat' ? chatUnread : 0
        return (
          <button
            key={id}
            aria-label={title}
            aria-description={
              [
                id === current && ui('已打开', 'Open'),
                count > 0 && count + ui(' 条未读', ' unread'),
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
              <Check size={14} aria-label={ui('已打开', 'Open')} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
        )
      })}
      <button
        className="directory-account"
        title={account ? ui('打开设置', 'Open settings') : ui('扫码登录', 'Sign in with QR code')}
        onClick={() => open(account ? 'settings' : 'login')}
      >
        {account?.avatarUrl ? <img alt="" src={account.avatarUrl} /> : <LogIn size={18} />}
        <span>{account?.nickname || ui('扫码登录', 'Sign in with QR code')}</span>
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
        <div className="catalog-tabs" aria-label={ui('音乐库分类', 'Library categories')}>
          {(
            [
              ['library', ui('歌单', 'Playlists'), Library],
              ['liked', ui('我喜欢', 'Liked'), Heart],
              ['recent', ui('最近播放', 'Recently played'), Clock3],
              ['albums', ui('收藏的专辑', 'Saved albums'), Music2],
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
      ? ui('用户 {0}', 'User {0}', p.room.creatorUid)
      : ui('暂未提供', 'Unavailable'))
  return (
    <div className="room-lobby room-tools">
      <section className="room-card room-count">
        <h3>{ui('房间信息', 'Room information')}</h3>
        <dl className="room-facts">
          <div>
            <dt>{ui('在线成员', 'Online members')}</dt>
            <dd>
              <button
                className="room-members-link"
                aria-label={ui('查看房间成员', 'View room members')}
                title={ui('查看房间成员', 'View room members')}
                onClick={() => open('members')}
              >
                {p.onlineCount === null
                  ? ui('查看成员', 'View members')
                  : ui('{0} 人', '{0} online', p.onlineCount)}
              </button>
            </dd>
          </div>
          <div>
            <dt>{ui('房间类型', 'Room type')}</dt>
            <dd>{roomTypeLabel(p.room?.roomBizType)}</dd>
          </div>
          <div>
            <dt>{ui('创建者', 'Created by')}</dt>
            <dd>{creator}</dd>
          </div>
          <div>
            <dt>{ui('音乐标签', 'Music tags')}</dt>
            <dd>{tags?.length ? tags.join(' · ') : ui('暂无标签', 'No tags yet')}</dd>
          </div>
        </dl>
      </section>

      <section className="room-card">
        <h3>{ui('遇见新的听友', 'Meet new listeners')}</h3>
        <p>
          {ui(
            '换一个房间，和新的朋友分享音乐。',
            'Find another room to share music with new listeners.',
          )}
        </p>
        <RoomMatchSong party={p} onChooseSong={onChooseSong} />
        <div className="room-actions">
          <button
            className="secondary"
            disabled={!!p.busy || p.matching || !p.matchSong}
            onClick={() => p.act(ui('重新匹配', 'Find another room'), p.rematchRoom)}
          >
            {ui('重新匹配', 'Find another room')}
          </button>
        </div>
        <p>
          {ui(
            '重新匹配会退出当前房间，寻找新的听友。',
            'Matching again leaves this room to find new listeners.',
          )}
        </p>
      </section>

      <div className="room-actions room-actions-footer">
        <button
          className="secondary"
          onClick={() => p.act(ui('复制邀请链接', 'Copy invitation link'), p.copyInvite)}
        >
          {ui('复制邀请链接', 'Copy invitation link')}
        </button>
        <button className="secondary" onClick={() => open('private')}>
          {ui('私信邀请', 'Invite via message')}
        </button>
        <button className="secondary room-danger room-leave" onClick={leave}>
          {ui('退出房间', 'Leave room')}
        </button>
      </div>
    </div>
  )
}

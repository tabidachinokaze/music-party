import { useState } from 'react'
import {
  AlignLeft,
  Check,
  ChevronRight,
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
  Users,
} from 'lucide-react'
import type { PanelId, PanelStatus } from '../../../shared/panels'
import { roomTypeLabel } from '../../../shared/multiplayer'
import type { useParty } from '../useParty'
import { MusicBrowser } from '../MusicBrowser'
import { BrowserSearch, type BrowserNavigationState } from '../BrowserNavigation'
import { PanelHeader } from './Surface'

const tools = [
  ['lyrics', '歌词', AlignLeft],
  ['controls', '播放调节', SlidersHorizontal],
  ['queue', '播放队列', ListMusic],
  ['search', '搜索', Search],
  ['library', '音乐库', Library],
  ['room', '一起听', Headphones],
  ['chat', '房间聊天', MessageCircle],
  ['private', '私信', Mail],
  ['settings', '设置', Settings2],
] as const
export const panelTitle = (id: PanelId) =>
  tools.find(([key]) => id === key)?.[1] ??
  (
    {
      windows: '外挂窗口',
      login: '扫码登录',
      members: '房间成员',
      match: '匹配房间',
      add: '添加到歌单',
      diagnostics: '观测记录',
      confirm: '确认操作',
      feedback: '播放提示',
    } as Record<string, string>
  )[id] ??
  '曲目详情'

export function WindowDirectory({
  open,
  statuses,
  unread,
  chatUnread,
  account,
}: {
  open(id: PanelId): void
  statuses: Partial<Record<PanelId, PanelStatus>>
  unread: number
  chatUnread: number
  account: ReturnType<typeof useParty>['account']
}) {
  return (
    <nav className="window-directory" aria-label="工具窗口">
      {tools.map(([id, title, Icon]) => {
        const count = id === 'private' ? unread : id === 'chat' ? chatUnread : 0
        return (
          <button
            key={id}
            aria-label={title}
            aria-description={
              [statuses[id]?.visible && '已打开', count > 0 && count + ' 条未读']
                .filter(Boolean)
                .join('，') || undefined
            }
            onClick={() => open(id)}
          >
            <Icon size={18} />
            <span>{title}</span>
            {count > 0 && <small>{Math.min(count, 99)}</small>}
            {statuses[id]?.visible ? (
              <Check size={14} aria-label="已打开" />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
        )
      })}
      <button className="directory-account" onClick={() => open(account ? 'settings' : 'login')}>
        {account?.avatarUrl ? <img alt="" src={account.avatarUrl} /> : <LogIn size={18} />}
        <span>{account?.nickname || '扫码登录'}</span>
        <ChevronRight size={14} />
      </button>
    </nav>
  )
}

export function LibraryPanel({
  search = false,
  ...props
}: Omit<React.ComponentProps<typeof MusicBrowser>, 'view'> & { search?: boolean }) {
  const [view, setView] = useState<'library' | 'liked' | 'albums'>('library')
  const [nav, setNav] = useState<BrowserNavigationState | null>(null)
  const browse = !search && !props.initialSource
  return (
    <div className="catalog">
      {nav && (
        <PanelHeader>
          <BrowserSearch navigation={nav} />
        </PanelHeader>
      )}
      {browse && (
        <div className="catalog-tabs" aria-label="音乐库分类">
          {(
            [
              ['library', '歌单', Library],
              ['liked', '我喜欢', Heart],
              ['albums', '收藏的专辑', Music2],
            ] as const
          ).map(([key, name, Icon]) => (
            <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
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
        onNavigation={setNav}
      />
    </div>
  )
}
export function RoomPanel({
  party: p,
  open,
  leave,
}: {
  party: ReturnType<typeof useParty>
  open(id: PanelId): void
  leave(): void
}) {
  return (
    <div className="room-tools">
      <div className="room-count">
        <Headphones size={22} />
        <div>
          <strong>{p.onlineCount === null ? '正在获取成员' : p.onlineCount + ' 人一起听'}</strong>
          <small>{roomTypeLabel(p.room?.roomBizType)}</small>
        </div>
      </div>
      <div className="room-shortcuts">
        <button className="secondary" onClick={() => open('chat')}>
          <MessageCircle size={15} />
          房间聊天
        </button>
        <button className="secondary" onClick={() => open('queue')}>
          <ListMusic size={15} />
          房间待播
        </button>
      </div>
      <button className="member-summary" onClick={() => open('members')}>
        <span className="avatar-stack">
          {p.members
            .slice(0, 4)
            .map((m) =>
              m.avatar ? (
                <img key={m.uid} src={m.avatar} alt={m.nickname} />
              ) : (
                <i key={m.uid}>{m.nickname.slice(0, 1)}</i>
              ),
            )}
        </span>
        <Users size={16} />
        查看房间成员
        <ChevronRight size={15} />
      </button>
      <div className="room-shortcuts">
        <button
          className="secondary"
          onClick={() =>
            p.act('复制邀请', async () => {
              await p.copyInvite()
              p.setNotice('已复制房间邀请')
            })
          }
        >
          复制邀请
        </button>
        <button className="secondary" onClick={() => open('private')}>
          私信邀请
        </button>
        <button className="secondary" onClick={() => open('match')}>
          重新匹配
        </button>
        <button
          className="secondary"
          disabled={!!p.busy}
          onClick={() => p.act('同步房间', p.observe)}
        >
          立即同步
        </button>
      </div>
      <button className="text-btn" onClick={leave}>
        离开房间
      </button>
    </div>
  )
}

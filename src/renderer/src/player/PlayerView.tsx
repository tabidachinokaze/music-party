import { useEffect, useState } from 'react'
import {
  ArrowRight,
  ChevronDown,
  Expand,
  Maximize,
  Minimize,
  Search,
  Check,
  Copy,
  Headphones,
  Heart,
  LogOut,
  Mail,
  MessageCircle,
  Music2,
  RefreshCw,
  Users,
  ThumbsUp,
  ListPlus,
} from 'lucide-react'
import type { Song } from '../../../shared/types'
import type { useParty } from '../useParty'
import type { useLibrary } from '../useLibrary'
import { AddToPlaylist } from '../AddToPlaylist'
import { Lyrics } from '../Lyrics'
import { MembersDrawer } from './MembersDrawer'
import { roomTypeLabel } from '../../../shared/multiplayer'
import './player-song-actions.css'

export function PlayerView({
  party: p,
  library,
  onLike,
  onTogether,
  onChat,
  unread,
  onInvite,
  onLeave,
  onBrowse,
  expanded,
  fullScreen,
  fullScreenBusy,
  onExpand,
  onCollapse,
  onFullScreen,
}: {
  party: ReturnType<typeof useParty>
  library: ReturnType<typeof useLibrary>
  onLike(): void
  onTogether(): void
  onChat(): void
  unread: number
  onInvite(): void
  onLeave(): void
  onBrowse(): void
  expanded: boolean
  fullScreen: boolean
  fullScreenBusy: boolean
  onExpand(): void
  onCollapse(): void
  onFullScreen(): void
}) {
  const [membersOpen, setMembersOpen] = useState(false)
  const [memberUid, setMemberUid] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [addSong, setAddSong] = useState<{ uid: string; song: Song } | null>(null)
  const uid = p.account?.userId ? String(p.account.userId) : ''
  useEffect(() => setAddSong(null), [uid])
  useEffect(() => {
    setCopied(false)
    setMembersOpen(false)
  }, [p.room?.roomId])
  const connected = p.room && !/失败|重连|暂停|重新确认/.test(p.health)
  const title = p.current?.name || (p.room ? '正在获取房间歌曲…' : '好音乐，一起听。')
  async function copy() {
    await p.act('复制邀请', async () => {
      await p.copyInvite()
      setCopied(true)
    })
  }
  return (
    <section className={`listening-view ${p.room ? 'is-together' : ''}`} aria-label="播放界面">
      <div className="listening-topline">
        <div className="player-view-heading">
          {expanded && (
            <button
              className="player-collapse"
              aria-label="收起播放界面"
              title="收起，返回原页面（Esc）"
              onClick={onCollapse}
            >
              <ChevronDown size={22} />
              <span>收起</span>
            </button>
          )}
          <span className="eyebrow">NOW PLAYING</span>
        </div>
        <div className="player-view-actions">
          {p.room ? (
            <span
              className={`playback-status ${connected ? 'connected' : 'reconnecting'}`}
              title={p.health}
            >
              <span className="dot" />
              {connected ? '与房间同步' : '正在恢复同步'}
            </span>
          ) : (
            <button className="together-launch" onClick={onTogether}>
              <Headphones size={16} />
              一起听
              <ArrowRight size={14} />
            </button>
          )}
          {expanded ? (
            <>
              <button
                className="icon-btn"
                aria-label="搜索并选歌"
                title="搜索并选歌（Ctrl / ⌘ F）"
                onClick={onBrowse}
              >
                <Search size={18} />
              </button>
              <button
                className="player-fullscreen"
                aria-label={fullScreen ? '退出系统全屏' : '进入系统全屏'}
                disabled={fullScreenBusy}
                title={fullScreen ? '退出系统全屏（Esc）' : '进入系统全屏'}
                onClick={onFullScreen}
              >
                {fullScreen ? <Minimize size={18} /> : <Maximize size={18} />}
                <span>{fullScreen ? '退出全屏' : '全屏'}</span>
              </button>
            </>
          ) : (
            <button className="player-fullscreen" aria-label="展开播放界面" onClick={onExpand}>
              <Expand size={18} />
              <span>展开</span>
            </button>
          )}
        </div>
      </div>
      {p.room && (
        <div className="listening-room">
          <div className="room-identity">
            <span className="room-symbol">
              <Headphones size={21} />
            </span>
            <div>
              <h2>{p.onlineCount === null ? '正在获取成员' : `${p.onlineCount} 人一起听`}</h2>
              <span>{roomTypeLabel(p.room.roomBizType)}</span>
            </div>
          </div>
          <div className="room-avatars">
            {p.members.slice(0, 5).map((member) => (
              <button
                className="member"
                key={member.uid}
                title={member.nickname}
                aria-label={`查看成员 ${member.nickname}`}
                onClick={() => {
                  setMemberUid(member.uid)
                  setMembersOpen(true)
                }}
              >
                {member.avatar ? (
                  <img src={member.avatar} alt="" />
                ) : (
                  <span>{member.nickname.slice(0, 1)}</span>
                )}
              </button>
            ))}
            <button
              className="room-members-button"
              aria-label="查看房间成员"
              onClick={() => {
                setMemberUid(null)
                setMembersOpen(true)
              }}
            >
              <Users size={15} />
            </button>
          </div>
          <div className="room-inline-actions">
            <button
              className={`room-song-like ${p.roomReaction.liked ? 'liked' : ''}`}
              aria-label="一起听点赞"
              title="为房间当前歌曲点赞"
              disabled={
                !!p.busy ||
                p.auditioning ||
                p.roomReaction.loading ||
                !p.roomPlayback?.song ||
                p.current?.id !== p.roomPlayback.song.songId
              }
              onClick={() => p.act('一起听点赞', p.likeRoomSong)}
            >
              <ThumbsUp size={16} />
              {p.roomReaction.liked ? '已点赞' : '点赞'}
              <span>{Math.max(p.roomReaction.count, p.roomPlayback?.likeCount || 0)}</span>
            </button>
            <button className="secondary" onClick={onTogether} disabled={!!p.busy}>
              <RefreshCw size={15} />
              重新匹配
            </button>
            <button className="secondary" onClick={onInvite}>
              <Mail size={15} />
              私信邀请
            </button>
            <button className="room-chat-button" onClick={onChat} data-popup-toggle="chat">
              <MessageCircle size={16} />
              房间聊天
              {unread > 0 && <span className="unread-count">{unread > 99 ? '99+' : unread}</span>}
            </button>
          </div>
        </div>
      )}
      <div className="listening-content">
        <div className="album-column">
          <div className="album-artwork-slot">
            <div className={`album-artwork ${p.current?.cover ? 'has-cover' : ''}`}>
              {p.current?.cover ? (
                <img src={p.current.cover} alt={`${p.current.name} 专辑封面`} />
              ) : (
                <div className="record-placeholder">
                  <div className="record-groove groove-one" />
                  <div className="record-groove groove-two" />
                  <div className="record-label">
                    <Music2 size={36} />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="album-details">
            <div className="album-caption">
              <div>
                <h1 title={title}>{title}</h1>
                <p>
                  {p.current?.artist ||
                    (p.room ? '音乐会随房间自动开始' : '从喜欢的歌曲，遇见同频的人')}
                </p>
                {p.current?.album && <small>{p.current.album}</small>}
              </div>
              {p.current && (
                <div className="album-song-actions">
                  <button
                    className={`album-like ${library.likes.has(p.current.id) ? 'liked' : ''}`}
                    aria-label={
                      library.likes.has(p.current.id) ? '取消喜欢封面歌曲' : '喜欢封面歌曲'
                    }
                    disabled={!library.likesReady || library.likeBusy.has(p.current.id)}
                    onClick={onLike}
                  >
                    <Heart
                      size={21}
                      fill={library.likes.has(p.current.id) ? 'currentColor' : 'none'}
                    />
                  </button>
                  <button
                    className="album-like album-playlist-add"
                    aria-label="添加当前歌曲到歌单"
                    title={uid ? '添加当前歌曲到歌单' : '登录后添加当前歌曲到歌单'}
                    disabled={!uid}
                    onClick={() => {
                      if (uid && p.current) setAddSong({ uid, song: { ...p.current } })
                    }}
                  >
                    <ListPlus size={21} />
                  </button>
                </div>
              )}
            </div>
            {!p.current && !p.room && (
              <button className="primary discover-music" onClick={onBrowse}>
                选一首喜欢的歌
                <ArrowRight size={16} />
              </button>
            )}
            {p.room && (
              <div className="session-actions">
                <button className="text-btn" onClick={copy} disabled={!!p.busy}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}复制邀请
                </button>
                <button
                  className="text-btn"
                  title={p.health}
                  disabled={!!p.busy}
                  onClick={() => p.act('同步房间', p.observe)}
                >
                  <RefreshCw size={14} />
                  立即同步
                </button>
                <button className="text-btn" disabled={!!p.busy} onClick={onLeave}>
                  <LogOut size={14} />
                  离开房间
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="lyric-column">
          <div className="lyric-heading">
            <span>歌词</span>
            {p.room && <small>{p.auditioning ? '本机试听 · 房间继续播放' : '跟随房间播放'}</small>}
          </div>
          <Lyrics
            api={p.api}
            songId={p.current?.id}
            position={p.position}
            seekable={!p.room || p.auditioning}
            onSeek={(position) => p.act('跳转歌词', () => p.seek(position))}
          />
        </div>
      </div>
      {membersOpen && p.room && (
        <MembersDrawer
          key={p.room.roomId}
          party={p}
          initialUid={memberUid}
          onClose={() => setMembersOpen(false)}
        />
      )}
      {addSong && uid && addSong.uid === uid && (
        <AddToPlaylist
          key={`${addSong.uid}:${addSong.song.id}`}
          api={p.api}
          uid={addSong.uid}
          song={addSong.song}
          playlists={library.playlists}
          loading={library.loading}
          error={library.error}
          onRefresh={library.refresh}
          onClose={() => setAddSong(null)}
          onAdded={(playlist, alreadyExists) => {
            p.setNotice(
              alreadyExists ? `歌曲已在“${playlist.name}”中` : `已添加到“${playlist.name}”`,
            )
            if (!alreadyExists) library.recordPlaylistAdded(playlist.id)
            setAddSong(null)
          }}
        />
      )}
    </section>
  )
}

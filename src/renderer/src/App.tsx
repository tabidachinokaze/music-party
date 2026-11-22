import { useEffect, useRef, useState } from 'react'
import { Headphones, LoaderCircle, Mail, MessageSquare, X } from 'lucide-react'
import type { MultiInvitation, Song, Conversation } from '../../shared/types'
import type { PanelId, PrivateMode } from '../../shared/panels'
import { invitation } from '../../shared/protocol'
import { useParty } from './useParty'
import { useLibrary } from './useLibrary'
import { useRecentTracks } from './useRecentTracks'
import { useRoomChat } from './useRoomChat'
import { usePrivateMessages } from './usePrivateMessages'
import { useDesktop } from './useDesktop'
import { useAdaptiveNavigation } from './windows/useAdaptiveNavigation'
import { Sidebar, CompanionTabs, Surface, useShellKeyboard } from './windows/AdaptiveShell'
import { PlayerBackground } from './PlayerBackground'
import { WindowDirectory, LibraryPanel, RoomPanel, panelTitle } from './windows/PanelPages'
import {
  PortraitPlayer,
  PlayerFooter,
  ImmersivePlayer,
  PlaybackControls,
  useDisplayedPosition,
} from './player/PortraitPlayer'
import { Lyrics } from './Lyrics'
import { PrivateMessages } from './PrivateMessages'
import { RoomChat } from './RoomChat'
import { Settings } from './Settings'
import { Diagnostics } from './Diagnostics'
import { QueueDrawer } from './player/QueueDrawer'
import { RoomSetup } from './player/RoomSetup'
import { MembersDrawer } from './player/MembersDrawer'
import { AddToPlaylist } from './AddToPlaylist'
import type { MusicSource } from './MusicBrowser'
import { mediaDrafts } from './media-drafts'
import './browser-navigation.css'

export function App() {
  const p = useParty(),
    panels = useAdaptiveNavigation()
  useShellKeyboard(panels)
  const uid = p.account ? String(p.account.userId) : null
  const [privateMode, setPrivateMode] = useState<PrivateMode>('full')
  const [sources, setSources] = useState<Partial<Record<PanelId, MusicSource>>>({})
  const [adding, setAdding] = useState<{
    song: Song
    uid: string
  } | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'unlike'; song: Song } | { kind: 'leave' } | null>(
    null,
  )
  const [confirmError, setConfirmError] = useState('')
  const [confirmPending, setConfirmPending] = useState(false)
  const [retry, setRetry] = useState<{
    scope: string
    label: string
    task: () => Promise<void>
  } | null>(null)
  const playbackScope = [
    uid,
    p.room?.roomId,
    p.roomPlayback?.song?.songBizId,
    p.current?.id,
    p.auditioning,
    p.playing,
  ].join(':')
  function playbackAction(label: string, task: () => Promise<void>) {
    return p.act(label, async () => {
      setRetry(null)
      try {
        await task()
      } catch (error) {
        setRetry({ scope: playbackScope, label, task })
        throw error
      }
    })
  }
  const [feedback, setFeedback] = useState('')
  const [noticeKey, setNoticeKey] = useState('')
  const [loginIntent, setLoginIntent] = useState<PanelId | null>(null)
  const lastNotice = useRef('')
  const chatShown = !!panels.statuses.chat?.visible
  const privateShown = !!panels.statuses.private?.visible
  const chat = useRoomChat(p.api, p.room, p.account, chatShown)
  const library = useLibrary(p.api, uid)
  const recentIds = useRecentTracks(uid, p.playing ? p.current?.id : undefined)
  const inbox = usePrivateMessages(p.api, p.account, privateShown, document)
  const desktop = useDesktop(p, (id) => open(id))
  const position = useDisplayedPosition(p)
  useEffect(() => mediaDrafts.activateAccount(uid), [uid])
  useEffect(() => {
    chat.setVisible(chatShown && !!p.room)
  }, [chatShown, p.room?.roomId])
  useEffect(() => {
    if (!panels.statuses.login?.visible) p.cancelLogin()
  }, [panels.statuses.login?.visible])
  useEffect(() => {
    setAdding(null)
    setConfirm(null)
    setSources({})
    lastNotice.current = ''
    setNoticeKey('')
    for (const id of panels.entries)
      if (id === 'add' || id === 'confirm' || id.startsWith('detail-')) panels.hide(id)
    if (uid) {
      panels.hide('login')
      if (loginIntent && loginIntent !== 'login') open(loginIntent)
      setLoginIntent(null)
    }
  }, [uid])
  useEffect(() => {
    if (p.room && panels.statuses.match?.visible) {
      panels.hide('match')
      panels.show('room')
    }
  }, [p.room?.roomId])
  useEffect(() => {
    if (!p.notice && !p.error) return
    if (
      !p.error ||
      (!panels.statuses.login?.visible &&
        !panels.statuses.match?.visible &&
        (!panels.statuses.room?.visible || !!p.room))
    ) {
      setFeedback(p.error || p.notice)
    }
    const timer = setTimeout(() => {
      p.setNotice('')
      if (!p.error) setFeedback('')
    }, 4500)
    return () => clearTimeout(timer)
  }, [p.notice, p.error])
  useEffect(() => {
    const peer = inbox.notificationInbox[0]
    if (!peer) return
    const key = [peer.uid, peer.time, peer.unread, peer.preview].join(':')
    if (lastNotice.current === key) return
    lastNotice.current = key
    if (privateShown && inbox.selected?.uid === peer.uid) return
    setNoticeKey(key)
  }, [inbox.notificationInbox])
  useEffect(() => {
    if (!noticeKey) return
    const timer = setTimeout(() => setNoticeKey(''), 7000)
    return () => clearTimeout(timer)
  }, [noticeKey])
  function open(id: PanelId) {
    if (!uid && ['room', 'members', 'chat', 'match', 'private', 'add'].includes(id)) {
      login(id)
      return
    }
    if (id === 'login') {
      login('login')
      return
    }
    if (id === 'chat' && !p.room) {
      panels.show('room')
      return
    }
    if (id === 'private') {
      setPrivateMode('full')
      setNoticeKey('')
      panels.show(id)
      return
    }
    panels.show(id)
  }
  function login(intent: PanelId) {
    setLoginIntent(intent)
    panels.show('login')
    if (!p.qr && !p.busy) void p.act('生成登录二维码', p.login)
  }
  function openSource(source: MusicSource) {
    const id = ('detail-' + source.key.replace(':', '-')) as PanelId
    setSources((old) => ({ ...old, [id]: source }))
    panels.show(id)
  }
  function add(song: Song) {
    if (!uid) {
      login('library')
      return
    }
    setAdding({ song, uid })
    panels.show('add')
  }
  function ask(action: NonNullable<typeof confirm>) {
    if (confirmPending) return
    p.setError('')
    setConfirmError('')
    setConfirm(action)
    panels.show('confirm')
  }
  function like(song: Song) {
    if (!uid) {
      login('library')
      return
    }
    if (library.likes.has(song.id)) {
      ask({ kind: 'unlike', song })
      return
    }
    const captured = p.captureRoomSong()
    library
      .toggleLike(song, true)
      .then(async (ok) => {
        if (ok && captured?.songId === song.id) await p.redHeartRoomSong(captured)
      })
      .catch((e) => p.setError(e.message))
  }
  async function join(invite: MultiInvitation) {
    await p.act('加入邀请房间', async () => {
      const preview = await p.api('multiPreview', {
        roomId: invite.roomId,
        inviterUid: invite.inviterUid,
      })
      if (preview.data?.roomStatus !== 'AVAILABLE')
        throw new Error('邀请已失效或房间状态无法确认，请刷新后重试')
      if (p.room?.roomId !== invite.roomId) {
        if (p.room) await p.leaveRoom()
        await p.joinRoom(invitation({ ...invite, role: 'guest' }))
      }
      panels.show('room')
    })
  }
  function reply(peer: Conversation) {
    inbox.select(peer)
    inbox.dismissNotification(peer.uid)
    setPrivateMode('reply')
    setNoticeKey('')
    panels.show('private')
  }
  const onPlay = (song: Song, ids?: string[]) =>
    p.act(p.room ? '推送歌曲' : '播放歌曲', () => p.playSong(song, ids))
  const onAudition = (song: Song) => p.auditionSong(song).catch((e) => p.setError(e.message))
  const onAlbum = (id: string, title: string) =>
    openSource({ key: 'album:' + id, title, albumId: id })
  const onMediaPlay = () => p.pauseForMedia().catch((e) => p.setError(e.message))
  const messageActions = { onSong: onPlay, onAlbum, onAudition, onMediaPlay }
  const browser = {
    api: p.api,
    uid,
    library,
    room: !!p.room,
    currentId: p.current?.id,
    busy: !!p.busy,
    onPlay,
    onLike: like,
    onAudition,
    onSource: openSource,
    onLogin: () => login('library'),
    onSearch: () => open('search'),
    onAdd: add,
  }
  function body(id: PanelId) {
    switch (id) {
      case 'windows':
        return (
          <WindowDirectory
            open={(id) => {
              panels.hide('windows')
              open(id)
            }}
            current={panels.drawer || panels.pane}
            resume={
              panels.layout === 'compact' && !panels.pane && panels.current !== 'library'
                ? {
                    title: sources[panels.current]?.title || panelTitle(panels.current),
                    run: () => {
                      panels.hide('windows')
                      open(panels.current)
                    },
                  }
                : undefined
            }
            account={p.account}
            unread={inbox.unread}
            chatUnread={chat.unread}
          />
        )
      case 'controls':
        return (
          <PlaybackControls
            party={p}
            position={position}
            act={playbackAction}
            retry={
              retry?.scope === playbackScope
                ? { label: retry.label, run: () => playbackAction(retry.label, retry.task) }
                : undefined
            }
            fullScreen={!!desktop.info?.fullScreen}
            toggleFullScreen={() => desktop.setFullScreen('toggle')}
          />
        )
      case 'lyrics':
        if (panels.layout === 'wide')
          return (
            <ImmersivePlayer
              party={p}
              position={position}
              background={desktop.info?.preferences.playerBackground}
              act={playbackAction}
              onClose={() => panels.hide('lyrics')}
              onChat={() => open('chat')}
              onPrivate={() => open('private')}
              onAlbum={onAlbum}
            />
          )
        return (
          <div className="lyric-reader">
            <div className="song-identity">
              <strong>{p.current?.name || '尚未选歌'}</strong>
              <span>{p.current?.artist}</span>
            </div>
            <Lyrics
              api={p.api}
              songId={p.current?.id}
              position={position}
              seekable={!p.room || p.auditioning}
              onSeek={(pos) => p.act('跳转歌词', () => p.seek(pos))}
            />
          </div>
        )
      case 'created':
        return <LibraryPanel key={uid} {...browser} createdOnly />
      case 'recent':
        return recentIds.length ? (
          <LibraryPanel
            key={uid}
            {...browser}
            initialSource={{
              key: 'recent:' + recentIds.join(','),
              title: '最近播放',
              ids: recentIds,
            }}
          />
        ) : (
          <div className="empty">
            <Headphones size={26} />
            <strong>最近还没有播放过歌曲</strong>
            <button className="secondary" onClick={() => open('search')}>
              搜索音乐
            </button>
          </div>
        )
      case 'library':
      case 'liked':
      case 'albums':
      case 'search':
        return (
          <LibraryPanel
            key={uid}
            {...browser}
            search={id === 'search'}
            onSection={open}
            category={id === 'search' ? 'library' : id}
          />
        )
      case 'queue':
        return <QueueDrawer party={p} closing={!panels.statuses.queue?.visible} />
      case 'room':
        if (p.room) return <RoomPanel party={p} open={open} leave={() => ask({ kind: 'leave' })} />
      case 'match':
        return p.account ? (
          <RoomSetup
            party={p}
            onClose={() => panels.hide(id)}
            onJoined={() => {
              if (id === 'match') panels.hide(id)
              panels.show('room')
            }}
            onBrowse={() => open('search')}
          />
        ) : (
          signIn()
        )
      case 'members':
        return p.room ? (
          <MembersDrawer key={p.room.roomId} party={p} onClose={() => panels.hide(id)} />
        ) : (
          <button className="secondary" onClick={() => open('room')}>
            加入一起听
          </button>
        )
      case 'chat':
        return p.room ? (
          <RoomChat
            key={p.room.roomId}
            {...messageActions}
            chat={chat}
            room={p.room}
            uid={uid || ''}
            onlineCount={p.onlineCount}
            members={p.members}
            onLike={() => p.act('一起听点赞', p.likeRoomSong)}
            likeDisabled={
              !!p.busy ||
              p.auditioning ||
              !p.roomPlayback?.song ||
              p.roomReaction.loading ||
              p.roomReaction.bizId !== p.roomPlayback.song.songBizId
            }
          />
        ) : (
          <button className="secondary" onClick={() => open('room')}>
            加入一起听
          </button>
        )
      case 'private':
        if (!p.account) return signIn()
        return (
          <div className="private-window-content">
            {privateMode === 'reply' && (
              <button className="text-btn expand-conversation" onClick={() => open('private')}>
                打开完整对话
              </button>
            )}
            <PrivateMessages
              key={uid}
              compact={privateMode === 'reply'}
              inbox={inbox}
              account={p.account}
              room={p.room}
              api={p.api}
              busy={!!p.busy}
              onJoin={join}
              {...messageActions}
            />
          </div>
        )
      case 'settings':
        return (
          <Settings
            desktop={desktop}
            party={p}
            onLogin={() => login('login')}
            onDiagnostics={() => open('diagnostics')}
          />
        )
      case 'diagnostics':
        return <Diagnostics traces={p.traces} onExport={() => p.act('导出记录', p.exportTrace)} />
      case 'login':
        return (
          <div className="login-dialog">
            <Headphones size={27} />
            <p>使用网易云音乐 App 扫码登录</p>
            {p.qr ? (
              <img alt="网易云登录二维码" src={p.qr.qrimg} />
            ) : (
              <div className="qr-placeholder">{p.busy && <LoaderCircle className="spin" />}</div>
            )}
            <small>
              {p.qr ? p.qrStatus : p.busy ? '正在生成二维码…' : '二维码已过期，请重新生成'}
            </small>
            {!p.qr && !p.busy && (
              <button className="primary" onClick={() => p.act('生成登录二维码', p.login)}>
                重新生成二维码
              </button>
            )}
            {p.error && <p role="alert">{p.error}</p>}
          </div>
        )
      case 'add':
        return adding && uid === adding.uid ? (
          <AddToPlaylist
            key={uid + ':' + adding.song.id}
            api={p.api}
            song={adding.song}
            uid={uid}
            playlists={library.playlists}
            loading={library.loading}
            error={library.error}
            onRefresh={library.refresh}
            onClose={() => panels.hide(id)}
            onAdded={(playlist, exists) => {
              if (!exists) {
                library.recordPlaylistAdded(playlist.id)
              }
              p.setNotice(
                exists ? '歌曲已在“' + playlist.name + '”中' : '已添加到“' + playlist.name + '”',
              )
              panels.hide(id)
              setAdding(null)
            }}
          />
        ) : null
      case 'confirm':
        return (
          confirm && (
            <div
              className="tool-stack"
              role="dialog"
              aria-label={confirm.kind === 'leave' ? '离开多人房间？' : '取消喜欢这首歌？'}
            >
              <p>
                {confirm.kind === 'leave'
                  ? '离开一起听房间？个人队列会保留。'
                  : '将《' + confirm.song.name + '》从我喜欢的音乐中移除？'}
              </p>
              {confirmError && <p role="alert">{confirmError}</p>}
              <div className="row-actions">
                <button
                  className="secondary"
                  disabled={confirmPending}
                  onClick={() => panels.hide(id)}
                >
                  取消
                </button>
                <button
                  className="primary"
                  disabled={
                    confirmPending ||
                    !!p.busy ||
                    (confirm.kind === 'unlike' && library.likeBusy.has(confirm.song.id))
                  }
                  onClick={async () => {
                    if (confirmPending) return
                    setConfirmPending(true)
                    try {
                      if (confirm.kind === 'leave') await p.leaveRoom()
                      else await library.toggleLike(confirm.song, false)
                      panels.hide(id)
                      setConfirm(null)
                    } catch (e) {
                      setConfirmError((e as Error).message)
                    } finally {
                      setConfirmPending(false)
                    }
                  }}
                >
                  {confirm.kind === 'leave' ? '确认离开' : '确认取消喜欢'}
                </button>
              </div>
            </div>
          )
        )
      default:
        return sources[id] ? (
          <LibraryPanel key={uid + ':' + id} {...browser} initialSource={sources[id]} />
        ) : null
    }
  }
  function signIn() {
    return (
      <button className="primary" onClick={() => login('login')}>
        扫码登录
      </button>
    )
  }
  const playerProps = {
    party: p,
    position,
    liked: !!p.current && library.likes.has(p.current.id),
    likeReady: !uid || (!!p.current && library.likesReady && !library.likeBusy.has(p.current.id)),
    onLike: () => p.current && like(p.current),
    onAdd: () => p.current && add(p.current),
    act: playbackAction,
    onControls: () => open('controls'),
  }
  const { layout, pane, drawer, dialog } = panels
  const background = desktop.info?.preferences.playerBackground
  const footerVisible = layout === 'wide' || (layout === 'compact' && !!pane)
  return (
    <div className="adaptive-shell" data-layout={layout} data-has-background={!!background?.image}>
      {background && <PlayerBackground background={background} />}
      {layout === 'wide' && (
        <div className="sidebar-slot" inert={!!dialog || !!drawer || panels.now}>
          <Sidebar
            open={open}
            active={pane}
            nickname={p.account?.nickname}
            avatar={p.account?.avatarUrl}
            unread={inbox.unread}
          />
        </div>
      )}
      {(layout === 'medium' || (layout === 'compact' && !pane)) && (
        <div className="hero-slot" inert={!!dialog}>
          <PortraitPlayer
            {...playerProps}
            layout={layout === 'medium' ? 'medium' : 'compact'}
            background={background}
            onWindows={() => open('windows')}
          />
        </div>
      )}
      {layout === 'medium' && (
        <div className="tabs-slot" inert={!!dialog}>
          <CompanionTabs open={open} active={pane} />
        </div>
      )}
      {drawer && (
        <div className="drawer-scrim" onClick={() => panels.hide(drawer)} aria-hidden="true" />
      )}
      {dialog && (
        <div className="dialog-scrim" onClick={() => panels.hide(dialog)} aria-hidden="true" />
      )}
      {panels.entries.map((id) => {
        const placement =
          id === dialog
            ? 'dialog'
            : id === drawer
              ? 'drawer'
              : id === pane
                ? layout === 'wide'
                  ? panels.now
                    ? 'immersive'
                    : 'page'
                  : 'companion'
                : 'hidden'
        const title =
          sources[id]?.title ||
          (id === 'confirm' && confirm
            ? confirm.kind === 'leave'
              ? '离开多人房间？'
              : '取消喜欢这首歌？'
            : panelTitle(id))
        return (
          <Surface
            key={(uid || 'guest') + ':' + id}
            id={id}
            title={title}
            placement={placement}
            onMenu={
              layout === 'compact' && placement === 'companion' ? () => open('windows') : undefined
            }
            blocked={id !== panels.active}
            close={id === panels.active && panels.backAvailable ? () => panels.back() : undefined}
          >
            {body(id)}
          </Surface>
        )
      })}
      {footerVisible && (
        <div className="footer-slot" inert={!!dialog}>
          <PlayerFooter
            {...playerProps}
            onNow={() =>
              layout === 'compact'
                ? panels.toPlayer()
                : panels.now && drawer
                  ? panels.hide(drawer)
                  : panels.now
                    ? panels.hide('lyrics')
                    : open('lyrics')
            }
            nowOpen={panels.now}
            onQueue={() => (panels.active === 'queue' ? panels.hide('queue') : open('queue'))}
            queueOpen={panels.active === 'queue'}
          />
        </div>
      )}
      {!dialog && noticeKey && inbox.notificationInbox.length > 0 && (
        <aside className="private-toast" data-notice="private" aria-label="新私信">
          <div className="toast-heading">
            <strong role="status">新私信</strong>
            <button className="icon-btn" aria-label="关闭新私信" onClick={() => setNoticeKey('')}>
              <X size={15} />
            </button>
          </div>
          <div className="notice-peers">
            {inbox.notificationInbox.slice(0, 3).map((peer) => (
              <button key={peer.uid} onClick={() => reply(peer)}>
                {peer.avatar ? <img src={peer.avatar} alt="" /> : <Mail />}
                <span>
                  <strong>{peer.nickname}</strong>
                  <small>{peer.preview || '新私信'}</small>
                </span>
                {peer.unread > 1 ? (
                  <small className="notice-count" aria-label={peer.unread + ' 条未读'}>
                    {peer.unread}
                  </small>
                ) : (
                  <MessageSquare size={15} />
                )}
              </button>
            ))}
          </div>
        </aside>
      )}
      {feedback && (
        <aside className="feedback-toast" data-panel="feedback" inert={!!dialog}>
          <span role={p.error ? 'alert' : 'status'}>{feedback}</span>
          {retry?.scope === playbackScope && (
            <button
              onClick={() => {
                setFeedback('')
                open('controls')
              }}
            >
              播放调节
            </button>
          )}
          <button
            className="icon-btn"
            aria-label="关闭播放提示"
            onClick={() => {
              setFeedback('')
              p.setError('')
              p.setNotice('')
            }}
          >
            <X size={14} />
          </button>
        </aside>
      )}
      <audio ref={p.audio} {...p.audioEvents} />
    </div>
  )
}

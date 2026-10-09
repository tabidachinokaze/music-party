import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  ArrowLeft,
  Disc3,
  Headphones,
  Heart,
  Library,
  LogOut,
  Mail,
  Music2,
  Search,
  Settings2,
  X,
  LoaderCircle,
} from 'lucide-react'
import type { MultiInvitation, Song } from '../../shared/types'
import { invitation } from '../../shared/protocol'
import { useParty } from './useParty'
import { useLibrary } from './useLibrary'
import { useRoomChat } from './useRoomChat'
import { usePrivateMessages } from './usePrivateMessages'
import { useDesktop } from './useDesktop'
import { MusicBrowser } from './MusicBrowser'
import { BrowserSearch, type BrowserNavigationState } from './BrowserNavigation'
import './browser-navigation.css'
import { PrivateMessages } from './PrivateMessages'
import { PrivateBubbles, PrivateConversationBubble } from './PrivateBubbles'
import { RoomChat } from './RoomChat'
import { usePlayerChrome } from './usePlayerChrome'
import { PlayerBackground } from './PlayerBackground'
import { Settings } from './Settings'
import { Diagnostics } from './Diagnostics'
import { PlayerView } from './player/PlayerView'
import { PlayerBar } from './player/PlayerBar'
import { QueueDrawer } from './player/QueueDrawer'
import { RoomSetup } from './player/RoomSetup'
import { Overlay } from './player/Overlay'
import { usePresence } from './player/usePresence'
import { mediaDrafts } from './media-drafts'

type Page =
  'player' | 'library' | 'albums' | 'liked' | 'search' | 'private' | 'settings' | 'diagnostics'
export function App() {
  const p = useParty()
  const [tab, setTab] = useState<Page>('player')
  const [expanded, setExpanded] = useState(false)
  const closingPlayer = useRef(false)
  const activePage = expanded ? 'player' : tab
  const [queueOpen, setQueueOpen] = useState(false)
  const queuePresence = usePresence(queueOpen)
  const [setupOpen, setSetupOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [unlikeSong, setUnlikeSong] = useState<Song | null>(null)
  const [unlikeError, setUnlikeError] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const [browserNavigation, setBrowserNavigation] = useState<BrowserNavigationState | null>(null)
  const [messageAlbum, setMessageAlbum] = useState<{
    id: string
    title: string
    account: string | null
  } | null>(null)
  const chromeVisible = usePlayerChrome(
    expanded && activePage === 'player',
    queueOpen ||
      setupOpen ||
      loginOpen ||
      bubbleOpen ||
      !!messageAlbum ||
      !!unlikeSong ||
      confirmEnd,
  )
  const chat = useRoomChat(p.api, p.room, p.account)
  const uid = p.account ? String(p.account.userId) : null
  useEffect(() => mediaDrafts.activateAccount(uid), [uid])
  const library = useLibrary(p.api, uid)
  const inbox = usePrivateMessages(p.api, p.account, activePage === 'private' || bubbleOpen)
  const desktop = useDesktop(p, (page) => (page === 'lyrics' ? showPlayer() : navigate(page)))
  const titles: Record<Page, string> = {
    player: '正在播放',
    library: '我的歌单',
    albums: '收藏的专辑',
    liked: '我喜欢的音乐',
    search: '搜索',
    private: '私信',
    settings: '设置',
    diagnostics: '观测记录',
  }
  const navigation = browserNavigation?.scope === `${uid}:${activePage}` ? browserNavigation : null
  useEffect(() => {
    const accept = (state: import('../../shared/updates').UpdateState) =>
      setUpdateAvailable(['available', 'downloaded'].includes(state.phase))
    const stop = window.together.onUpdate(accept)
    window.together
      .updateState()
      .then(accept)
      .catch(() => {})
    return stop
  }, [])
  useEffect(() => {
    if (!p.notice) return
    const timer = setTimeout(() => p.setNotice(''), 4500)
    return () => clearTimeout(timer)
  }, [p.notice])
  useEffect(() => {
    if (p.account) setLoginOpen(false)
    setBubbleOpen(false)
    setUnlikeSong(null)
    setUnlikeError('')
    setMessageAlbum(null)
  }, [p.account?.userId])
  useEffect(() => {
    if (p.room) {
      showPlayer()
      setSetupOpen(false)
    } else chat.setVisible(false)
  }, [p.room?.roomId])
  useEffect(() => {
    if (chat.visible) setQueueOpen(false)
  }, [chat.visible])
  useEffect(() => {
    if (desktop.info?.fullScreen && !closingPlayer.current) showPlayer()
  }, [desktop.info?.fullScreen])
  useEffect(() => {
    if (!expanded) return
    const previous = document.activeElement as HTMLElement | null
    document.querySelector<HTMLButtonElement>('[aria-label="收起播放界面"]')?.focus()
    return () => {
      if (previous?.isConnected && previous.getClientRects().length) previous.focus()
    }
  }, [expanded])
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key !== 'Escape' ||
      event.repeat ||
      event.isComposing ||
      event.defaultPrevented ||
      document.querySelector('[aria-modal="true"]') ||
      document.querySelector(':popover-open') ||
      queueOpen ||
      chat.visible
    )
      return
    if (desktop.info?.fullScreen) {
      event.preventDefault()
      setFullScreen(false)
    } else if (expanded) {
      event.preventDefault()
      collapsePlayer()
    }
  })
  useEffect(() => {
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [])
  function setFullScreen(value: boolean) {
    desktop.setFullScreen(value)
  }
  function collapsePlayer() {
    if (desktop.info?.fullScreen || desktop.fullScreenBusy) {
      closingPlayer.current = true
      desktop.setFullScreen(false).finally(() => {
        closingPlayer.current = false
      })
    }
    setExpanded(false)
  }
  function navigate(page: Page) {
    if (page === 'search' && tab === 'search') browserNavigation?.onBack?.()
    setBubbleOpen(false)
    collapsePlayer()
    setTab(page)
  }
  function showChat() {
    setQueueOpen(false)
    chat.setVisible(!chat.visible)
  }
  function showQueue() {
    chat.setVisible(false)
    setQueueOpen((value) => !value)
  }
  function showPlayer() {
    closingPlayer.current = false
    setExpanded(true)
  }
  function login() {
    setLoginOpen(true)
    if (!p.qr) p.act('生成登录二维码', p.login)
  }
  function together() {
    if (!p.account) login()
    else {
      p.setError('')
      setSetupOpen(true)
    }
  }
  function onPlay(song: Song, ids?: string[]) {
    p.act(p.room ? '推送歌曲' : '播放歌曲', () => p.playSong(song, ids))
  }
  function onAlbum(id: string, title: string) {
    setMessageAlbum({ id, title, account: uid })
  }
  function onAudition(song: Song) {
    p.auditionSong(song).catch((error) => p.setError(error.message))
  }
  function onMessageMediaPlay() {
    if (p.audio.current) p.pauseForMedia().catch((error) => p.setError(error.message))
  }
  function onLike(song: Song) {
    if (library.likes.has(song.id)) {
      setUnlikeSong(song)
      setUnlikeError('')
    } else {
      const captured = p.captureRoomSong()
      library
        .toggleLike(song, true)
        .then(async (confirmed) => {
          if (confirmed && captured && captured.songId === song.id) {
            try {
              await p.redHeartRoomSong(captured)
            } catch (error: any) {
              p.setNotice(`已收藏歌曲；${error.message || '房间红心动态未确认'}`)
            }
          }
        })
        .catch((error) => p.setError(error.message))
    }
  }
  async function joinPrivateInvite(invite: MultiInvitation) {
    await p.act('加入邀请房间', async () => {
      const preview = await p.api('multiPreview', {
        roomId: invite.roomId,
        inviterUid: invite.inviterUid,
      })
      if (preview.data?.roomStatus !== 'AVAILABLE')
        throw new Error('邀请已失效或房间状态无法确认，请刷新后重试')
      if (p.room?.roomId === invite.roomId) {
        showPlayer()
        return
      }
      if (p.room) await p.leaveRoom()
      await p.joinRoom(invitation({ ...invite, role: 'guest' }))
      showPlayer()
    })
  }
  return (
    <div
      className={`app-shell music-shell ${desktop.info?.preferences.playerBackground.image ? 'has-custom-background' : ''} ${expanded ? 'player-expanded' : ''} ${!chromeVisible ? 'player-chrome-hidden' : ''}`}
    >
      {desktop.info && <PlayerBackground background={desktop.info.preferences.playerBackground} />}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Headphones size={22} />
          </span>
          <div>
            music party<small>好音乐，和你一起</small>
          </div>
        </div>
        <div className="nav-caption">发现音乐</div>
        <button className={`nav ${tab === 'player' ? 'active' : ''}`} onClick={showPlayer}>
          <Music2 size={18} />
          正在播放
          {p.playing && (
            <span className="nav-playing" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </button>
        <button
          className={`nav ${tab === 'search' ? 'active' : ''}`}
          onClick={() => navigate('search')}
        >
          <Search size={18} />
          搜索
        </button>
        <div className="nav-caption library-caption">我的音乐</div>
        <button
          className={`nav ${tab === 'liked' ? 'active' : ''}`}
          onClick={() => navigate('liked')}
        >
          <Heart size={18} />
          我喜欢的音乐
        </button>
        <button
          className={`nav ${tab === 'library' ? 'active' : ''}`}
          onClick={() => navigate('library')}
        >
          <Library size={18} />
          我的歌单
        </button>
        <button
          className={`nav ${tab === 'albums' ? 'active' : ''}`}
          onClick={() => navigate('albums')}
        >
          <Disc3 size={18} />
          收藏的专辑
        </button>
        <div className="sidebar-bottom">
          <button
            className={`nav ${tab === 'private' ? 'active' : ''}`}
            onClick={() => navigate('private')}
          >
            <Mail size={18} />
            私信
            {inbox.unread > 0 && (
              <span className="unread-count">{inbox.unread > 99 ? '99+' : inbox.unread}</span>
            )}
          </button>
          <button
            className={`nav ${tab === 'settings' || tab === 'diagnostics' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            设置{updateAvailable && <span className="unread-count">更新</span>}
          </button>
        </div>
        <div className="account">
          <button
            className="account-profile"
            aria-label={p.account ? '账户设置' : '扫码登录'}
            onClick={p.account ? () => navigate('settings') : login}
          >
            <span className="avatar">
              {p.account?.avatarUrl ? (
                <img src={p.account.avatarUrl} alt="" />
              ) : (
                <Headphones size={18} />
              )}
            </span>
            <span>
              <strong>{p.account?.nickname || '登录网易云'}</strong>
              <small>{p.account ? '让音乐陪伴此刻' : '同步歌单与好友'}</small>
            </span>
          </button>
          {p.account && (
            <button
              aria-label="退出账号"
              className="icon-btn"
              disabled={!!p.busy || !!p.room}
              title={p.room ? '请先离开一起听房间' : '退出账号'}
              onClick={() => p.act('退出账号', p.logout)}
            >
              <LogOut size={15} />
            </button>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="music-header">
          <div className="page-location">
            {activePage !== 'player' && (
              <button
                className="icon-btn"
                aria-label={navigation?.onBack ? '返回' : '返回播放界面'}
                title={navigation?.onBack ? `返回${titles[activePage]}` : '返回播放界面'}
                onClick={navigation?.onBack || showPlayer}
              >
                <ArrowLeft size={17} />
              </button>
            )}
            <span className="page-title" title={navigation?.title || titles[activePage]}>
              {navigation?.title || titles[activePage]}
            </span>
          </div>
          <div className="header-right">
            {p.room && activePage !== 'player' && (
              <button className="header-room-pill" onClick={showPlayer}>
                <Headphones size={14} />
                {p.onlineCount ?? '…'} 人一起听
              </button>
            )}
            {navigation && <BrowserSearch navigation={navigation} />}
            <span className="version">
              <b>{p.version || '…'}</b>
            </span>
          </div>
        </header>
        <main
          className={`music-main ${activePage === 'player' ? 'player-main' : activePage === 'private' ? 'private-main' : ''}`}
        >
          {!setupOpen && !loginOpen && p.error && (
            <div className="alert error" role="alert">
              {p.error}
              <button aria-label="关闭错误提示" onClick={() => p.setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {p.notice && (
            <div className="alert notice player-toast" role="status">
              {p.notice}
              <button aria-label="关闭通知" onClick={() => p.setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {activePage === 'player' && (
            <PlayerView
              expanded={expanded}
              fullScreen={desktop.info?.fullScreen ?? false}
              onExpand={showPlayer}
              onCollapse={collapsePlayer}
              onFullScreen={() => desktop.setFullScreen('toggle')}
              fullScreenBusy={desktop.fullScreenBusy}
              party={p}
              library={library}
              onLike={() => {
                if (p.current) onLike(p.current)
              }}
              onTogether={together}
              onChat={showChat}
              unread={chat.unread}
              onInvite={() => navigate('private')}
              onLeave={() => setConfirmEnd(true)}
              onBrowse={() => navigate('search')}
            />
          )}
          <div className="browser-page" hidden={activePage === 'player'}>
            {tab === 'player' ? null : tab === 'settings' ? (
              <Settings desktop={desktop} party={p} onDiagnostics={() => navigate('diagnostics')} />
            ) : tab === 'diagnostics' ? (
              <Diagnostics traces={p.traces} onExport={() => p.act('导出记录', p.exportTrace)} />
            ) : tab === 'private' ? (
              <PrivateMessages
                inbox={inbox}
                account={p.account}
                room={p.room}
                api={p.api}
                busy={!!p.busy}
                onJoin={joinPrivateInvite}
                onSong={onPlay}
                onAlbum={onAlbum}
                onAudition={onAudition}
                onMediaPlay={onMessageMediaPlay}
              />
            ) : (
              <MusicBrowser
                key={`${uid}:${tab}`}
                api={p.api}
                uid={uid}
                view={tab}
                library={library}
                room={!!p.room}
                currentId={p.current?.id}
                busy={!!p.busy}
                onPlay={onPlay}
                onLike={onLike}
                onAudition={onAudition}
                onNavigation={setBrowserNavigation}
              />
            )}
          </div>
        </main>
      </div>
      <PlayerBar
        party={p}
        library={library}
        expanded={expanded}
        onPlayer={expanded ? collapsePlayer : showPlayer}
        onLike={() => {
          if (p.current) onLike(p.current)
        }}
        onQueue={showQueue}
        queueOpen={queueOpen}
        onChat={showChat}
        chatOpen={chat.visible}
        unread={chat.unread}
      />
      {queuePresence.mounted && (
        <QueueDrawer
          closing={queuePresence.closing}
          party={p}
          onClose={() => setQueueOpen(false)}
        />
      )}
      <RoomChat
        members={p.members}
        chat={chat}
        room={p.room}
        uid={uid || ''}
        onlineCount={p.onlineCount}
        onSong={onPlay}
        onAlbum={onAlbum}
        onAudition={onAudition}
        onMediaPlay={onMessageMediaPlay}
      />
      <PrivateBubbles
        peers={inbox.notificationInbox}
        visible={chromeVisible}
        enabled={activePage !== 'private' && !bubbleOpen && !loginOpen && !setupOpen}
        onOpen={(peer) => {
          inbox.select(peer)
          setBubbleOpen(true)
        }}
        onDismiss={inbox.dismissNotification}
      />
      {bubbleOpen && p.account && (
        <PrivateConversationBubble
          title={`与 ${inbox.selected?.nickname || '好友'} 对话`}
          onClose={() => setBubbleOpen(false)}
        >
          <PrivateMessages
            compact
            inbox={inbox}
            account={p.account}
            room={p.room}
            api={p.api}
            busy={!!p.busy}
            onJoin={joinPrivateInvite}
            onSong={onPlay}
            onAlbum={onAlbum}
            onAudition={onAudition}
            onMediaPlay={onMessageMediaPlay}
          />
        </PrivateConversationBubble>
      )}
      {messageAlbum && messageAlbum.account === uid && (
        <Overlay title={`专辑：${messageAlbum.title}`} wide onClose={() => setMessageAlbum(null)}>
          <MusicBrowser
            key={`${uid}:${messageAlbum.id}`}
            api={p.api}
            uid={uid}
            view="albums"
            initialSource={{
              key: `album:${messageAlbum.id}`,
              title: messageAlbum.title,
              albumId: messageAlbum.id,
            }}
            library={library}
            room={!!p.room}
            currentId={p.current?.id}
            busy={!!p.busy}
            onPlay={onPlay}
            onLike={onLike}
            onAudition={onAudition}
          />
        </Overlay>
      )}
      <audio ref={p.audio} {...p.audioEvents} />
      {setupOpen && (
        <RoomSetup
          party={p}
          onClose={() => setSetupOpen(false)}
          onJoined={() => {
            setSetupOpen(false)
            showPlayer()
          }}
          onBrowse={() => {
            setSetupOpen(false)
            navigate('search')
          }}
        />
      )}
      {loginOpen && !p.account && (
        <Overlay
          title="连接网易云音乐"
          onClose={() => {
            setLoginOpen(false)
            p.setQr(null)
          }}
        >
          <div className="login-dialog">
            <div className="login-symbol">
              <Headphones size={30} />
            </div>
            <p>
              用网易云音乐 App 扫码
              <br />
              把歌单和朋友带到这里
            </p>
            {p.qr ? (
              <img src={p.qr.qrimg} alt="网易云登录二维码" />
            ) : (
              <div className="qr-placeholder">
                <LoaderCircle size={28} className="spin" />
              </div>
            )}
            <small>
              {p.qr ? p.qrStatus : p.busy ? '正在生成二维码…' : '二维码已过期，请重新生成'}
            </small>
            {!p.qr && !p.busy && (
              <button className="secondary" onClick={() => p.act('生成登录二维码', p.login)}>
                重新生成二维码
              </button>
            )}
            {p.error && (
              <div className="alert error" role="alert">
                {p.error}
              </div>
            )}
          </div>
        </Overlay>
      )}
      {unlikeSong && (
        <Overlay title="取消喜欢这首歌？" onClose={() => setUnlikeSong(null)}>
          <p className="overlay-intro">确认将「{unlikeSong.name}」从我喜欢的音乐中移除？</p>
          {unlikeError && (
            <div className="alert error" role="alert">
              {unlikeError}
            </div>
          )}
          <div className="row-actions">
            <button className="secondary" onClick={() => setUnlikeSong(null)}>
              保留喜欢
            </button>
            <button
              className="primary"
              disabled={library.likeBusy.has(unlikeSong.id)}
              onClick={async () => {
                const song = unlikeSong
                try {
                  await library.toggleLike(song, false)
                  setUnlikeSong((current) => (current?.id === song.id ? null : current))
                } catch (error: any) {
                  setUnlikeError(error.message)
                }
              }}
            >
              确认取消喜欢
            </button>
          </div>
        </Overlay>
      )}
      {confirmEnd && (
        <Overlay title="离开多人房间？" onClose={() => setConfirmEnd(false)}>
          <p>退出一起听后，你的个人队列会保留，并暂停播放。</p>
          <div className="row-actions">
            <button className="secondary" onClick={() => setConfirmEnd(false)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!!p.busy}
              onClick={() =>
                p.act('离开房间', async () => {
                  await p.leaveRoom()
                  setConfirmEnd(false)
                })
              }
            >
              确认离开
            </button>
          </div>
        </Overlay>
      )}
    </div>
  )
}

import { useEffect, useEffectEvent, useState } from 'react'
import {
  ArrowLeft,
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
import { PrivateMessages } from './PrivateMessages'
import { RoomChat } from './RoomChat'
import { Settings } from './Settings'
import { Diagnostics } from './Diagnostics'
import { PlayerView } from './player/PlayerView'
import { PlayerBar } from './player/PlayerBar'
import { QueueDrawer } from './player/QueueDrawer'
import { RoomSetup } from './player/RoomSetup'
import { Overlay } from './player/Overlay'

type Page = 'player' | 'library' | 'liked' | 'search' | 'private' | 'settings' | 'diagnostics'
export function App() {
  const p = useParty()
  const [tab, setTab] = useState<Page>('player')
  const [expanded, setExpanded] = useState(false)
  const activePage = expanded ? 'player' : tab
  const [queueOpen, setQueueOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const chat = useRoomChat(p.api, p.room, p.account)
  const uid = p.account ? String(p.account.userId) : null
  const library = useLibrary(p.api, uid)
  const inbox = usePrivateMessages(p.api, p.account, activePage === 'private')
  const desktop = useDesktop(p, (page) => (page === 'lyrics' ? showPlayer() : navigate(page)))
  const titles: Record<Page, string> = {
    player: '正在播放',
    library: '我的歌单',
    liked: '我喜欢的音乐',
    search: '搜索',
    private: '私信',
    settings: '设置',
    diagnostics: '观测记录',
  }
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
    if (desktop.info?.fullScreen) showPlayer()
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
    window.together.setFullScreen(value).catch((error) => p.setError(error.message))
  }
  function collapsePlayer() {
    if (desktop.info?.fullScreen) setFullScreen(false)
    setExpanded(false)
  }
  function navigate(page: Page) {
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
  function onLike(song: Song) {
    library.toggleLike(song).catch((error) => p.setError(error.message))
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
    <div className={`app-shell music-shell ${expanded ? 'player-expanded' : ''}`}>
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
              <button className="icon-btn" aria-label="返回播放界面" onClick={showPlayer}>
                <ArrowLeft size={17} />
              </button>
            )}
            <span>{titles[activePage]}</span>
          </div>
          <div className="header-right">
            {p.room && activePage !== 'player' && (
              <button className="header-room-pill" onClick={showPlayer}>
                <Headphones size={14} />
                {p.onlineCount ?? '…'} 人一起听
              </button>
            )}
            <button className="header-search" onClick={() => navigate('search')}>
              <Search size={15} />
              <span>搜索音乐</span>
              <kbd>Ctrl F</kbd>
            </button>
            <span className="version">
              <b>{p.version || '…'}</b>
            </span>
          </div>
        </header>
        <main className={`music-main ${activePage === 'player' ? 'player-main' : ''}`}>
          {activePage !== 'player' && (
            <div className="heading section-heading">
              <div>
                <h1>{titles[activePage]}</h1>
                {tab === 'private' && <p>一段对话，一场一起听。</p>}
              </div>
            </div>
          )}
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
          {p.busy && (
            <div className="busy" role="status">
              <LoaderCircle size={14} className="spin" />
              {p.busy}…
            </div>
          )}
          {activePage === 'player' && (
            <PlayerView
              expanded={expanded}
              fullScreen={desktop.info?.fullScreen ?? false}
              onExpand={showPlayer}
              onCollapse={collapsePlayer}
              onFullScreen={() => setFullScreen(!desktop.info?.fullScreen)}
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
          <div hidden={activePage === 'player'}>
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
              />
            ) : (
              <MusicBrowser
                api={p.api}
                uid={uid}
                view={tab}
                library={library}
                room={!!p.room}
                currentId={p.current?.id}
                busy={!!p.busy}
                onPlay={onPlay}
                onLike={onLike}
              />
            )}
          </div>
        </main>
      </div>
      <PlayerBar
        party={p}
        library={library}
        onPlayer={showPlayer}
        onLike={() => {
          if (p.current) onLike(p.current)
        }}
        onQueue={showQueue}
        queueOpen={queueOpen}
        onChat={showChat}
        chatOpen={chat.visible}
        unread={chat.unread}
      />
      {queueOpen && <QueueDrawer party={p} onClose={() => setQueueOpen(false)} />}
      <RoomChat chat={chat} room={p.room} uid={uid || ''} onlineCount={p.onlineCount} />
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

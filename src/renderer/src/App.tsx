import { useEffect, useState } from 'react'
import {
  Activity,
  Settings2,
  Mail,
  MessageCircle,
  RefreshCw,
  Heart,
  Library,
  AlignLeft,
  SkipBack,
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  Headphones,
  Link2,
  ListMusic,
  LoaderCircle,
  LogOut,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  SkipForward,
  Users,
  Volume2,
  X,
} from 'lucide-react'
import { useParty } from './useParty'
import { useLibrary } from './useLibrary'
import { MusicBrowser, SongRows } from './MusicBrowser'
import { PersonalQueue } from './PersonalQueue'
import { Lyrics } from './Lyrics'
import { useRoomChat } from './useRoomChat'
import { RoomChat } from './RoomChat'
import { PrivateMessages } from './PrivateMessages'
import { usePrivateMessages } from './usePrivateMessages'
import { useDesktop } from './useDesktop'
import { Settings } from './Settings'
import { invitation } from '../../shared/protocol'
const fmt = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

export function App() {
  const p = useParty()
  const [updateAvailable, setUpdateAvailable] = useState(false)
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
  const chat = useRoomChat(p.api, p.room, p.account)
  const uid = p.account ? String(p.account.userId) : null
  const library = useLibrary(p.api, uid)
  const onPlay = (song: import('../../shared/types').Song, ids?: string[]) => {
    p.act(p.room ? '推送歌曲' : '播放歌曲', () => p.playSong(song, ids))
  }
  const onLike = (song: import('../../shared/types').Song) => {
    library.toggleLike(song).catch((e) => p.setError(e.message))
  }
  const [tab, setTab] = useState<
    | 'room'
    | 'diagnostics'
    | 'library'
    | 'liked'
    | 'search'
    | 'queue'
    | 'lyrics'
    | 'private'
    | 'settings'
  >('room')
  const desktop = useDesktop(p, setTab)
  const inbox = usePrivateMessages(p.api, p.account, tab === 'private')
  const [link, setLink] = useState('')
  const [query, setQuery] = useState('')
  const [selectedTrace, setSelectedTrace] = useState<number | null>(null)
  const [checks, setChecks] = useState<string[]>([])
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [seekPreview, setSeekPreview] = useState<number | null>(null)
  const checklist = [
    '桌面与两个官方账号同房',
    '桌面创建 → 官方 App 加入',
    '官方 App 创建 → 桌面加入',
    '桌面推歌 → 房间队列更新',
    '手机切歌 → 桌面自动跟随',
    '本机暂停 → 房间继续播放',
    '成员离开 → 其余成员继续同听',
  ]
  const titles = {
    room: '一起听',
    diagnostics: '观测记录',
    library: '我的歌单',
    liked: '我喜欢的音乐',
    search: '搜索',
    queue: '个人队列',
    lyrics: '歌词',
    private: '私信',
    settings: '设置',
  }
  async function joinPrivateInvite(invite: import('../../shared/types').MultiInvitation) {
    await p.act('加入邀请房间', async () => {
      const preview = await p.api('multiPreview', {
        roomId: invite.roomId,
        inviterUid: invite.inviterUid,
      })
      if (preview.data?.roomStatus !== 'AVAILABLE')
        throw new Error('邀请已失效或房间状态无法确认，请刷新后重试')
      if (p.room?.roomId === invite.roomId) {
        setTab('room')
        return
      }
      if (p.room) await p.leaveRoom()
      await p.joinRoom(invitation({ ...invite, role: 'guest' }))
      setTab('room')
    })
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Headphones size={22} />
          </span>
          <div>
            music party<small>让音乐，离彼此近一点</small>
          </div>
        </div>
        <div className="nav-caption">你的空间</div>
        <button className={`nav ${tab === 'room' ? 'active' : ''}`} onClick={() => setTab('room')}>
          <Radio size={18} />
          一起听<span className="tag">LAB</span>
        </button>
        <button
          className={`nav ${tab === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setTab('diagnostics')}
        >
          <Activity size={18} />
          观测记录<span className="count">{p.traces.length}</span>
        </button>
        <button
          className={`nav ${chat.visible ? 'active' : ''}`}
          onClick={() => chat.setVisible(!chat.visible)}
        >
          <MessageCircle size={18} />
          房间聊天
          {chat.unread > 0 && (
            <span className="unread-count">{chat.unread > 99 ? '99+' : chat.unread}</span>
          )}
        </button>
        <button
          className={`nav ${tab === 'private' ? 'active' : ''}`}
          onClick={() => setTab('private')}
        >
          <Mail size={18} />
          私信
          {inbox.unread > 0 && (
            <span className="unread-count">{inbox.unread > 99 ? '99+' : inbox.unread}</span>
          )}
        </button>
        <div className="nav-caption library-caption">我的音乐</div>
        <button
          className={`nav ${tab === 'liked' ? 'active' : ''}`}
          onClick={() => setTab('liked')}
        >
          <Heart size={18} />
          我喜欢的音乐
        </button>
        <button
          className={`nav ${tab === 'library' ? 'active' : ''}`}
          onClick={() => setTab('library')}
        >
          <Library size={18} />
          我的歌单
        </button>
        <button
          className={`nav ${tab === 'search' ? 'active' : ''}`}
          onClick={() => setTab('search')}
        >
          <Search size={18} />
          搜索
        </button>
        <button
          className={`nav ${tab === 'queue' ? 'active' : ''}`}
          onClick={() => setTab('queue')}
        >
          <ListMusic size={18} />
          个人队列
        </button>
        <button
          className={`nav ${tab === 'lyrics' ? 'active' : ''}`}
          onClick={() => setTab('lyrics')}
        >
          <AlignLeft size={18} />
          歌词
        </button>
        <button
          className={`nav ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          <Settings2 size={18} />
          设置{updateAvailable && <span className="unread-count">更新</span>}
        </button>
        <div className="sidebar-note">
          <span className="dot" />
          音乐 · 一起听 · 私信
          <p>
            接入网易云官方多人房间。
            <br />
            个人音乐与多人房间相连。
          </p>
        </div>
        <div className="account">
          <span className="avatar">
            <Music2 size={19} />
          </span>
          <div>
            <strong>{p.account?.nickname || '尚未登录'}</strong>
            <small>{p.account ? '网易云音乐账号' : '扫码连接你的音乐'}</small>
          </div>
          {p.account && (
            <button
              aria-label="退出账号"
              disabled={!!p.busy || !!p.room}
              title={p.room ? '请先离开房间' : '退出账号'}
              className="icon-btn"
              onClick={() => p.act('退出', p.logout)}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header>
          <div className="breadcrumb">
            工作空间 <span>/</span> {titles[tab]}
          </div>
          <span className="version">
            MUSIC PARTY <b>{p.version || '…'}</b>
          </span>
        </header>
        <main>
          <div className="heading">
            <div>
              <div className="eyebrow">LISTEN, TOGETHER.</div>
              <h1>
                {tab === 'room'
                  ? '好音乐，一起听。'
                  : tab === 'diagnostics'
                    ? '看见每一次交互。'
                    : titles[tab]}
              </h1>
              <p>
                {tab === 'room'
                  ? '桌面与网易云官方 App，共享同一个多人房间。'
                  : tab === 'diagnostics'
                    ? '保留真实接口响应，确认手机与桌面之间发生了什么。'
                    : p.room
                      ? '正在与好友一起听，选一首歌推送到房间。'
                      : '你的歌单、你的收藏，随时开始播放。'}
              </p>
            </div>
            <span className="phase">
              <span className="dot" />
              开发预览版
            </span>
          </div>
          {p.error && (
            <div className="alert error" role="alert">
              {p.error}
              <button aria-label="关闭错误提示" onClick={() => p.setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {p.notice && (
            <div className="alert notice" role="status">
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
          {tab === 'room' ? (
            <>
              {!p.account ? (
                <section className="login-panel">
                  <div className="login-illustration">
                    <Headphones size={64} />
                    <span className="orbit orbit-one" />
                    <span className="orbit orbit-two" />
                  </div>
                  <div className="login-copy">
                    <span className="eyebrow">01 / 连接账号</span>
                    <h2>把你的音乐带过来</h2>
                    <p>
                      使用网易云音乐 App 扫码登录，
                      <br />
                      与多位好友在官方房间相聚。
                    </p>
                    <button
                      className="primary"
                      disabled={!!p.busy || !!p.qr}
                      onClick={() => p.act('生成二维码', p.login)}
                    >
                      {p.qr ? '等待手机确认' : '扫码登录'}
                      <ArrowRight size={16} />
                    </button>
                    <small>{p.session}</small>
                  </div>
                  {p.qr && (
                    <div className="qr">
                      <img src={p.qr.qrimg} alt="网易云登录二维码" />
                      <span>{p.qrStatus}</span>
                      <button className="text-btn" onClick={() => p.setQr(null)}>
                        关闭二维码
                      </button>
                    </div>
                  )}
                </section>
              ) : (
                <section className="connect-grid">
                  <div className="create-panel">
                    <div className="section-icon">
                      <Radio size={24} />
                    </div>
                    <h2>{p.room ? '你的房间已就绪' : '开启一场音乐派对'}</h2>
                    <p>
                      {p.room
                        ? '复制官方多人链接，让好友加入。'
                        : p.current
                          ? `以「${p.current.name}」开启多人房间。`
                          : '先搜索并播放一首歌曲，再邀请好友一起听。'}
                    </p>
                    <button
                      className="primary"
                      disabled={!!p.busy || !!p.room || !p.current}
                      title={!p.current ? '请先搜索并播放一首歌曲' : '使用当前歌曲创建官方多人房间'}
                      onClick={() => p.act('创建房间', p.createRoom)}
                    >
                      <Plus size={17} />
                      创建多人一起听
                    </button>
                  </div>
                  <div className="join-panel">
                    <Link2 size={22} />
                    <h2>朋友在等你？</h2>
                    <p>粘贴官方多人一起听链接（multishare）。</p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        p.act('加入房间', () => p.joinRoom(link))
                      }}
                    >
                      <input
                        aria-label="一起听邀请链接"
                        placeholder="粘贴官方多人邀请链接"
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        disabled={!!p.room}
                      />
                      <button className="secondary" disabled={!!p.busy || !!p.room || !link.trim()}>
                        加入房间
                        <ArrowRight size={16} />
                      </button>
                    </form>
                    <div className="row-actions">
                      <button
                        className="text-btn"
                        disabled={!!p.busy || !link.trim()}
                        onClick={() => p.act('读取邀请', () => p.inspectInvite(link))}
                      >
                        预览邀请
                      </button>
                      <button
                        className="text-btn"
                        disabled={!!p.busy || !!p.room}
                        onClick={() => p.act('恢复房间', p.restoreRoom)}
                      >
                        恢复当前房间
                      </button>
                    </div>
                  </div>
                </section>
              )}
              {p.preview && !p.room && (
                <section className="room-panel">
                  <span className="room-label">
                    官方多人邀请 ·{' '}
                    {p.preview.roomStatus === 'EXPIRED'
                      ? '已过期'
                      : p.preview.roomStatus || '状态未知'}
                  </span>
                  <h2>{p.preview.inviter?.nickname || '好友'}邀请你一起听</h2>
                  <p>{p.preview.songData?.name || '暂无歌曲信息'}</p>
                  <small>邀请预览不代表已加入房间。</small>
                </section>
              )}
              {p.room && (
                <section className="room-panel">
                  <div className="room-top">
                    <div>
                      <span className="room-label">
                        <span className="dot" />
                        官方多人房间 · {p.room.role === 'host' ? '由你创建' : '已加入'}
                      </span>
                      <h2>
                        <Users size={18} />{' '}
                        {p.onlineCount === null ? '正在获取成员' : `${p.onlineCount} 人一起听`}
                      </h2>
                    </div>
                    <div className="row-actions">
                      <button className="secondary" onClick={() => setTab('private')}>
                        <Mail size={15} />
                        私信邀请
                      </button>
                      <button
                        className="secondary"
                        disabled={!!p.busy}
                        onClick={() => p.act('复制链接', p.copyInvite)}
                      >
                        <Copy size={15} />
                        复制多人邀请
                      </button>
                      <button
                        className="text-btn danger"
                        disabled={!!p.busy}
                        onClick={() => setConfirmEnd(true)}
                      >
                        离开房间
                      </button>
                    </div>
                  </div>
                  <div className="members">
                    {p.members.map((m) => (
                      <div key={m.uid} className="member">
                        {m.avatar ? (
                          <img src={m.avatar} alt="" />
                        ) : (
                          <span className="avatar">
                            <Headphones size={16} />
                          </span>
                        )}
                        <span>{m.nickname}</span>
                      </div>
                    ))}
                  </div>
                  <div className="members-meta">
                    <span>{p.membersStatus}</span>
                    {p.onlineCount !== null && p.members.length < p.onlineCount && (
                      <span>已显示 {p.members.length} 位成员</span>
                    )}
                    <button
                      className="text-btn"
                      onClick={() => p.act('刷新成员', p.refreshMembers)}
                    >
                      <RefreshCw size={13} />
                      刷新成员
                    </button>
                    <button className="text-btn" onClick={() => chat.setVisible(true)}>
                      <MessageCircle size={14} />
                      打开聊天
                    </button>
                  </div>
                  <div className="room-bottom">
                    <span>{p.health}</span>
                    <button
                      className="text-btn"
                      disabled={!!p.busy}
                      onClick={() => p.act('同步房间', p.observe)}
                    >
                      立即同步
                    </button>
                    <button
                      className="secondary"
                      disabled={!!p.busy || !p.roomPlayback?.song}
                      onClick={() => p.act('请求切歌', p.nextSong)}
                    >
                      <SkipForward size={15} />
                      请求下一首
                    </button>
                  </div>
                  <div className="queue-summary">
                    <ListMusic size={16} />
                    <span>
                      {p.roomPlayback
                        ? `接下来 · ${p.roomPlayback.waitSongCount} 首`
                        : '正在读取房间歌曲…'}
                    </span>
                    <small>点歌顺序与切歌权限由官方房间决定</small>
                  </div>
                  <div className="queue-chips">
                    {p.roomPlayback?.nextSongs.map((song) => (
                      <span className="queue-item" key={song.songBizId}>
                        {song.songId}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              <section className="music-section">
                <div className="section-title">
                  <div>
                    <h2>选一首，试试看</h2>
                    <p>
                      {p.room
                        ? '点击歌曲，推送到官方多人房间队列。'
                        : '先确认本地播放，再测试房间控制。'}
                    </p>
                  </div>
                  <form
                    className="search"
                    onSubmit={(e) => {
                      e.preventDefault()
                      p.act('搜索歌曲', () => p.search(query))
                    }}
                  >
                    <Search size={17} />
                    <input
                      aria-label="搜索歌曲或 ID"
                      placeholder="搜索歌曲 / 粘贴歌曲 ID"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button aria-label="搜索" disabled={!!p.busy || !query.trim()}>
                      <ArrowRight size={17} />
                    </button>
                  </form>
                </div>
                {p.songs.length ? (
                  <SongRows
                    songs={p.songs}
                    room={!!p.room}
                    currentId={p.current?.id}
                    busy={!!p.busy}
                    library={library}
                    onPlay={onPlay}
                    onLike={onLike}
                  />
                ) : (
                  <div className="empty">
                    <Music2 size={27} />
                    <strong>{p.searched ? '没有找到匹配的歌曲' : '今天，从哪首歌开始？'}</strong>
                    <span>搜索歌曲，或直接输入网易云歌曲 ID</span>
                  </div>
                )}
              </section>
            </>
          ) : tab === 'diagnostics' ? (
            <div className="diagnostics">
              <div className="section-title">
                <h2>
                  请求与响应 <span className="muted">{p.traces.length} / 300</span>
                </h2>
                <button className="secondary" onClick={() => p.act('导出记录', p.exportTrace)}>
                  <Download size={15} />
                  导出记录
                </button>
              </div>
              <p className="muted">
                凭据和链接已隐藏。导出保留用户、房间和歌曲 ID。勾选项仅为本次人工观测记录。
              </p>
              <div className="checklist">
                {checklist.map((label) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={checks.includes(label)}
                      onChange={(e) =>
                        setChecks(
                          e.target.checked
                            ? [...checks, label]
                            : checks.filter((item) => item !== label),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="trace-layout">
                <div className="trace-list">
                  {p.traces.map((trace) => (
                    <button
                      key={trace.id}
                      className={selectedTrace === trace.id ? 'selected' : ''}
                      onClick={() => setSelectedTrace(trace.id)}
                    >
                      <span className={trace.ok ? 'ok' : 'bad'}>
                        {trace.ok ? <CheckCircle2 size={15} /> : <X size={15} />}
                      </span>
                      <strong>{trace.method}</strong>
                      <span>{trace.duration}ms</span>
                      <small>{new Date(trace.time).toLocaleTimeString()}</small>
                    </button>
                  ))}
                </div>
                <pre>
                  {JSON.stringify(
                    p.traces.find((trace) => trace.id === selectedTrace) ||
                      p.traces[0] || { 提示: '执行一次操作后，这里显示响应' },
                    null,
                    2,
                  )}
                </pre>
              </div>
            </div>
          ) : tab === 'settings' ? (
            <Settings desktop={desktop} party={p} />
          ) : tab === 'private' ? (
            <PrivateMessages
              inbox={inbox}
              account={p.account}
              room={p.room}
              api={p.api}
              busy={!!p.busy}
              onJoin={joinPrivateInvite}
            />
          ) : tab === 'queue' ? (
            <PersonalQueue
              api={p.api}
              ids={p.personalQueue}
              currentIndex={p.personalIndex}
              room={!!p.room}
              mode={p.repeatMode}
              onMode={p.changeRepeat}
              onPlay={(index) => {
                p.act('播放队列', () => p.playQueueIndex(index))
              }}
              onClear={p.clearPersonalQueue}
            />
          ) : tab === 'lyrics' ? (
            <Lyrics api={p.api} songId={p.current?.id} position={p.position} />
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
          <footer className="page-footer">
            <Headphones size={13} /> 一起听的每一步，都从真实连接开始。
            <span>Music Party · 协议实验室</span>
          </footer>
        </main>
      </div>
      <div className="player">
        <div className="now-playing">
          <div className="cover">
            {p.current?.cover ? (
              <img src={p.current.cover} alt="当前歌曲封面" />
            ) : (
              <Music2 size={22} />
            )}
          </div>
          <div>
            <strong>{p.current?.name || '还没有正在播放的音乐'}</strong>
            <small>{p.current?.artist || '找一首喜欢的歌，开始吧'}</small>
          </div>
        </div>
        <div className="playback">
          <div className="transport-controls">
            <button
              className="icon-btn"
              aria-label="上一首"
              disabled={!!p.room || !p.personalQueue.length || !!p.busy}
              onClick={() => p.act('上一首', () => p.nextLocal(-1))}
            >
              <SkipBack size={18} />
            </button>
            <button
              className="play-button"
              aria-label={p.playing ? (p.room ? '本机暂停' : '暂停') : p.room ? '恢复同听' : '播放'}
              disabled={!p.current || !!p.busy}
              onClick={() => p.act('控制播放', p.togglePlay)}
            >
              {p.playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              className="icon-btn"
              aria-label="下一首"
              disabled={!p.current || !!p.busy}
              onClick={() => p.act('下一首', () => (p.room ? p.nextSong() : p.nextLocal(1)))}
            >
              <SkipForward size={18} />
            </button>
          </div>
          <div className="progress">
            <span>{fmt(seekPreview ?? p.position)}</span>
            <input
              aria-label="播放进度"
              type="range"
              min={0}
              max={p.current?.duration || 1}
              value={seekPreview ?? p.position}
              disabled={!p.current || !!p.busy || !!p.room}
              onChange={(e) => setSeekPreview(Number(e.target.value))}
              onPointerUp={(e) => {
                const value = Number(e.currentTarget.value)
                setSeekPreview(null)
                p.act('跳转进度', () => p.seek(value))
              }}
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                  const value = Number(e.currentTarget.value)
                  setSeekPreview(null)
                  p.act('跳转进度', () => p.seek(value))
                }
              }}
            />
            <span>{fmt(p.current?.duration || 0)}</span>
          </div>
        </div>
        <div className="player-right">
          {p.current && (
            <button
              className={`icon-btn ${library.likes.has(p.current.id) ? 'liked' : ''}`}
              aria-label={library.likes.has(p.current.id) ? '取消喜欢当前歌曲' : '喜欢当前歌曲'}
              disabled={!library.likesReady || library.likeBusy.has(p.current.id)}
              onClick={() => onLike(p.current!)}
            >
              <Heart size={16} fill={library.likes.has(p.current.id) ? 'currentColor' : 'none'} />
            </button>
          )}
          <span className={`mode ${p.room ? 'together' : ''}`}>
            {p.room ? '多人同听 · 暂停仅本机' : '个人播放'}
          </span>
          <Volume2 size={17} />
          <input
            aria-label="音量"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={p.volume}
            onChange={(e) => p.setVolume(Number(e.target.value))}
          />
        </div>
      </div>
      <RoomChat chat={chat} room={p.room} uid={uid || ''} onlineCount={p.onlineCount} />
      <audio ref={p.audio} {...p.audioEvents} />
      {confirmEnd && (
        <div className="modal-backdrop">
          <div role="dialog" aria-modal="true" aria-labelledby="end-title" className="modal">
            <h2 id="end-title">离开多人房间？</h2>
            <p>退出你在官方多人房间中的会话。本机播放将停止。</p>
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
          </div>
        </div>
      )}
    </div>
  )
}

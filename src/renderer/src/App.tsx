import { ui } from '../../shared/ui-language'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Headphones,
  LoaderCircle,
  MessageSquare,
  ScanLine,
  RotateCcw,
  X,
} from 'lucide-react'
import { conversationName, conversationPreview } from '../../shared/private-messages'
import type { MultiInvitation, Song, Conversation } from '../../shared/types'
import type { PanelId } from '../../shared/panels'
import { invitation } from '../../shared/protocol'
import { useParty } from './useParty'
import { useLibrary } from './useLibrary'
import { useRecentTracks } from './useRecentTracks'
import { useRoomChat } from './useRoomChat'
import { usePrivateMessages } from './usePrivateMessages'
import { useDesktop } from './useDesktop'
import { useAdaptiveNavigation, usePlaybackColumns } from './windows/useAdaptiveNavigation'
import { UserAvatar } from './design/UserAvatar'
import { IconButton, UnreadBadge } from './design/Primitives'
import { panelOf, settingsLabels, stepKey, type Step } from './windows/navigation-history'
import {
  WindowButtons,
  WindowChrome,
  Sidebar,
  Surface,
  usePanelEntrance,
  useShellKeyboard,
} from './windows/AdaptiveShell'
import {
  PlayerBackground,
  usePlayerBackgroundSurfaces,
  type PlayerBackgroundValues,
} from './PlayerBackground'
import { WindowDirectory, LibraryPanel, RoomPanel, panelTitle } from './windows/PanelPages'
import {
  PlayerFooter,
  ImmersivePlayer,
  PlaybackControls,
  useDisplayedPosition,
} from './player/PortraitPlayer'
import { useTrackLyrics } from './Lyrics'
import { PrivateMessages } from './PrivateMessages'
import { RoomChat } from './RoomChat'
import { Settings } from './Settings'
import { Diagnostics } from './Diagnostics'
import { QueueDrawer, queueTitle } from './player/QueueDrawer'
import { RoomSetup } from './player/RoomSetup'
import { MatchSongPicker } from './player/MatchSongPicker'
import { MembersDrawer } from './player/MembersDrawer'
import { AddToPlaylist } from './AddToPlaylist'
import type { MusicSource } from './MusicBrowser'
import { mediaDrafts } from './media-drafts'
import './browser-navigation.css'

export function App() {
  const p = useParty(),
    panels = useAdaptiveNavigation(!!p.current, p.room?.roomId ?? null)
  useShellKeyboard(panels)
  const shell = usePanelEntrance(panels.drawer, panels.dialog)
  const uid = p.account ? String(p.account.userId) : null
  const previousUid = useRef(uid)
  const [sources, setSources] = useState<Partial<Record<PanelId, MusicSource>>>({})
  const [adding, setAdding] = useState<{
    song: Song
    uid: string
  } | null>(null)
  const [confirm, setConfirm] = useState<
    | { kind: 'unlike'; song: Song }
    | { kind: 'leave' }
    | { kind: 'leaveAvailable'; roomId: string }
    | null
  >(null)
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
  const selectRoutePeer = useEffectEvent(() => {
    if (uid && uid === previousUid.current && privateShown) {
      const peer = panels.peer
      inbox.select(inbox.conversations.find((contact) => contact.uid === peer?.uid) ?? peer)
    }
  })
  useLayoutEffect(() => selectRoutePeer(), [uid, privateShown, panels.peer])
  const desktop = useDesktop(p, (id) => open(id))
  const position = useDisplayedPosition(p)
  const [backgroundDraft, setBackgroundDraft] = useState<PlayerBackgroundValues | null>(null)
  const background = backgroundDraft ?? desktop.info?.preferences.playerBackground
  usePlayerBackgroundSurfaces(background)
  const [reading, setReading] = useState<'auto' | 'cover' | 'lyrics'>('auto')
  const columns = usePlaybackColumns()
  const lyrics = useTrackLyrics(
    p.api,
    panels.entries.includes('lyrics') ? p.current?.id : undefined,
  )
  const hasLyrics = ['ready', 'loading', 'failed'].includes(lyrics.status)
  const lyricsUnavailable = lyrics.status === 'missing' || lyrics.status === 'instrumental'
  const showLyrics =
    !lyricsUnavailable && (reading === 'lyrics' || (reading === 'auto' && columns && hasLyrics))
  const focus = showLyrics ? (columns && hasLyrics ? 'both' : 'lyrics') : 'cover'

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
    if (uid !== previousUid.current) {
      panels.resetSession()
      previousUid.current = uid
    }
    lastNotice.current = ''
    setNoticeKey('')
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
  const refreshRoomOverview = useEffectEvent(() => {
    void p.refreshRoomOverview()
  })
  useEffect(() => {
    if (!uid || p.matching || (panels.active !== 'room' && panels.active !== 'match')) return
    refreshRoomOverview()
    if (p.room) return
    // The same account can enter or leave on the phone while this lobby stays open.
    const timer = window.setInterval(refreshRoomOverview, 10000)
    return () => window.clearInterval(timer)
  }, [uid, panels.active, p.room?.roomId, p.matching])
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
    if (id === 'lyrics') setReading('lyrics')
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
      setNoticeKey('')
      if (panels.pane === 'private' && panels.drawer && panels.peer) {
        panels.detail({ panel: 'private', peer: panels.peer })
        return
      }
    }
    panels.show(id)
    if (id === 'search') {
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>(
            '.surface-page[data-panel="search"]:not([inert]) input[type="search"]',
          )
          ?.focus(),
      )
    }
  }
  function login(intent: PanelId) {
    setLoginIntent(intent)
    panels.show('login')
    if (!p.qr && !p.busy) void p.act(ui('生成登录二维码', 'Generate sign-in QR code'), p.login)
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
    await p.act(ui('加入邀请房间', 'Join invited room'), async () => {
      const preview = await p.api('multiPreview', {
        roomId: invite.roomId,
        inviterUid: invite.inviterUid,
      })
      if (preview.data?.roomStatus !== 'AVAILABLE')
        throw new Error(
          ui(
            '邀请已失效或房间状态无法确认，请刷新后重试',
            'The invitation expired or the room could not be verified. Try again.',
          ),
        )
      if (p.room?.roomId !== invite.roomId) {
        if (p.room) await p.leaveRoom(false)
        await p.joinRoom(invitation({ ...invite, role: 'guest' }))
      }
      panels.show('room')
    })
  }
  function reply(peer: Conversation) {
    inbox.dismissNotification(peer.uid)
    setNoticeKey('')
    panels.reply(peer)
  }
  const onPlay = (song: Song, ids?: string[]) =>
    p.act(p.room ? ui('推送歌曲', 'Recommend track') : ui('播放歌曲', 'Play track'), () =>
      p.playSong(song, ids),
    )
  const onAudition = (song: Song) => p.auditionSong(song).catch((e) => p.setError(e.message))
  const onAlbum = (id: string, title: string) =>
    openSource({ key: 'album:' + id, title, albumId: id })
  const onArtist = (id: string, title: string) =>
    openSource({ key: 'artist:' + id, title, artistId: id })
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
            account={p.account}
            unread={inbox.unread}
            chatUnread={chat.unread}
          />
        )
      case 'controls':
        return (
          <PlaybackControls
            onArtist={onArtist}
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
        return (
          <ImmersivePlayer
            party={p}
            position={position}
            act={playbackAction}
            onAlbum={onAlbum}
            onArtist={onArtist}
            vinyl={panels.layout === 'wide' && focus === 'both'}
            focus={focus}
            lyrics={lyrics}
            onRead={() => setReading('lyrics')}
          />
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
              title: ui('最近播放', 'Recently played'),
              ids: recentIds,
            }}
          />
        ) : (
          <div className="empty">
            <Headphones size={26} />
            <strong>{ui('最近还没有播放过歌曲', 'No recently played tracks')}</strong>
            <button className="secondary" onClick={() => open('search')}>
              {ui('搜索音乐', 'Search music')}
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
            recentIds={id === 'library' ? recentIds : undefined}
            compactHome={panels.layout === 'compact'}
            search={id === 'search'}
            onSection={open}
            category={id === 'search' ? 'library' : id}
          />
        )
      case 'queue':
        return (
          <QueueDrawer
            party={p}
            closing={!panels.statuses.queue?.visible}
            inTrail={panels.path.includes('queue')}
            onArtist={onArtist}
          />
        )
      case 'room':
      case 'match':
        if (p.room)
          return (
            <RoomPanel
              party={p}
              open={open}
              onChooseSong={() => open('match-song')}
              leave={() => ask({ kind: 'leave' })}
            />
          )
        return p.account ? (
          <RoomSetup
            party={p}
            onClose={() => panels.hide(id)}
            onJoined={() => {
              if (id === 'match') panels.hide(id)
              panels.show('room')
            }}
            onChooseSong={() => open('match-song')}
            onLeaveAvailable={() => {
              if (p.availableRoom) ask({ kind: 'leaveAvailable', roomId: p.availableRoom.roomId })
            }}
          />
        ) : (
          signIn()
        )
      case 'match-song':
        return uid ? (
          <MatchSongPicker
            key={uid}
            uid={uid}
            api={p.api}
            likes={library.likesReady ? library.likes : null}
            selected={p.matchSong}
            onSelect={(song) => {
              p.setMatchSong(song)
              panels.hide(id)
            }}
          />
        ) : (
          signIn()
        )
      case 'members':
        return p.room ? (
          <MembersDrawer
            key={p.room.roomId}
            party={p}
            selected={panels.member}
            onArtist={onArtist}
            onSelect={(member) =>
              panels.detail({ panel: 'members', roomId: p.room!.roomId, member })
            }
            onClose={() => panels.hide(id)}
          />
        ) : (
          <button className="secondary" onClick={() => open('room')}>
            {ui('加入一起听', 'Join Listen Together')}
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
            members={p.members}
          />
        ) : (
          <button className="secondary" onClick={() => open('room')}>
            {ui('加入一起听', 'Join Listen Together')}
          </button>
        )
      case 'private':
        if (!p.account) return signIn()
        return (
          <div className="private-window-content">
            <PrivateMessages
              key={uid}
              compact={panels.quickReply}
              onList={() => panels.show('private')}
              onExpand={() => panels.peer && panels.detail({ panel: 'private', peer: panels.peer })}
              onSelect={(peer) => panels.detail({ panel: 'private', peer })}
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
            section={panels.section}
            onSection={(section) => panels.detail({ panel: 'settings', section })}
            onBackgroundPreview={setBackgroundDraft}
            party={p}
            onLogin={() => login('login')}
            onDiagnostics={() => open('diagnostics')}
          />
        )
      case 'diagnostics':
        return (
          <Diagnostics
            traces={p.traces}
            onExport={() => p.act(ui('导出记录', 'Export log'), p.exportTrace)}
          />
        )
      case 'login':
        return (
          <div className="login-dialog">
            <p className="mp-qr-instruction">
              <ScanLine size={17} />
              {ui(
                '使用网易云音乐 App 扫码登录',
                'Scan with the NetEase Cloud Music app to sign in',
              )}
            </p>
            {p.qr && !['scanned', 'confirmed'].includes(p.qrStatus.phase) ? (
              <img alt={ui('网易云登录二维码', 'NetEase sign-in QR code')} src={p.qr.qrimg} />
            ) : (
              <div className="qr-placeholder" data-phase={p.qrStatus.phase}>
                {p.qrStatus.phase === 'scanned' || p.qrStatus.phase === 'confirmed' ? (
                  <CheckCircle2 size={40} />
                ) : p.busy ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <RotateCcw size={30} />
                )}
              </div>
            )}
            <small className="mp-qr-status" role="status">
              {p.qrStatus.phase === 'scanned'
                ? ui('已扫码，请在手机上确认登录', 'Code scanned. Confirm sign-in on your phone.')
                : p.qrStatus.phase === 'confirmed'
                  ? ui('正在读取登录账号…', 'Loading account…')
                  : p.qrStatus.phase === 'expired'
                    ? ui('二维码已过期', 'QR code expired')
                    : p.qrStatus.phase === 'error'
                      ? p.qrStatus.message
                      : p.qr
                        ? ui('等待扫码', 'Waiting for scan')
                        : p.busy
                          ? ui('正在生成二维码…', 'Generating QR code…')
                          : ''}
            </small>
            {!p.qr && !p.busy && p.qrStatus.phase !== 'confirmed' && (
              <button
                className="primary"
                onClick={() => p.act(ui('生成登录二维码', 'Generate sign-in QR code'), p.login)}
              >
                {ui('重新生成二维码', 'Generate a new code')}
              </button>
            )}
            {p.error && <p role="alert">{p.error}</p>}
          </div>
        )
      case 'add':
        return adding && uid === adding.uid ? (
          <AddToPlaylist
            key={uid + ':' + adding.song.id}
            addSongToPlaylist={library.addSongToPlaylist}
            song={adding.song}
            uid={uid}
            playlists={library.playlists}
            loading={library.loading}
            error={library.error}
            onRefresh={library.refresh}
            onComplete={(message) => {
              p.setNotice(message)
              panels.hide(id)
              setAdding(null)
            }}
          />
        ) : null
      case 'confirm':
        return (
          confirm && (
            <div className="mp-confirm">
              <p>
                {confirm.kind === 'leave'
                  ? ui(
                      '离开一起听房间？房间的已播、当前和待播歌曲将成为你的个人队列。',
                      'Leave this room? Its history, current song, and upcoming songs will become your personal queue.',
                    )
                  : confirm.kind === 'leaveAvailable'
                    ? ui(
                        '让账号退出这个房间？本机将保留当前播放和队列。',
                        'Leave this room? Playback and the queue on this device will be preserved.',
                      )
                    : ui(
                        '将《{0}》从我喜欢的音乐中移除？',
                        'Remove “{0}” from Liked Songs?',
                        confirm.song.name,
                      )}
              </p>
              {confirmError && <p role="alert">{confirmError}</p>}
              <div className="row-actions">
                <button
                  className="secondary"
                  disabled={confirmPending}
                  onClick={() => panels.hide(id)}
                >
                  {ui('取消', 'Cancel')}
                </button>
                <button
                  className="primary mp-destructive"
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
                      else if (confirm.kind === 'leaveAvailable')
                        await p.leaveAvailableRoom(confirm.roomId)
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
                  {confirm.kind !== 'unlike'
                    ? ui('确认离开', 'Leave room')
                    : ui('确认取消喜欢', 'Remove from Liked Songs')}
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
        {ui('扫码登录', 'Sign in with QR code')}
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
    onAlbum,
    onArtist,
    onControls: () => open('controls'),
  }
  function stepTitle(step: Step) {
    if (step === 'queue') return queueTitle(!!p.room)
    if (typeof step === 'string') return sources[step]?.title || panelTitle(step)
    switch (step.panel) {
      case 'settings':
        return settingsLabels[step.section]
      case 'private':
        return conversationName(
          inbox.conversations.find(
            (contact) => contact.uid === step.peer.uid && contact.nickname,
          ) || step.peer,
        )
      case 'members':
        return step.member.nickname
    }
  }
  const previous = panels.previous
  const backLabel =
    previous === 'settings'
      ? ui('返回设置分类', 'Back to settings categories')
      : previous === 'private'
        ? ui('返回私信列表', 'Back to conversations')
        : previous === 'members'
          ? ui('返回成员列表', 'Back to members')
          : previous
            ? ui('返回', 'Back to ') + stepTitle(previous)
            : ui('返回上一页', 'Go back')
  const { layout, pane, drawer, dialog } = panels
  const path = panels.path.map((step, level) => ({
    id: panelOf(step),
    key: stepKey(step),
    label: stepTitle(step),
    level,
  }))
  const paneEnd = path.map((crumb) => crumb.id).lastIndexOf(pane) + 1
  function dismissDrawer() {
    if (drawer) panels.hide(panels.quickReply ? 'private' : path[paneEnd]?.id || drawer)
  }

  return (
    <div
      ref={shell}
      className="adaptive-shell"
      data-layout={layout}
      data-now={panels.now}
      data-platform={desktop.info?.platform}
      data-fullscreen={!!desktop.info?.fullScreen}
      data-has-background={!!background?.image}
    >
      {background && <PlayerBackground background={background} />}
      <WindowChrome
        open={open}
        layout={layout}
        searchShortcut={layout === 'compact' && paneEnd === 1 && pane !== 'search'}
        onBack={panels.now ? () => panels.hide('lyrics') : undefined}
        nickname={p.account?.nickname}
        avatar={p.account?.avatarUrl}
        unread={inbox.unread}
        blocked={!!dialog || !!drawer}
      />
      {!panels.now && (!drawer || layout === 'compact') && (
        <WindowButtons
          maximized={!!desktop.info?.maximized}
          fullScreen={!!desktop.info?.fullScreen}
        />
      )}
      {layout !== 'compact' && !panels.now && (
        <div className="sidebar-slot" inert={!!dialog || !!drawer || panels.now}>
          <Sidebar
            open={open}
            trail={path.slice(0, paneEnd).map((crumb) => crumb.id)}
            likedCount={uid && library.likesReady ? library.likes.size : undefined}
            unread={inbox.unread}
          />
        </div>
      )}
      {drawer && (
        <div
          className="drawer-scrim"
          data-quick-reply={panels.quickReply}
          onClick={dismissDrawer}
          aria-hidden="true"
        />
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
                ? panels.now
                  ? 'immersive'
                  : 'page'
                : 'hidden'
        const title =
          id === 'confirm' && confirm
            ? confirm.kind === 'leaveAvailable'
              ? ui('退出当前房间？', 'Leave current room?')
              : confirm.kind === 'leave'
                ? ui('离开多人房间？', 'Leave this room?')
                : ui('取消喜欢这首歌？', 'Remove this track from Liked Songs?')
            : stepTitle(id)
        const trail =
          placement === 'page'
            ? path.slice(0, paneEnd)
            : placement === 'drawer' && !panels.quickReply
              ? path.slice(paneEnd)
              : []
        return (
          <Surface
            key={(uid || 'guest') + ':' + id}
            id={id}
            title={title}
            placement={placement}
            modal={placement === 'dialog'}
            blocked={id !== panels.active}
            trail={trail}
            onLevel={panels.goToLevel}
            onBack={
              id === panels.active &&
              panels.backAvailable &&
              (placement === 'page' || trail.length > 1)
                ? panels.back
                : undefined
            }
            backLabel={backLabel}
            close={
              placement === 'drawer'
                ? dismissDrawer
                : placement === 'dialog'
                  ? () => panels.hide(id)
                  : undefined
            }
          >
            {body(id)}
          </Surface>
        )
      })}
      <div className="footer-slot" inert={!!dialog}>
        <PlayerFooter
          {...playerProps}
          nowOpen={panels.now}
          onNow={() => {
            dismissDrawer()
            panels.show('lyrics')
          }}
          lyricsOpen={panels.now && showLyrics}
          lyricsUnavailable={panels.now && lyricsUnavailable}
          onLyrics={() => {
            dismissDrawer()
            setReading(panels.now && showLyrics ? 'cover' : 'lyrics')
            panels.show('lyrics')
          }}
          queueOpen={drawer === 'queue'}
          onQueue={() => (drawer === 'queue' ? dismissDrawer() : open('queue'))}
          roomOpen={drawer === 'room'}
          onRoom={() => (drawer === 'room' ? dismissDrawer() : open('room'))}
          chatOpen={drawer === 'chat'}
          translation={
            lyrics.translations.size
              ? { enabled: lyrics.showTranslation, toggle: lyrics.toggleTranslation }
              : undefined
          }
          chatUnread={chat.unread}
          onChat={() => (drawer === 'chat' ? dismissDrawer() : open('chat'))}
        />
      </div>
      {!dialog && noticeKey && inbox.notificationInbox.length > 0 && (
        <aside
          className="private-toast"
          data-notice="private"
          aria-label={ui('新私信', 'New message')}
        >
          <div className="toast-heading">
            <strong role="status">{ui('新私信', 'New message')}</strong>
            <IconButton
              label={ui('关闭新私信', 'Dismiss message notification')}
              onClick={() => setNoticeKey('')}
            >
              <X size={15} />
            </IconButton>
          </div>
          <div className="notice-peers">
            {inbox.notificationInbox.slice(0, 3).map((peer) => (
              <button
                key={peer.uid}
                title={ui('快速回复 {0}', 'Quick reply to {0}', conversationName(peer))}
                onClick={() => reply(peer)}
              >
                <UserAvatar name={conversationName(peer)} src={peer.avatar} />
                <span className="mp-notice-copy">
                  <strong>{conversationName(peer)}</strong>
                  <small>{conversationPreview(peer) || ui('新私信', 'New message')}</small>
                </span>
                {peer.unread > 1 ? (
                  <UnreadBadge count={peer.unread} />
                ) : (
                  <MessageSquare size={15} />
                )}
              </button>
            ))}
          </div>
        </aside>
      )}
      {feedback && (
        <aside
          className="feedback-toast"
          data-panel="feedback"
          data-error={!!p.error}
          inert={!!dialog}
        >
          {p.error ? (
            <CircleAlert aria-hidden="true" size={16} />
          ) : (
            <CheckCircle2 aria-hidden="true" size={16} />
          )}
          <span role={p.error ? 'alert' : 'status'}>{feedback}</span>
          {retry?.scope === playbackScope && (
            <button
              onClick={() => {
                setFeedback('')
                open('controls')
              }}
            >
              {ui('播放调节', 'Playback controls')}
            </button>
          )}
          <button
            className="icon-btn"
            aria-label={ui('关闭播放提示', 'Dismiss playback notification')}
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

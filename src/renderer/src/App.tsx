import { t } from '../../shared/ui-language'
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
import type { DesktopInfo } from '../../shared/desktop'
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

export function App({
  desktopInfo,
  startupError,
}: {
  desktopInfo: DesktopInfo | null
  startupError?: string
}) {
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
  const desktop = useDesktop(p, (id) => open(id), desktopInfo, startupError)
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
    if (!p.qr && !p.busy) void p.act(t('common.generateSignInQrCode'), p.login)
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
    await p.act(t('app.joinInvitedRoom'), async () => {
      const preview = await p.api('multiPreview', {
        roomId: invite.roomId,
        inviterUid: invite.inviterUid,
      })
      if (preview.data?.roomStatus !== 'AVAILABLE')
        throw new Error(t('app.theInvitationExpiredOrTheRoomCouldNot'))
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
    p.act(p.room ? t('app.recommendTrack') : t('app.playTrack'), () => p.playSong(song, ids))
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
              title: t('common.recentlyPlayed'),
              ids: recentIds,
            }}
          />
        ) : (
          <div className="empty">
            <Headphones size={26} />
            <strong>{t('app.noRecentlyPlayedTracks')}</strong>
            <button className="secondary" onClick={() => open('search')}>
              {t('app.searchMusic')}
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
            {t('common.joinListenTogether')}
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
            {t('common.joinListenTogether')}
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
            onExport={() => p.act(t('common.exportLog'), p.exportTrace)}
          />
        )
      case 'login':
        return (
          <div className="login-dialog">
            <p className="mp-qr-instruction">
              <ScanLine size={17} />
              {t('app.scanWithTheNeteaseCloudMusicAppTo')}
            </p>
            {p.qr && !['scanned', 'confirmed'].includes(p.qrStatus.phase) ? (
              <img alt={t('app.neteaseSignInQrCode')} src={p.qr.qrimg} />
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
                ? t('app.codeScannedConfirmSignInOnYourPhone')
                : p.qrStatus.phase === 'confirmed'
                  ? t('app.loadingAccount')
                  : p.qrStatus.phase === 'expired'
                    ? t('app.qrCodeExpired')
                    : p.qrStatus.phase === 'error'
                      ? p.qrStatus.message
                      : p.qr
                        ? t('app.waitingForScan')
                        : p.busy
                          ? t('app.generatingQrCode')
                          : ''}
            </small>
            {!p.qr && !p.busy && p.qrStatus.phase !== 'confirmed' && (
              <button
                className="primary"
                onClick={() => p.act(t('common.generateSignInQrCode'), p.login)}
              >
                {t('app.generateANewCode')}
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
                  ? t('app.leaveThisRoomItsHistoryCurrentSongAnd')
                  : confirm.kind === 'leaveAvailable'
                    ? t('app.leaveThisRoomPlaybackAndTheQueueOn')
                    : t('app.removeFromLikedSongs', { name: confirm.song.name })}
              </p>
              {confirmError && <p role="alert">{confirmError}</p>}
              <div className="row-actions">
                <button
                  className="secondary"
                  disabled={confirmPending}
                  onClick={() => panels.hide(id)}
                >
                  {t('common.cancel')}
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
                    ? t('app.leaveRoom')
                    : t('app.confirmRemoveFromLikedSongs')}
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
        {t('common.signInWithQrCode')}
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
      ? t('app.backToSettingsCategories')
      : previous === 'private'
        ? t('app.backToConversations')
        : previous === 'members'
          ? t('app.backToMembers')
          : previous
            ? t('app.backTo', { page: stepTitle(previous) })
            : t('app.goBack')
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
              ? t('app.leaveCurrentRoom')
              : confirm.kind === 'leave'
                ? t('app.leaveThisRoom')
                : t('app.removeThisTrackFromLikedSongs')
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
        <aside className="private-toast" data-notice="private" aria-label={t('common.newMessage')}>
          <div className="toast-heading">
            <strong role="status">{t('common.newMessage')}</strong>
            <IconButton
              label={t('app.dismissMessageNotification')}
              onClick={() => setNoticeKey('')}
            >
              <X size={15} />
            </IconButton>
          </div>
          <div className="notice-peers">
            {inbox.notificationInbox.slice(0, 3).map((peer) => (
              <button
                key={peer.uid}
                title={t('app.quickReplyTo', { nickname: conversationName(peer) })}
                onClick={() => reply(peer)}
              >
                <UserAvatar name={conversationName(peer)} src={peer.avatar} />
                <span className="mp-notice-copy">
                  <strong>{conversationName(peer)}</strong>
                  <small>{conversationPreview(peer) || t('common.newMessage')}</small>
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
              {t('common.playbackControls')}
            </button>
          )}
          <button
            className="icon-btn"
            aria-label={t('app.dismissPlaybackNotification')}
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

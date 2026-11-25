import { getUiLanguage, t } from '../../../shared/ui-language'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MusicianNames } from '../MusicianNames'
import { AlbumArtwork } from './AlbumArtwork'
import { IconButton } from '../design/Primitives'
import {
  AppWindow,
  CirclePlus,
  ChevronUp,
  ListMusic,
  Languages,
  Captions,
  MessageCircle,
  Headphones,
  Heart,
  ListOrdered,
  Repeat2,
  Repeat1,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  ThumbsUp,
  Volume2,
} from 'lucide-react'
import { targetPosition } from '../../../shared/multiplayer'

import type { useParty } from '../useParty'
import type { Song } from '../../../shared/types'
import { waitingCount } from '../../../shared/playback-queue'
export { ImmersivePlayer } from './ImmersivePlayer'
import { useVolumeWheel } from '../useVolumeWheel'

type Party = ReturnType<typeof useParty>
const time = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

export function useDisplayedPosition(p: Party) {
  const [, tick] = useState(0)
  const room = p.roomPlayback
  useEffect(() => {
    if (!room?.song || p.auditioning || p.playing) return
    const timer = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [!!room?.song, p.auditioning, p.playing])
  return room?.song && !p.auditioning ? targetPosition(room, performance.now()) : p.position
}

export function Playhead({
  party: p,
  position,
  act,
}: {
  party: Party
  position: number
  act: Party['act']
}) {
  const duration =
    (p.room && !p.auditioning ? p.roomPlayback?.duration : 0) || p.current?.duration || 0
  const disabled = !duration || !p.current || !!p.busy || (!!p.room && !p.auditioning)
  const trackKey = [p.current?.id, p.room?.roomId, p.auditioning].join(':')
  const dragging = useRef<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  useEffect(() => {
    setPreview(null)
    setHover(null)
  }, [trackKey, disabled])
  const value = Math.max(0, Math.min(duration, preview ?? position))
  const commit = (raw: string) => {
    setPreview(null)
    if (!disabled) void act(t('portraitPlayer.seek'), () => p.seek(Number(raw)))
  }
  return (
    <div
      className="playhead"
      style={{ '--played': (duration ? (100 * value) / duration : 0) + '%' } as CSSProperties}
    >
      <time>{duration ? time(value) : '–:––'}</time>
      <div className="scrub-rail">
        {!disabled && (preview ?? hover) !== null && (
          <output
            className="scrub-hint"
            style={{ left: ((preview ?? hover ?? 0) / duration) * 100 + '%' }}
          >
            {preview !== null && t('portraitPlayer.releaseToSeek')}
            {time(preview ?? hover ?? 0)}
          </output>
        )}
        <input
          type="range"
          onPointerMove={(event) => {
            if (disabled || dragging.current) return
            const rect = event.currentTarget.getBoundingClientRect()
            setHover(duration * Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)))
          }}
          onPointerLeave={() => setHover(null)}
          min={0}
          max={duration || 1}
          step={1}
          aria-label={t('portraitPlayer.playbackProgress')}
          aria-valuetext={
            duration ? time(value) + ' / ' + time(duration) : t('common.noTrackSelected')
          }
          value={value}
          disabled={disabled}
          onChange={(e) =>
            dragging.current
              ? setPreview(Number(e.currentTarget.value))
              : commit(e.currentTarget.value)
          }
          onPointerDown={(e) => {
            setPreview(Number(e.currentTarget.value))
            setHover(null)
            dragging.current = trackKey
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerCancel={() => {
            dragging.current = null
            setPreview(null)
          }}
          onPointerUp={(e) => {
            if (dragging.current === trackKey) commit(e.currentTarget.value)
            dragging.current = null
          }}
          onLostPointerCapture={() => {
            dragging.current = null
            setPreview(null)
          }}
          onBlur={() => setPreview(null)}
          onKeyDown={(e) => {
            if (disabled) return
            const seek: Record<string, number> = {
              ArrowLeft: value - 5000,
              ArrowRight: value + 5000,
              ArrowDown: value - 5000,
              ArrowUp: value + 5000,
              Home: 0,
              End: duration,
            }
            if (e.key in seek) {
              e.preventDefault()
              commit(String(Math.max(0, Math.min(duration, seek[e.key]))))
            }
          }}
        />
      </div>
      <time>{duration ? time(duration) : '–:––'}</time>
    </div>
  )
}
interface TransportProps {
  party: Party
  act: Party['act']
}

interface SongActions {
  liked: boolean
  likeReady: boolean
  onLike(): void
  onAdd(): void
}

interface PlayerProps extends TransportProps, SongActions {
  position: number
  onControls(): void
  onArtist(id: string, title: string): void
  onAlbum(id: string, title: string): void
}

function Transport({ party: p, act }: TransportProps) {
  const transport = p.auditioning
    ? t('portraitPlayer.stopPreview')
    : p.playing
      ? p.room
        ? t('portraitPlayer.pauseLocally')
        : t('common.pause')
      : p.room
        ? t('portraitPlayer.resumeListening')
        : t('common.play')
  return (
    <>
      <IconButton
        className="icon-btn"
        label={p.auditioning ? t('common.replayPreview') : t('common.previous')}
        disabled={(!p.auditioning && (!!p.room || !p.personalQueue.length)) || !!p.busy}
        onClick={() =>
          act(t('common.previous'), () => (p.auditioning ? p.seek(0) : p.nextLocal(-1)))
        }
      >
        <SkipBack fill="currentColor" />
      </IconButton>
      <button
        className="primary-play"
        data-audition={p.auditioning}
        title={transport}
        aria-label={transport}
        disabled={!p.current || !!p.busy}
        onClick={() => act(transport, p.togglePlay)}
      >
        {p.auditioning ? (
          <Square fill="currentColor" />
        ) : p.playing ? (
          <Pause fill="currentColor" />
        ) : (
          <Play fill="currentColor" />
        )}
      </button>
      <IconButton
        className="icon-btn"
        title={
          p.auditioning
            ? t('common.returnToTheRoomTrack')
            : p.room
              ? t('common.requestNextTrack')
              : t('common.next')
        }
        label={p.auditioning ? t('common.returnToTheRoomTrack') : t('common.next')}
        disabled={!p.current || !!p.busy}
        onClick={() => act(t('common.next'), () => (p.room ? p.nextSong() : p.nextLocal(1)))}
      >
        <SkipForward fill="currentColor" />
      </IconButton>
    </>
  )
}

function TrackActions({
  liked,
  likeReady,
  onLike,
  onAdd,
  current,
}: SongActions & { current: Song | null }) {
  return (
    <>
      <IconButton
        className="icon-btn"
        label={
          liked
            ? t('portraitPlayer.removeCurrentTrackFromLikedSongs')
            : t('portraitPlayer.likeCurrentTrack')
        }
        aria-pressed={liked}
        disabled={!current || !likeReady}
        onClick={onLike}
      >
        <Heart fill={liked ? 'currentColor' : 'none'} />
      </IconButton>
      <IconButton
        className="icon-btn"
        label={t('portraitPlayer.addCurrentTrackToPlaylist')}
        disabled={!current}
        onClick={onAdd}
      >
        <CirclePlus />
      </IconButton>
    </>
  )
}

function SongCredits({
  song,
  onAlbum,
  onArtist,
}: { song: Song | null } & Pick<PlayerProps, 'onAlbum' | 'onArtist'>) {
  if (!song) return null
  const albumId = song.albumId
  return (
    <span className="song-credits">
      {song.artist && (
        <span className="song-artist" title={song.artist}>
          <MusicianNames credits={song.artists} fallback={song.artist} onOpen={onArtist} />
        </span>
      )}
      {song.artist && song.album && <span aria-hidden="true"> · </span>}
      {song.album &&
        (albumId ? (
          <button
            className="song-album"
            title={t('common.openAlbum', { album: song.album })}
            onClick={() => onAlbum(albumId, song.album)}
          >
            {song.album}
          </button>
        ) : (
          <span className="song-album">{song.album}</span>
        ))}
    </span>
  )
}

function PlaybackMode({ party: p }: { party: Party }) {
  const modeLabels = {
    order: t('common.inOrder'),
    loop: t('common.repeatAll'),
    single: t('common.repeatOne'),
  } as const
  const modes = ['order', 'loop', 'single'] as const
  const next = modes[(modes.indexOf(p.repeatMode) + 1) % modes.length]
  const Icon = p.repeatMode === 'single' ? Repeat1 : p.repeatMode === 'loop' ? Repeat2 : ListOrdered
  const label = modeLabels[p.repeatMode]
  return (
    <IconButton
      className="icon-btn playback-mode"
      title={t('portraitPlayer.switchTo', { current: label, next: modeLabels[next] })}
      label={t('portraitPlayer.playbackMode', { mode: label })}
      onClick={() => p.changeRepeat(next)}
    >
      <Icon />
    </IconButton>
  )
}

function VolumeControl({ party: p, onControls }: { party: Party; onControls(): void }) {
  const ref = useVolumeWheel<HTMLDivElement>(p.volume, p.setVolume)
  return (
    <div className="transport-volume" ref={ref}>
      <IconButton
        className="icon-btn"
        label={t('common.playbackControls')}
        title={t('portraitPlayer.volume', { percent: Math.round(p.volume * 100) })}
        onClick={onControls}
      >
        <Volume2 />
      </IconButton>
      <input
        aria-label={t('common.volume')}
        aria-valuetext={Math.round(p.volume * 100) + '%'}
        type="range"
        min="0"
        max="1"
        step=".01"
        value={p.volume}
        style={{ '--volume': p.volume * 100 + '%' } as CSSProperties}
        onChange={(e) => p.setVolume(Number(e.target.value))}
      />
    </div>
  )
}

function QueueBadge({ party: p }: { party: Party }) {
  const count = p.room ? waitingCount(p.roomPlayback) : p.personalQueue.length
  return count ? (
    <span className="transport-count" aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  ) : null
}

export function PlayerFooter({
  party: p,
  position,
  onControls,
  onNow,
  onQueue,
  translation,
  onAlbum,
  onArtist,
  nowOpen,
  queueOpen,
  lyricsOpen,
  lyricsUnavailable,
  onLyrics,
  roomOpen,
  onRoom,
  chatOpen,
  chatUnread,
  onChat,
  act,
  ...actions
}: PlayerProps & {
  onNow(): void
  onQueue(): void
  translation?: { enabled: boolean; toggle(): void }
  onLyrics(): void
  onChat(): void
  nowOpen: boolean
  lyricsOpen: boolean
  lyricsUnavailable: boolean
  queueOpen: boolean
  roomOpen: boolean
  onRoom(): void
  chatOpen: boolean
  chatUnread: number
}) {
  const roomCount = p.room ? p.onlineCount : null
  const roomLabel =
    roomCount === null ? t('common.listenTogether') : t('room.listeningCount', { count: roomCount })
  const roomSong = p.roomPlayback?.song
  const { liked: likedRoomSong, count: roomLikes } = p.roomReaction
  const progress = <Playhead party={p} position={position} act={act} />
  return (
    <footer
      className="adaptive-player-bar"
      data-now={nowOpen}
      aria-label={t('portraitPlayer.playbackBar')}
    >
      {nowOpen && progress}
      <div className="footer-identity">
        {!nowOpen && (
          <>
            <button
              className="footer-track footer-thumb"
              aria-label={t('common.openNowPlaying')}
              title={t('common.openNowPlaying')}
              onClick={onNow}
            >
              <AlbumArtwork song={p.current} className="footer-art" />
              <ChevronUp size={18} />
              {p.auditioning && <small className="footer-audition">{t('common.preview')}</small>}
            </button>
            <div className="footer-track-copy">
              <button
                className="footer-title"
                title={
                  p.current?.name
                    ? t('portraitPlayer.openNowPlaying', { name: p.current.name })
                    : t('common.openNowPlaying')
                }
                onClick={onNow}
              >
                <strong>{p.current?.name || t('common.noTrackSelected')}</strong>
              </button>
              <SongCredits song={p.current} onAlbum={onAlbum} onArtist={onArtist} />
              {p.auditioning && (
                <small className="audition-label">{t('common.localPreview')}</small>
              )}
            </div>
          </>
        )}
        <div className="footer-song-actions">
          <TrackActions current={p.current} {...actions} />
          {nowOpen && translation && lyricsOpen && (
            <button
              type="button"
              className="icon-btn footer-translation"
              aria-label={t('common.showLyricTranslation')}
              title={
                translation.enabled
                  ? t('common.hideLyricTranslation')
                  : t('common.showLyricTranslation')
              }
              aria-pressed={translation.enabled}
              onClick={translation.toggle}
            >
              {getUiLanguage() !== 'zh-CN' ? <Languages size={14} aria-hidden="true" /> : '译'}
            </button>
          )}
        </div>
      </div>
      <div className="footer-center">
        <div className="footer-transport">
          {nowOpen && !p.room && <PlaybackMode party={p} />}
          <Transport party={p} act={act} />
        </div>
        {!nowOpen && progress}
      </div>
      <div className="footer-actions">
        <IconButton
          className="icon-btn footer-room"
          label={t('common.listenTogether')}
          title={roomLabel}
          aria-description={roomCount === null ? undefined : roomLabel}
          data-joined={!!p.room}
          aria-expanded={roomOpen}
          onClick={onRoom}
        >
          <span className="footer-room-icon">
            <Headphones />
            {roomCount !== null && (
              <small className="transport-count" aria-hidden="true">
                {roomCount > 99 ? '99+' : roomCount}
              </small>
            )}
          </span>
          <span className="footer-room-label" aria-hidden="true">
            {roomCount === null ? (
              roomLabel
            ) : (
              <>
                <span className="footer-room-count">{roomCount}</span>
                {t('portraitPlayer.listening')}
              </>
            )}
          </span>
        </IconButton>
        {p.room && roomSong && (
          <IconButton
            className="icon-btn footer-room-like"
            label={t('common.likeThisRoomTrack')}
            title={t('room.likeSummary', {
              action: likedRoomSong
                ? t('portraitPlayer.likedClickToLikeAgain')
                : t('common.likeThisRoomTrack'),
              count: roomLikes,
            })}
            aria-pressed={likedRoomSong}
            aria-description={t('portraitPlayer.likesOnThisTrack', { count: roomLikes })}
            disabled={!!p.busy || p.auditioning || p.roomReaction.loading}
            onClick={() => act(t('portraitPlayer.likeRoomTrack'), p.likeRoomSong)}
          >
            <ThumbsUp />
            <small className="transport-count" aria-hidden="true">
              {roomLikes > 99 ? '99+' : roomLikes}
            </small>
          </IconButton>
        )}
        <VolumeControl party={p} onControls={onControls} />
        <IconButton
          className="icon-btn footer-lyrics"
          label={t('common.lyrics')}
          aria-expanded={lyricsOpen}
          disabled={lyricsUnavailable}
          onClick={onLyrics}
        >
          {getUiLanguage() !== 'zh-CN' ? <Captions size={16} aria-hidden="true" /> : '词'}
        </IconButton>
        {p.room && (
          <IconButton
            className="icon-btn"
            label={t('common.roomChat')}
            aria-expanded={chatOpen}
            onClick={onChat}
          >
            <MessageCircle />
            {chatUnread > 0 && (
              <span className="transport-count">{chatUnread > 99 ? '99+' : chatUnread}</span>
            )}
          </IconButton>
        )}
        <IconButton
          className="icon-btn footer-queue"
          label={t('common.playQueue')}
          aria-expanded={queueOpen}
          onClick={onQueue}
        >
          <ListMusic />
          <QueueBadge party={p} />
        </IconButton>
      </div>
    </footer>
  )
}

export function PlaybackControls({
  party: p,
  position,
  fullScreen,
  toggleFullScreen,
  onArtist,
  act,
  retry,
}: {
  party: Party
  position: number
  fullScreen: boolean
  act: Party['act']
  retry?: { label: string; run(): void }
  onArtist: PlayerProps['onArtist']
  toggleFullScreen(): void
}) {
  const ref = useVolumeWheel<HTMLDivElement>(p.volume, p.setVolume)
  return (
    <div className="tool-stack">
      <div className="song-identity">
        <strong>{p.current?.name || t('common.noTrackSelected')}</strong>
        <span>
          <MusicianNames
            credits={p.current?.artists}
            fallback={p.current?.artist}
            onOpen={onArtist}
          />
        </span>
        {p.auditioning && <small>{t('common.localPreview')}</small>}
      </div>
      <Playhead party={p} position={position} act={act} />
      <div className="volume-row" ref={ref}>
        <Volume2 size={18} />
        <input
          type="range"
          aria-label={t('common.volume')}
          aria-valuetext={Math.round(p.volume * 100) + '%'}
          min="0"
          max="1"
          step=".01"
          value={p.volume}
          onChange={(e) => p.setVolume(Number(e.target.value))}
        />
        <output aria-label={t('portraitPlayer.currentVolume')}>
          {Math.round(p.volume * 100)}%
        </output>
      </div>
      {!p.room && (
        <label className="control-row">
          {t('portraitPlayer.playbackModeLabel')}
          <select
            value={p.repeatMode}
            onChange={(e) => p.changeRepeat(e.target.value as typeof p.repeatMode)}
          >
            <option value="order">{t('common.inOrder')}</option>
            <option value="loop">{t('common.repeatAll')}</option>
            <option value="single">{t('common.repeatOne')}</option>
          </select>
        </label>
      )}
      {p.error && (
        <div className="control-error" role="alert">
          <span>{p.error}</span>
          {retry && (
            <button className="text-btn" disabled={!!p.busy} onClick={retry.run}>
              {t('common.retryAction', { action: retry.label })}
            </button>
          )}
        </div>
      )}
      <button className="secondary" onClick={toggleFullScreen}>
        <AppWindow size={16} />
        {fullScreen ? t('portraitPlayer.exitFullscreen') : t('portraitPlayer.enterFullscreen')}
      </button>
    </div>
  )
}

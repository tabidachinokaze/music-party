import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AlbumArtwork } from './AlbumArtwork'
import {
  AppWindow,
  Captions,
  ChevronUp,
  ListMusic,
  Heart,
  ListPlus,
  PanelsTopLeft,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Volume2,
} from 'lucide-react'
import { targetPosition } from '../../../shared/multiplayer'
import type { Preferences } from '../../../shared/desktop'
import type { useParty } from '../useParty'
import type { Song } from '../../../shared/types'
import './adaptive-transport.css'
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
  const [preview, setPreview] = useState<number | null>(null)
  useEffect(() => setPreview(null), [trackKey, disabled])
  const value = Math.max(0, Math.min(duration, preview ?? position))
  const commit = (raw: string) => {
    setPreview(null)
    if (!disabled) void act('跳转进度', () => p.seek(Number(raw)))
  }
  return (
    <div
      className="playhead"
      style={{ '--played': (duration ? (100 * value) / duration : 0) + '%' } as CSSProperties}
    >
      <time>{duration ? time(value) : '–:––'}</time>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={1}
        aria-label="播放进度"
        aria-valuetext={duration ? time(value) + ' / ' + time(duration) : '尚未选歌'}
        value={value}
        disabled={disabled}
        onChange={(e) =>
          dragging.current
            ? setPreview(Number(e.currentTarget.value))
            : commit(e.currentTarget.value)
        }
        onPointerDown={(e) => {
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
}

function Transport({ party: p, act }: TransportProps) {
  const transport = p.auditioning
    ? '停止试听'
    : p.playing
      ? p.room
        ? '本机暂停'
        : '暂停'
      : p.room
        ? '恢复同听'
        : '播放'
  return (
    <>
      <button
        className="icon-btn"
        title={p.auditioning ? '重播试听' : '上一首'}
        aria-label={p.auditioning ? '重播试听' : '上一首'}
        disabled={(!p.auditioning && (!!p.room || !p.personalQueue.length)) || !!p.busy}
        onClick={() => act('上一首', () => (p.auditioning ? p.seek(0) : p.nextLocal(-1)))}
      >
        <SkipBack />
      </button>
      <button
        className="primary-play"
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
      <button
        className="icon-btn"
        title={p.auditioning ? '返回房间当前歌曲' : p.room ? '请求房间下一首' : '下一首'}
        aria-label={p.auditioning ? '返回房间当前歌曲' : '下一首'}
        disabled={!p.current || !!p.busy}
        onClick={() => act('下一首', () => (p.room ? p.nextSong() : p.nextLocal(1)))}
      >
        <SkipForward />
      </button>
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
      <button
        className="icon-btn"
        title={liked ? '取消喜欢当前歌曲' : '喜欢当前歌曲'}
        aria-label={liked ? '取消喜欢当前歌曲' : '喜欢当前歌曲'}
        aria-pressed={liked}
        disabled={!current || !likeReady}
        onClick={onLike}
      >
        <Heart fill={liked ? 'currentColor' : 'none'} />
      </button>
      <button
        className="icon-btn"
        title="添加当前歌曲到歌单"
        aria-label="添加当前歌曲到歌单"
        disabled={!current}
        onClick={onAdd}
      >
        <ListPlus />
      </button>
    </>
  )
}

export function PortraitPlayer({
  party: p,
  position,
  background,
  layout = 'compact',
  onControls,
  onWindows,
  act,
  ...actions
}: PlayerProps & {
  background?: Preferences['playerBackground']
  layout?: 'compact' | 'medium'
  onWindows(): void
}) {
  return (
    <section className="portrait-stage adaptive-stage" data-layout={layout} aria-label="播放界面">
      <div className="portrait-player">
        {!background?.image && p.current?.cover && (
          <div className="cover-tint" aria-hidden="true">
            <img src={p.current.cover} alt="" draggable={false} referrerPolicy="no-referrer" />
          </div>
        )}
        <AlbumArtwork song={p.current} className="sleeve" />
        {layout === 'medium' && (
          <div className="portrait-identity">
            <strong title={p.current?.name}>{p.current?.name || '尚未选歌'}</strong>
            <small>{p.auditioning ? '本机试听' : p.current?.artist}</small>
          </div>
        )}
        <Playhead party={p} position={position} act={act} />
        <div className="portrait-transport">
          <Transport party={p} act={act} />
        </div>
        <div className="portrait-tools">
          <TrackActions current={p.current} {...actions} />
          <button className="icon-btn" title="播放调节" aria-label="播放调节" onClick={onControls}>
            <SlidersHorizontal />
          </button>
          <button className="icon-btn" title="打开内容" aria-label="打开内容" onClick={onWindows}>
            <PanelsTopLeft />
          </button>
        </div>
      </div>
    </section>
  )
}

export function PlayerFooter({
  party: p,
  position,
  onControls,
  onNow,
  onQueue,
  nowOpen,
  queueOpen,
  act,
  ...actions
}: PlayerProps & {
  onNow(): void
  onQueue(): void
  nowOpen: boolean
  queueOpen: boolean
}) {
  const ref = useVolumeWheel<HTMLButtonElement>(p.volume, p.setVolume)
  const nowLabel = nowOpen ? '收起正在播放' : '展开正在播放'
  return (
    <footer className="adaptive-player-bar" aria-label="底部播放栏">
      <button
        className="footer-track"
        aria-label={nowLabel}
        title={nowLabel}
        aria-expanded={nowOpen}
        onClick={onNow}
      >
        <span className="footer-thumb">
          <AlbumArtwork song={p.current} className="footer-art" />
          <ChevronUp size={17} />
        </span>
        <span className="footer-track-copy">
          <strong>{p.current?.name || '尚未选歌'}</strong>
          <small>{p.auditioning ? '本机试听' : p.current?.artist}</small>
        </span>
      </button>
      <div className="footer-transport">
        <Transport party={p} act={act} />
      </div>
      <div className="footer-actions">
        <Playhead party={p} position={position} act={act} />
        <TrackActions current={p.current} {...actions} />
        <button
          className="icon-btn footer-lyrics"
          aria-label="歌词"
          title="歌词"
          aria-expanded={nowOpen}
          onClick={onNow}
        >
          <Captions />
        </button>
        <button
          className="icon-btn footer-queue"
          aria-label="播放队列"
          title="播放队列"
          aria-expanded={queueOpen}
          onClick={onQueue}
        >
          <ListMusic />
        </button>
        <button
          ref={ref}
          className="icon-btn footer-volume"
          aria-label="播放调节"
          title={'音量 ' + Math.round(p.volume * 100) + '% · 播放调节'}
          onClick={onControls}
        >
          <Volume2 />
        </button>
      </div>
    </footer>
  )
}

export function PlaybackControls({
  party: p,
  position,
  fullScreen,
  toggleFullScreen,
  act,
  retry,
}: {
  party: Party
  position: number
  fullScreen: boolean
  act: Party['act']
  retry?: { label: string; run(): void }
  toggleFullScreen(): void
}) {
  const ref = useVolumeWheel<HTMLDivElement>(p.volume, p.setVolume)
  return (
    <div className="tool-stack">
      <div className="song-identity">
        <strong>{p.current?.name || '尚未选歌'}</strong>
        <span>{p.current?.artist}</span>
        {p.auditioning && <small>本机试听</small>}
      </div>
      <Playhead party={p} position={position} act={act} />
      <div className="volume-row" ref={ref}>
        <Volume2 size={18} />
        <input
          type="range"
          aria-label="音量"
          aria-valuetext={Math.round(p.volume * 100) + '%'}
          min="0"
          max="1"
          step=".01"
          value={p.volume}
          onChange={(e) => p.setVolume(Number(e.target.value))}
        />
        <output aria-label="当前音量">{Math.round(p.volume * 100)}%</output>
      </div>
      {!p.room && (
        <label className="control-row">
          播放方式
          <select
            value={p.repeatMode}
            onChange={(e) => p.changeRepeat(e.target.value as typeof p.repeatMode)}
          >
            <option value="order">顺序播放</option>
            <option value="loop">列表循环</option>
            <option value="single">单曲循环</option>
          </select>
        </label>
      )}
      {p.error && (
        <div className="control-error" role="alert">
          <span>{p.error}</span>
          {retry && (
            <button className="text-btn" disabled={!!p.busy} onClick={retry.run}>
              重试{retry.label}
            </button>
          )}
        </div>
      )}
      <button className="secondary" onClick={toggleFullScreen}>
        <AppWindow size={16} />
        {fullScreen ? '退出系统全屏' : '进入系统全屏'}
      </button>
    </div>
  )
}

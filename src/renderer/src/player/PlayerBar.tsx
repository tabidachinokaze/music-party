import {
  ChevronUp,
  ChevronDown,
  Headphones,
  Heart,
  ListMusic,
  MessageCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
} from 'lucide-react'
import { waitingCount } from '../../../shared/playback-queue'
import { useState } from 'react'
import type { useParty } from '../useParty'
import type { useLibrary } from '../useLibrary'
import { useVolumeWheel } from '../useVolumeWheel'
import './volume-control.css'
const time = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
export function PlayerBar({
  party: p,
  library,
  expanded,
  onPlayer,
  onLike,
  onQueue,
  queueOpen,
  onChat,
  chatOpen,
  unread,
}: {
  party: ReturnType<typeof useParty>
  library: ReturnType<typeof useLibrary>
  expanded: boolean
  onPlayer(): void
  onLike(): void
  onQueue(): void
  queueOpen: boolean
  onChat(): void
  chatOpen: boolean
  unread: number
}) {
  const [preview, setPreview] = useState<number | null>(null)
  const volumeWheelRef = useVolumeWheel<HTMLDivElement>(p.volume, p.setVolume)
  const commitSeek = (value: string) => {
    setPreview(null)
    p.act('跳转进度', () => p.seek(Number(value)))
  }
  const count = p.room ? waitingCount(p.roomPlayback) : p.personalQueue.length
  return (
    <div className="player" aria-label="底部播放栏">
      <button
        className="now-playing"
        aria-label={expanded ? '收起播放页' : '打开播放界面'}
        aria-expanded={expanded}
        onClick={onPlayer}
      >
        <div className="cover">
          {p.current?.cover ? (
            <img src={p.current.cover} alt="当前歌曲封面" />
          ) : (
            <Headphones size={22} />
          )}
          <span className="cover-expand">
            {expanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </span>
        </div>
        <div>
          <strong>{p.current?.name || 'Music Party'}</strong>
          <small>{p.current?.artist || '选一首喜欢的歌，开始吧'}</small>
        </div>
      </button>
      {p.current && (
        <button
          className={`icon-btn bar-like ${library.likes.has(p.current.id) ? 'liked' : ''}`}
          aria-label={library.likes.has(p.current.id) ? '取消喜欢当前歌曲' : '喜欢当前歌曲'}
          disabled={!library.likesReady || library.likeBusy.has(p.current.id)}
          onClick={onLike}
        >
          <Heart size={17} fill={library.likes.has(p.current.id) ? 'currentColor' : 'none'} />
        </button>
      )}
      <div className="playback">
        <div className="transport-controls">
          <button
            className="icon-btn"
            aria-label={p.auditioning ? '重播试听' : '上一首'}
            disabled={(!p.auditioning && (!!p.room || !p.personalQueue.length)) || !!p.busy}
            onClick={() => p.act('上一首', () => (p.auditioning ? p.seek(0) : p.nextLocal(-1)))}
          >
            <SkipBack size={18} />
          </button>
          <button
            className="play-button"
            aria-label={
              p.auditioning
                ? '停止试听'
                : p.playing
                  ? p.room
                    ? '本机暂停'
                    : '暂停'
                  : p.room
                    ? '恢复同听'
                    : '播放'
            }
            title={p.auditioning ? '停止试听并返回房间当前歌曲' : undefined}
            disabled={(!p.current && !p.auditioning) || !!p.busy}
            onClick={() => p.act(p.auditioning ? '停止试听' : '控制播放', p.togglePlay)}
          >
            {p.auditioning ? (
              <Square size={20} fill="currentColor" />
            ) : p.playing ? (
              <Pause size={20} />
            ) : (
              <Play size={20} />
            )}
          </button>
          <button
            className="icon-btn"
            aria-label={p.auditioning ? '返回房间当前歌曲' : '下一首'}
            title={p.auditioning ? '停止试听并返回一起听' : p.room ? '请求房间下一首' : '下一首'}
            disabled={!p.current || !!p.busy}
            onClick={() => p.act('下一首', () => (p.room ? p.nextSong() : p.nextLocal(1)))}
          >
            <SkipForward size={18} />
          </button>
        </div>
        <div className="progress">
          <span>{time(preview ?? p.position)}</span>
          <input
            aria-label="播放进度"
            type="range"
            min="0"
            max={p.current?.duration || 1}
            value={preview ?? p.position}
            disabled={!p.current || !!p.busy || (!!p.room && !p.auditioning)}
            onChange={(event) => setPreview(Number(event.target.value))}
            onPointerUp={(event) => commitSeek(event.currentTarget.value)}
            onKeyUp={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                commitSeek(event.currentTarget.value)
            }}
          />
          <span>{time(p.current?.duration || 0)}</span>
        </div>
      </div>
      <div className="player-right">
        {p.auditioning ? (
          <button
            className="bar-room"
            onClick={() => p.stopAudition().catch((error) => p.setError(error.message))}
            title="停止本机试听，返回房间当前歌曲"
          >
            返回一起听
          </button>
        ) : p.room ? (
          <button className="bar-room" onClick={onPlayer} title="回到一起听播放界面">
            <span className="dot" />
            一起听
          </button>
        ) : null}
        <div className="bar-volume" ref={volumeWheelRef} title="滚动鼠标滚轮调整音量">
          <Volume2 size={17} />
          <input
            aria-label="音量"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={p.volume}
            aria-valuetext={`${Math.round(p.volume * 100)}%`}
            onChange={(event) => p.setVolume(Number(event.target.value))}
          />
          <output className="bar-volume-value" aria-label="当前音量">
            {Math.round(p.volume * 100)}%
          </output>
        </div>
        {p.room && (
          <button
            className={`bar-panel-button ${chatOpen ? 'active' : ''}`}
            aria-label="打开房间聊天"
            title="房间聊天"
            onClick={onChat}
            data-popup-toggle="chat"
          >
            <MessageCircle size={19} />
            {unread > 0 && <span className="bar-indicator" />}
          </button>
        )}
        <button
          className={`bar-panel-button queue-toggle ${queueOpen ? 'active' : ''}`}
          aria-label="播放队列"
          data-popup-toggle="queue"
          title={p.room ? '房间待播列表' : '播放队列'}
          aria-expanded={queueOpen}
          onClick={onQueue}
        >
          <ListMusic size={21} />
          <span>{count ?? '·'}</span>
        </button>
      </div>
    </div>
  )
}

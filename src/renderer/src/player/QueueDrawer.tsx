import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpToLine,
  ListMusic,
  Music2,
  Play,
  RefreshCw,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react'
import type { Song, QueueSong, RoomQueueEntry } from '../../../shared/types'
import type { useParty } from '../useParty'
import { waitingCount } from '../../../shared/playback-queue'
import { toSong } from '../../../shared/protocol'
import { useDismissable } from './useDismissable'
import { useRoomQueue } from '../useRoomQueue'
import { Overlay } from './Overlay'
import { useScrollPagination } from '../useScrollPagination'

export function QueueDrawer({
  party: p,
  onClose,
  closing,
}: {
  party: ReturnType<typeof useParty>
  onClose(): void
  closing: boolean
}) {
  const [limit, setLimit] = useState(100)
  const [tracks, setTracks] = useState<Record<string, Song | null>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [removing, setRemoving] = useState<RoomQueueEntry | null>(null)
  const cache = useRef<Record<string, Song | null>>({})
  const drawer = useRef<HTMLElement>(null)
  useDismissable(drawer, onClose, !closing, '[data-popup-toggle="queue"]')
  const inRoom = !!p.room
  const roomQueue = useRoomQueue(
    p.api,
    p.room?.roomId,
    p.roomPlayback?.version,
    !closing,
    p.queueRevision,
  )
  const scope = `${p.account?.userId || 'guest'}:${p.room?.roomId || 'personal'}`
  const currentIndex = roomQueue.entries.findIndex(
    (entry) => entry.songBizId === p.roomPlayback?.song?.songBizId,
  )
  const officialSong = p.roomPlayback?.song
  const roomSong =
    officialSong && inRoom && !p.auditioning && p.current?.id === officialSong.songId
      ? officialSong
      : null
  const recommenderName = (song: QueueSong, entry?: Partial<RoomQueueEntry>) => {
    if (!song.songRcmdUid || song.songRcmdUid === '0') return '系统推荐'
    const member = p.members.find((member) => member.uid === song.songRcmdUid)
    const nickname = entry?.songRcmdUid === song.songRcmdUid ? entry.recommender?.trim() : ''
    return nickname || member?.nickname || `用户 ${song.songRcmdUid}`
  }
  const currentRecommender = roomSong
    ? recommenderName(roomSong, roomQueue.entries[currentIndex])
    : ''
  const currentReaction = roomSong?.songBizId === p.roomReaction.bizId
  const currentLiked = currentReaction && p.roomReaction.liked
  const currentLikeCount = Math.max(
    currentReaction ? p.roomReaction.count : 0,
    p.roomPlayback?.likeCount || 0,
  )
  const queued = currentIndex < 0 ? roomQueue.entries : roomQueue.entries.slice(currentIndex + 1)
  const ids = p.room ? [] : p.personalQueue.slice(0, limit)
  const queueSentinel = useScrollPagination({
    enabled: !closing,
    scope,
    loading: loading || (inRoom && roomQueue.loading),
    hasMore: (inRoom ? queued.length : p.personalQueue.length) > limit,
    blocked: !!error || !!roomQueue.error,
    contentKey: limit,
    onLoad: () => setLimit((value) => value + 100),
  })
  const idsKey = ids.join(',')
  useEffect(() => {
    cache.current = {}
    setTracks({})
    setLimit(100)
    setRemoving(null)
  }, [scope])
  useEffect(() => {
    let active = true
    setError('')
    const missing = [...new Set(ids)].filter((id) => !Object.hasOwn(cache.current, id))
    if (!missing.length) {
      setLoading(false)
      return
    }
    setLoading(true)
    const fetch = async () => {
      try {
        for (let offset = 0; offset < missing.length; offset += 100) {
          const batch = missing.slice(offset, offset + 100)
          const body = await p.api('song', { ids: batch.join(',') })
          if (!active) return
          if (!Array.isArray(body.songs)) throw new Error('歌曲信息暂时无法读取')
          for (const id of batch) cache.current[id] = null
          for (const raw of body.songs) cache.current[String(raw.id)] = toSong(raw)
          setTracks({ ...cache.current })
        }
      } catch (e: any) {
        if (active) setError(e.message || '歌曲信息暂时无法读取')
      } finally {
        if (active) setLoading(false)
      }
    }
    fetch()
    return () => {
      active = false
    }
  }, [scope, idsKey])
  useEffect(() => {
    if (closing) return
    const previous = document.activeElement as HTMLElement | null
    drawer.current?.querySelector<HTMLButtonElement>('[aria-label="关闭播放队列"]')?.focus()
    const close = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.isComposing &&
        !event.defaultPrevented &&
        !document.querySelector('[aria-modal="true"]')
      ) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('keydown', close)
      if (previous?.isConnected) previous.focus()
    }
  }, [closing])
  const title = inRoom ? '房间待播列表' : '播放队列'
  const count = inRoom
    ? roomQueue.complete
      ? queued.length
      : waitingCount(p.roomPlayback)
    : p.personalQueue.length
  const entries: (QueueSong & Partial<RoomQueueEntry>)[] = inRoom
    ? queued.slice(0, limit)
    : ids.map((songId, index) => ({ songId, songBizId: `${index}`, songRcmdUid: '' }))
  return (
    <aside
      className="queue-drawer"
      data-closing={closing}
      aria-hidden={closing}
      inert={closing}
      ref={drawer}
      role="dialog"
      aria-label={title}
      aria-modal="false"
    >
      <div className="queue-drawer-heading">
        <div>
          <h2>
            <ListMusic size={19} />
            {title}
          </h2>
          <p>{count === undefined ? '正在同步房间…' : `${count} 首${inRoom ? '待播' : ''}`}</p>
        </div>
        {inRoom && (
          <button
            className="icon-btn"
            aria-label="刷新待播列表"
            disabled={roomQueue.loading}
            onClick={roomQueue.refresh}
          >
            <RefreshCw size={16} />
          </button>
        )}
        <button className="icon-btn" aria-label="关闭播放队列" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      {p.current && (
        <div className="queue-playing">
          <span className="queue-section-label">正在播放</span>
          <div>
            {p.current.cover ? (
              <img src={p.current.cover} alt="" />
            ) : (
              <span className="queue-art-placeholder">
                <Music2 size={20} />
              </span>
            )}
            <span className="queue-playing-copy">
              {currentRecommender && (
                <span className="queue-track-overline" title={currentRecommender}>
                  {currentRecommender}
                </span>
              )}
              <strong>{p.current.name}</strong>
              <small>{p.current.artist}</small>
            </span>
            <span className={`equalizer ${p.playing ? 'playing' : ''}`} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {roomSong && (
              <button
                className={`icon-btn queue-playing-like ${currentLiked ? 'liked' : ''}`}
                aria-label={`点赞正在播放歌曲 ${p.current.name}`}
                aria-pressed={currentLiked}
                title={currentLiked ? '已为房间当前歌曲点赞' : '为房间当前歌曲点赞'}
                disabled={!!p.busy || !currentReaction || p.roomReaction.loading}
                onClick={() => p.act('一起听点赞', p.likeRoomSong)}
              >
                <ThumbsUp size={16} />
                <small>{currentLikeCount}</small>
              </button>
            )}
          </div>
        </div>
      )}
      {!inRoom && (
        <div className="queue-toolbar">
          <select
            aria-label="播放模式"
            value={p.repeatMode}
            onChange={(event) => p.changeRepeat(event.target.value as 'order' | 'loop' | 'single')}
          >
            <option value="order">顺序播放</option>
            <option value="loop">列表循环</option>
            <option value="single">单曲循环</option>
          </select>
          <button className="text-btn" onClick={p.clearPersonalQueue}>
            清空队列
          </button>
        </div>
      )}
      <div className="queue-drawer-list">
        {inRoom && <div className="queue-section-label">接下来播放</div>}
        {(error || roomQueue.error) && (
          <p className="queue-error" role="alert">
            {error || roomQueue.error}
            {roomQueue.error && (
              <button className="text-btn" onClick={roomQueue.refresh}>
                重试
              </button>
            )}
          </p>
        )}
        {entries.map((entry, index) => {
          const track = entry.track || tracks[entry.songId]
          const recommender = recommenderName(entry, entry)
          const content = (
            <>
              <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
              {track?.cover ? (
                <img src={track.cover} alt="" />
              ) : (
                <span className="queue-art-placeholder">
                  <Music2 size={18} />
                </span>
              )}
              <span className="queue-track-copy">
                {inRoom && (
                  <span className="queue-track-overline" title={recommender}>
                    {recommender}
                  </span>
                )}
                <strong>
                  {track?.name || (track === null ? '歌曲信息暂不可用' : '正在读取歌曲…')}
                </strong>
                <small>{track?.artist || '—'}</small>
              </span>
              {!inRoom && <Play size={15} className="queue-track-play" />}
            </>
          )
          return inRoom ? (
            <div className="queue-track" key={entry.songBizId}>
              {content}
              <div className="queue-entry-actions">
                <button
                  className="icon-btn"
                  aria-label={`顶歌 ${track?.name || entry.songId}`}
                  title="UP 顶歌，提高待播优先级"
                  disabled={!!p.busy || entry.uped}
                  onClick={() =>
                    p.act('顶歌', () => p.recommendOperation('multiUp', entry as RoomQueueEntry))
                  }
                >
                  <ArrowUpToLine size={15} />
                  <small>{entry.upCountKnown === false ? '' : entry.upCount}</small>
                </button>
                {entry.songRcmdUid === String(p.account?.userId) && (
                  <button
                    className="icon-btn"
                    aria-label={`删除推荐 ${track?.name || entry.songId}`}
                    title="删除自己的推荐"
                    disabled={!!p.busy}
                    onClick={() => {
                      p.setError('')
                      setRemoving(entry as RoomQueueEntry)
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button
              className={`queue-track ${index === p.personalIndex ? 'current' : ''}`}
              key={entry.songBizId}
              disabled={!!p.busy}
              aria-label={`播放队列第 ${index + 1} 首`}
              onClick={() => p.act('播放队列', () => p.playQueueIndex(index))}
            >
              {content}
            </button>
          )
        })}
        {inRoom && !p.roomPlayback && <p className="queue-loading">正在同步房间待播列表…</p>}
        {!entries.length && !loading && (!inRoom || roomQueue.complete) && (
          <div className="queue-empty">
            <ListMusic size={30} />
            <strong>{inRoom ? '还没有待播歌曲' : '队列还是空的'}</strong>
            <p>
              {inRoom
                ? '从歌单或搜索中选一首，推荐给大家。'
                : '播放歌单或搜索结果后，歌曲会出现在这里。'}
            </p>
          </div>
        )}
        {loading && <p className="queue-loading">正在读取歌曲信息…</p>}
        {inRoom && roomQueue.loading && (
          <p className="queue-loading">正在读取完整待播列表 · 已获取 {queued.length} 首…</p>
        )}
        <div ref={queueSentinel} className="pagination-sentinel" aria-hidden="true" />
      </div>
      <div className="queue-drawer-footer">
        {inRoom ? '待播顺序由一起听房间同步' : '个人播放队列'}
      </div>
      {removing && (
        <Overlay title="删除自己的推荐？" onClose={() => setRemoving(null)}>
          <p className="overlay-intro">将「{removing.track.name}」从房间待播列表移除。</p>
          {p.error && (
            <p className="private-error" role="alert">
              {p.error}
            </p>
          )}
          <div className="row-actions">
            <button className="secondary" onClick={() => setRemoving(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!!p.busy}
              onClick={() =>
                p.act('删除推荐', async () => {
                  await p.recommendOperation('multiRemove', removing)
                  setRemoving(null)
                })
              }
            >
              确认删除推荐
            </button>
          </div>
        </Overlay>
      )}
    </aside>
  )
}

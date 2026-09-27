import { useEffect, useRef, useState } from 'react'
import { ListMusic, Music2, Play, RefreshCw, X } from 'lucide-react'
import type { Song } from '../../../shared/types'
import type { useParty } from '../useParty'
import { waitingCount, waitingSongs } from '../../../shared/playback-queue'
import { toSong } from '../../../shared/protocol'

export function QueueDrawer({
  party: p,
  onClose,
}: {
  party: ReturnType<typeof useParty>
  onClose(): void
}) {
  const [limit, setLimit] = useState(100)
  const [tracks, setTracks] = useState<Record<string, Song | null>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const cache = useRef<Record<string, Song | null>>({})
  const drawer = useRef<HTMLElement>(null)
  const inRoom = !!p.room
  const scope = `${p.account?.userId || 'guest'}:${p.room?.roomId || 'personal'}`
  const queued = p.room
    ? waitingSongs(p.roomPlayback?.nextSongs || [], p.roomPlayback?.song?.songBizId)
    : []
  const ids = (p.room ? queued.map((song) => song.songId) : p.personalQueue).slice(0, limit)
  const idsKey = ids.join(',')
  useEffect(() => {
    cache.current = {}
    setTracks({})
    setLimit(100)
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
    const previous = document.activeElement as HTMLElement | null
    drawer.current?.querySelector<HTMLButtonElement>('[aria-label="关闭播放队列"]')?.focus()
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('keydown', close)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  const title = inRoom ? '房间待播列表' : '播放队列'
  const count = inRoom ? waitingCount(p.roomPlayback) : p.personalQueue.length
  const entries = inRoom
    ? queued.slice(0, limit)
    : ids.map((songId, index) => ({ songId, songBizId: `${index}`, songRcmdUid: '' }))
  return (
    <aside
      className="queue-drawer"
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
            disabled={!!p.busy}
            onClick={() => p.act('刷新待播列表', p.observe)}
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
            <span>
              <strong>{p.current.name}</strong>
              <small>{p.current.artist}</small>
            </span>
            <span className={`equalizer ${p.playing ? 'playing' : ''}`} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
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
        {error && (
          <p className="queue-error" role="alert">
            {error}
          </p>
        )}
        {entries.map((entry, index) => {
          const track = tracks[entry.songId]
          const member = p.members.find((member) => member.uid === entry.songRcmdUid)
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
                <strong>
                  {track?.name || (track === null ? '歌曲信息暂不可用' : '正在读取歌曲…')}
                </strong>
                <small>
                  {track?.artist || '—'}
                  {inRoom && member ? ` · ${member.nickname} 推荐` : ''}
                </small>
              </span>
              {!inRoom && <Play size={15} className="queue-track-play" />}
            </>
          )
          return inRoom ? (
            <div className="queue-track" key={entry.songBizId}>
              {content}
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
        {!entries.length && !loading && (!inRoom || !!p.roomPlayback) && (
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
        {inRoom && count !== undefined && count > queued.length && (
          <p className="queue-loading">
            房间当前提供接下来 {queued.length} 首，后续歌曲会随播放更新。
          </p>
        )}
        {(inRoom ? queued.length : p.personalQueue.length) > limit && (
          <button className="text-btn load-more" onClick={() => setLimit((value) => value + 100)}>
            显示更多
          </button>
        )}
      </div>
      <div className="queue-drawer-footer">
        {inRoom ? '待播顺序由一起听房间同步' : '个人播放队列'}
      </div>
    </aside>
  )
}

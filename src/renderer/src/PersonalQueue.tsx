import { useSongCollection } from './useLibrary'
import type { ApiCall } from './music-data'
import type { RepeatMode } from '../../shared/personal-queue'
export function PersonalQueue({
  api,
  ids,
  currentIndex,
  room,
  mode,
  onMode,
  onPlay,
  onClear,
}: {
  api: ApiCall
  ids: string[]
  currentIndex: number
  room: boolean
  mode: RepeatMode
  onMode(mode: RepeatMode): void
  onPlay(index: number): void
  onClear(): void
}) {
  const collection = useSongCollection(api, { key: ids.join(','), title: '个人队列', ids })
  return (
    <section>
      <div className="section-title">
        <div>
          <h2>个人播放队列</h2>
          <p>
            {ids.length} 首{room ? ' · 已保留，离开房间后可继续播放' : ''}
          </p>
        </div>
        <div className="row-actions">
          <select
            aria-label="播放模式"
            value={mode}
            onChange={(e) => onMode(e.target.value as RepeatMode)}
          >
            <option value="order">顺序播放</option>
            <option value="loop">列表循环</option>
            <option value="single">单曲循环</option>
          </select>
          <button className="secondary" onClick={onClear}>
            清空个人队列
          </button>
        </div>
      </div>
      {collection.error && <p role="alert">{collection.error}</p>}
      <div className="queue-list">
        {collection.songs.map((song) => {
          const i = ids.indexOf(song.id)
          return (
            <button
              disabled={room}
              key={song.id}
              className={i === currentIndex ? 'selected' : ''}
              onClick={() => onPlay(i)}
            >
              <span>{i + 1}</span>
              <strong>{song.name}</strong>
              <small>{song.artist}</small>
            </button>
          )
        })}
      </div>
      {!ids.length && <div className="empty">播放歌单或搜索结果后，歌曲会出现在这里</div>}
      {collection.loading && <p className="muted">正在读取队列…</p>}
      {collection.more && (
        <button
          className="secondary load-more"
          onClick={collection.loadMore}
          disabled={collection.loading}
        >
          加载更多
        </button>
      )}
    </section>
  )
}

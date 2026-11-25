import { ui } from '../../../shared/ui-language'
import { PanelHeader } from '../windows/Surface'
import { type CSSProperties, useEffect, useState } from 'react'
import { ArrowUpToLine, ListMusic, Music2, Play, Repeat2, Sparkles, Trash2 } from 'lucide-react'
import type { QueueSong, RoomQueueEntry } from '../../../shared/types'
import type { useParty } from '../useParty'
import { waitingCount } from '../../../shared/playback-queue'
import { MusicianNames } from '../MusicianNames'
import { useQueueTracks } from './useQueueTracks'
import { useRoomQueue } from '../useRoomQueue'
import { Overlay } from './Overlay'
import { useScrollPagination } from '../useScrollPagination'

export const queueTitle = (inRoom: boolean) =>
  inRoom ? ui('房间待播列表', 'Room queue') : ui('个人播放队列', 'Personal queue')

export function QueueDrawer({
  party: p,
  closing,
  inTrail,
  onArtist,
}: {
  party: ReturnType<typeof useParty>
  closing: boolean
  inTrail: boolean
  onArtist: (id: string, name: string) => void
}) {
  const [limit, setLimit] = useState(100)
  const [historyLimit, setHistoryLimit] = useState(100)
  const [historyRoomId, setHistoryRoomId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<RoomQueueEntry | null>(null)
  const roomId = p.room?.roomId
  const inRoom = !!roomId
  const historyTab = inRoom && historyRoomId === roomId
  const roomQueue = useRoomQueue(
    p.api,
    roomId,
    p.roomPlayback?.version,
    !closing && !historyTab,
    p.queueRevision,
  )
  const history = useRoomQueue(
    p.api,
    roomId,
    p.roomPlayback?.version,
    !closing && historyTab,
    0,
    'multiPlayed',
    historyLimit,
  )
  const activeList = historyTab ? history : roomQueue
  const scope = `${p.account?.userId || 'guest'}:${p.room?.roomId || 'personal'}`
  const currentIndex = roomQueue.entries.findIndex(
    (entry) => entry.songBizId === p.roomPlayback?.song?.songBizId,
  )
  const officialSong = p.roomPlayback?.song
  const roomSong = inRoom ? officialSong : null
  const recommenderName = (song: QueueSong, entry?: Partial<RoomQueueEntry>) => {
    if (!song.songRcmdUid || song.songRcmdUid === '0')
      return ui('系统推荐', 'System recommendation')
    const member = p.members.find((member) => member.uid === song.songRcmdUid)
    const nickname = entry?.songRcmdUid === song.songRcmdUid ? entry.recommender?.trim() : ''
    return ui(
      '{0} 推荐',
      'Recommended by {0}',
      nickname || member?.nickname || ui('用户 {0}', 'User {0}', song.songRcmdUid),
    )
  }
  const currentRecommender = roomSong
    ? recommenderName(roomSong, roomQueue.entries[currentIndex])
    : ''
  const queued = currentIndex < 0 ? roomQueue.entries : roomQueue.entries.slice(currentIndex + 1)
  const ids = p.room ? [] : p.personalQueue.slice(0, limit)
  const historyRows = history.entries.filter((entry) => entry.songBizId !== roomSong?.songBizId)
  const visibleRoomRows = historyTab ? historyRows.slice(0, historyLimit) : queued.slice(0, limit)
  const currentSongId = inRoom ? roomSong?.songId : p.current?.id
  const detailIds = inRoom ? visibleRoomRows.map((entry) => entry.songId) : [...ids]
  if (!historyTab && currentSongId && !detailIds.includes(currentSongId))
    detailIds.push(currentSongId)
  const { tracks, loading, error, retry } = useQueueTracks(p.api, scope, closing ? [] : detailIds)
  const nowPlaying = inRoom
    ? roomQueue.entries[currentIndex]?.track ||
      (p.current?.id === officialSong?.songId ? p.current : null) ||
      (officialSong ? tracks[officialSong.songId] : null)
    : p.current
  const nowPlayingCredits = nowPlaying
    ? tracks[nowPlaying.id]?.artists ||
      (p.current?.id === nowPlaying.id ? p.current.artists : undefined) ||
      nowPlaying.artists
    : undefined
  const listError = (inRoom && activeList.error) || error
  const queueSentinel = useScrollPagination({
    enabled: !closing,
    scope: historyTab ? scope + ':history' : scope,
    loading: inRoom ? activeList.loading : loading,
    hasMore: historyTab
      ? !history.complete || historyRows.length > historyLimit
      : (inRoom ? queued.length : p.personalQueue.length) > limit,
    blocked: inRoom ? !!activeList.error : !!error,
    contentKey: historyTab ? historyLimit : limit,
    onLoad: () => (historyTab ? setHistoryLimit : setLimit)((value) => value + 100),
  })
  useEffect(() => {
    setLimit(100)
    setHistoryLimit(100)
    setHistoryRoomId(null)
    setRemoving(null)
  }, [scope])
  useEffect(() => {
    if (!inTrail) setHistoryRoomId(null)
  }, [inTrail])
  const count = inRoom
    ? roomQueue.complete
      ? queued.length
      : waitingCount(p.roomPlayback)
    : p.personalQueue.length
  const entries: (QueueSong & Partial<RoomQueueEntry>)[] = inRoom
    ? visibleRoomRows
    : ids.map((songId, index) => ({ songId, songBizId: `${index}`, songRcmdUid: '' }))
  return (
    <aside
      className="queue-drawer"
      data-room={inRoom}
      data-closing={closing}
      aria-hidden={closing}
      inert={closing}
      role="dialog"
      aria-label={queueTitle(inRoom)}
      aria-modal="false"
    >
      {!inRoom && (
        <PanelHeader>
          <div className="panel-inline-actions">
            <small className="queue-total">
              {ui('{0} 首', count === 1 ? '{0} track' : '{0} tracks', count)}
            </small>
          </div>
        </PanelHeader>
      )}
      {!inRoom && (
        <div className="queue-toolbar">
          <select
            aria-label={ui('播放模式', 'Playback mode')}
            value={p.repeatMode}
            onChange={(event) => p.changeRepeat(event.target.value as 'order' | 'loop' | 'single')}
          >
            <option value="order">{ui('顺序播放', 'Play in order')}</option>
            <option value="loop">{ui('列表循环', 'Repeat all')}</option>
            <option value="single">{ui('单曲循环', 'Repeat one')}</option>
          </select>
          <button
            className="text-btn"
            disabled={!p.personalQueue.length}
            onClick={p.clearPersonalQueue}
          >
            <Trash2 size={13} />
            {ui('清空队列', 'Clear queue')}
          </button>
        </div>
      )}
      {inRoom && (
        <div
          className="room-queue-tabs filter-tabs"
          role="tablist"
          aria-label={ui('房间队列', 'Room queue')}
        >
          {(['listening', 'history'] as const).map((tab) => {
            const selected = tab === (historyTab ? 'history' : 'listening')
            return (
              <button
                key={tab}
                type="button"
                id={'queue-tab-' + tab}
                role="tab"
                aria-controls="room-queue-content"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setHistoryRoomId(tab === 'history' ? roomId : null)}
                onKeyDown={(event) => {
                  const tabs =
                    event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    )
                  let index: number
                  switch (event.key) {
                    case 'Home':
                      index = 0
                      break
                    case 'End':
                      index = tabs.length - 1
                      break
                    case 'ArrowLeft':
                    case 'ArrowRight':
                      index = tab === 'listening' ? 1 : 0
                      break
                    default:
                      return
                  }
                  event.preventDefault()
                  tabs[index].focus()
                  tabs[index].click()
                }}
              >
                {tab === 'listening'
                  ? ui('正在听', 'Now listening')
                  : ui('听过的', 'Previously played')}
              </button>
            )
          })}
        </div>
      )}
      {inRoom && !historyTab && (
        <div className="queue-toolbar room-queue-order">
          <Repeat2 size={13} />
          <span>{ui('按顶歌排序', 'Ranked by upvotes')}</span>
          <small>{ui('待播顺序由一起听房间同步', 'Queue order is synced with the room')}</small>
        </div>
      )}
      <div
        key={historyTab ? 'history' : 'queue'}
        role={inRoom ? 'tabpanel' : undefined}
        id={inRoom ? 'room-queue-content' : undefined}
        aria-labelledby={
          inRoom ? (historyTab ? 'queue-tab-history' : 'queue-tab-listening') : undefined
        }
        data-list-viewport=""
        className="queue-drawer-list"
        style={
          inRoom
            ? undefined
            : ({
                '--queue-last-index': `"${String(p.personalQueue.length).padStart(2, '0')}"`,
              } as CSSProperties)
        }
      >
        {!historyTab && nowPlaying && (inRoom || ids[p.personalIndex] !== nowPlaying.id) && (
          <div className="queue-playing">
            <span className="queue-section-label">{ui('正在播放', 'Now playing')}</span>
            <div>
              <div className="queue-playing-art">
                {nowPlaying.cover ? (
                  <img src={nowPlaying.cover} alt="" />
                ) : (
                  <span className="queue-art-placeholder">
                    <Music2 size={20} />
                  </span>
                )}
                <span className={`equalizer ${p.playing ? 'playing' : ''}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <span className="queue-playing-copy">
                {currentRecommender && (
                  <span className="queue-track-overline" title={currentRecommender}>
                    {(!roomSong?.songRcmdUid || roomSong.songRcmdUid === '0') && (
                      <Sparkles size={11} aria-hidden="true" />
                    )}
                    <span>{currentRecommender}</span>
                  </span>
                )}
                <strong>{nowPlaying.name}</strong>
                <small>
                  <MusicianNames
                    credits={nowPlayingCredits}
                    fallback={nowPlaying.artist}
                    onOpen={onArtist}
                  />
                </small>
              </span>
            </div>
          </div>
        )}
        {!historyTab && entries.length > 0 && (
          <div className="queue-section-label">
            {inRoom
              ? count === undefined
                ? ui('接下来播放', 'Up next')
                : ui('接下来播放（{0}）', 'Up next ({0})', count)
              : ui('队列中的歌曲', 'Queued songs')}
          </div>
        )}
        {listError && (
          <p className="queue-error" role="alert">
            {listError}
            <button
              className="text-btn"
              onClick={() => {
                if (inRoom && activeList.error) activeList.refresh()
                if (error) retry()
              }}
            >
              {ui('重试', 'Retry')}
            </button>
          </p>
        )}
        {entries.map((entry, index) => {
          const current = p.current?.id === entry.songId ? p.current : undefined
          const detail = tracks[entry.songId]
          const track = entry.track || current || detail
          const recommender = recommenderName(entry, entry)
          const title =
            track?.name ||
            (track === null
              ? ui('歌曲信息暂不可用', 'Song details unavailable')
              : ui('正在读取歌曲…', 'Loading song…'))
          return (
            <div
              className={`queue-track ${!inRoom && index === p.personalIndex ? 'current' : ''}`}
              key={entry.songBizId}
              aria-current={!inRoom && index === p.personalIndex ? true : undefined}
            >
              {!inRoom && <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>}
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
                    {(!entry.songRcmdUid || entry.songRcmdUid === '0') && (
                      <Sparkles size={11} aria-hidden="true" />
                    )}
                    <span>{recommender}</span>
                  </span>
                )}
                <strong>
                  {inRoom ? (
                    title
                  ) : (
                    <button
                      type="button"
                      className="queue-row-play"
                      disabled={!!p.busy}
                      title={track?.name ? ui('播放《{0}》', 'Play “{0}”', track.name) : undefined}
                      aria-label={ui('播放队列第 {0} 首', 'Play queue item {0}', index + 1)}
                      onClick={() =>
                        p.act(ui('播放队列', 'Play queue'), () => p.playQueueIndex(index))
                      }
                    >
                      {title}
                    </button>
                  )}
                </strong>
                <small>
                  <MusicianNames
                    credits={detail?.artists || current?.artists || track?.artists}
                    fallback={track?.artist || '—'}
                    onOpen={onArtist}
                  />
                </small>
              </span>
              {!inRoom &&
                (index === p.personalIndex ? (
                  <span
                    className={`equalizer ${p.playing ? 'playing' : ''}`}
                    aria-label={ui('正在播放', 'Now playing')}
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <Play size={15} className="queue-track-play" />
                ))}
              {inRoom && !historyTab && (
                <div className="queue-entry-actions">
                  <button
                    className="icon-btn"
                    aria-label={ui('顶歌 {0}', 'Upvote {0}', track?.name || entry.songId)}
                    title={ui('UP 顶歌，提高待播优先级', 'Upvote to move this song up the queue')}
                    disabled={!!p.busy || entry.uped}
                    onClick={() =>
                      p.act(ui('顶歌', 'Upvote'), () =>
                        p.recommendOperation('multiUp', entry as RoomQueueEntry),
                      )
                    }
                  >
                    <ArrowUpToLine size={15} />
                    <small>{entry.upCountKnown === false ? '' : entry.upCount}</small>
                  </button>
                  {entry.songRcmdUid === String(p.account?.userId) && (
                    <button
                      className="icon-btn"
                      aria-label={ui(
                        '删除推荐 {0}',
                        'Remove recommendation: {0}',
                        track?.name || entry.songId,
                      )}
                      title={ui('删除自己的推荐', 'Remove your recommendation')}
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
              )}
            </div>
          )
        })}
        {inRoom && !historyTab && !p.roomPlayback && (
          <p className="queue-loading">{ui('正在同步房间待播列表…', 'Syncing room queue…')}</p>
        )}
        {historyTab && history.loading && (
          <p className="queue-loading" role="status">
            {ui('正在读取播放历史…', 'Loading listening history…')}
          </p>
        )}
        {!entries.length && !listError && !loading && (!inRoom || activeList.complete) && (
          <div className="queue-empty">
            <ListMusic size={30} />
            <strong>
              {historyTab
                ? ui('还没有听过的歌曲', 'No listening history yet')
                : inRoom
                  ? ui('还没有待播歌曲', 'No upcoming songs')
                  : ui('队列还是空的', 'Your queue is empty')}
            </strong>
            {!historyTab && (
              <p>
                {inRoom
                  ? ui(
                      '从歌单或搜索中选一首，推荐给大家。',
                      'Recommend a song from a playlist or search.',
                    )
                  : ui(
                      '播放歌单或搜索结果后，歌曲会出现在这里。',
                      'Play a playlist or a search result to add songs here.',
                    )}
              </p>
            )}
          </div>
        )}
        {loading && (
          <p className="queue-loading">{ui('正在读取歌曲信息…', 'Loading song details…')}</p>
        )}
        <div ref={queueSentinel} className="pagination-sentinel" aria-hidden="true" />
      </div>
      {removing && (
        <Overlay
          title={ui('删除自己的推荐？', 'Remove your recommendation?')}
          onClose={() => setRemoving(null)}
        >
          <p className="overlay-intro">
            {ui(
              '将「{0}」从房间待播列表移除。',
              'Remove “{0}” from the room queue.',
              removing.track.name,
            )}
          </p>
          {p.error && (
            <p className="private-error" role="alert">
              {p.error}
            </p>
          )}
          <div className="row-actions">
            <button className="secondary" onClick={() => setRemoving(null)}>
              {ui('取消', 'Cancel')}
            </button>
            <button
              className="primary"
              disabled={!!p.busy}
              onClick={() =>
                p.act(ui('删除推荐', 'Remove recommendation'), async () => {
                  await p.recommendOperation('multiRemove', removing)
                  setRemoving(null)
                })
              }
            >
              {ui('确认删除推荐', 'Remove recommendation')}
            </button>
          </div>
        </Overlay>
      )}
    </aside>
  )
}

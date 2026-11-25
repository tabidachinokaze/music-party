import { t } from '../../../shared/ui-language'
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
  inRoom ? t('queueDrawer.roomQueue') : t('queueDrawer.personalQueue')

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
    if (!song.songRcmdUid || song.songRcmdUid === '0') return t('common.systemRecommendation')
    const member = p.members.find((member) => member.uid === song.songRcmdUid)
    const nickname = entry?.songRcmdUid === song.songRcmdUid ? entry.recommender?.trim() : ''
    return t('room.recommendedBy', {
      nickname: nickname || member?.nickname || t('common.userId', { uid: song.songRcmdUid }),
    })
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
              {t('music.trackCount', { count: p.personalQueue.length })}
            </small>
          </div>
        </PanelHeader>
      )}
      {!inRoom && (
        <div className="queue-toolbar">
          <select
            aria-label={t('queueDrawer.playbackMode')}
            value={p.repeatMode}
            onChange={(event) => p.changeRepeat(event.target.value as 'order' | 'loop' | 'single')}
          >
            <option value="order">{t('queueDrawer.playInOrder')}</option>
            <option value="loop">{t('common.repeatAll')}</option>
            <option value="single">{t('common.repeatOne')}</option>
          </select>
          <button
            className="text-btn"
            disabled={!p.personalQueue.length}
            onClick={p.clearPersonalQueue}
          >
            <Trash2 size={13} />
            {t('queueDrawer.clearQueue')}
          </button>
        </div>
      )}
      {inRoom && (
        <div
          className="room-queue-tabs filter-tabs"
          role="tablist"
          aria-label={t('queueDrawer.roomQueueTab')}
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
                  ? t('queueDrawer.nowListening')
                  : t('queueDrawer.previouslyPlayed')}
              </button>
            )
          })}
        </div>
      )}
      {inRoom && !historyTab && (
        <div className="queue-toolbar room-queue-order">
          <Repeat2 size={13} />
          <span>{t('queueDrawer.rankedByUpvotes')}</span>
          <small>{t('queueDrawer.queueOrderIsSyncedWithTheRoom')}</small>
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
            <span className="queue-section-label">{t('common.nowPlaying')}</span>
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
                ? t('queueDrawer.upNext')
                : t('queueDrawer.upNextCount', { count })
              : t('queueDrawer.queuedSongs')}
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
              {t('common.retry')}
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
              ? t('queueDrawer.songDetailsUnavailable')
              : t('queueDrawer.loadingSong'))
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
                      title={track?.name ? t('queueDrawer.play', { name: track.name }) : undefined}
                      aria-label={t('queueDrawer.playQueueItem', { count: index + 1 })}
                      onClick={() => p.act(t('common.playQueue'), () => p.playQueueIndex(index))}
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
                    aria-label={t('common.nowPlaying')}
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
                    aria-label={t('common.upvote', { name: track?.name || entry.songId })}
                    title={t('queueDrawer.upvoteToMoveThisSongUpTheQueue')}
                    disabled={!!p.busy || entry.uped}
                    onClick={() =>
                      p.act(t('membersDrawer.upvoteAction'), () =>
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
                      aria-label={t('common.removeRecommendation', {
                        name: track?.name || entry.songId,
                      })}
                      title={t('queueDrawer.removeYourRecommendation')}
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
          <p className="queue-loading">{t('queueDrawer.syncingRoomQueue')}</p>
        )}
        {historyTab && history.loading && (
          <p className="queue-loading" role="status">
            {t('queueDrawer.loadingListeningHistory')}
          </p>
        )}
        {!entries.length && !listError && !loading && (!inRoom || activeList.complete) && (
          <div className="queue-empty">
            <ListMusic size={30} />
            <strong>
              {historyTab
                ? t('queueDrawer.noListeningHistoryYet')
                : inRoom
                  ? t('queueDrawer.noUpcomingSongs')
                  : t('queueDrawer.yourQueueIsEmpty')}
            </strong>
            {!historyTab && (
              <p>
                {inRoom
                  ? t('queueDrawer.recommendASongFromAPlaylistOrSearch')
                  : t('queueDrawer.playAPlaylistOrASearchResultTo')}
              </p>
            )}
          </div>
        )}
        {loading && <p className="queue-loading">{t('queueDrawer.loadingSongDetails')}</p>}
        <div ref={queueSentinel} className="pagination-sentinel" aria-hidden="true" />
      </div>
      {removing && (
        <Overlay title={t('common.removeYourRecommendation')} onClose={() => setRemoving(null)}>
          <p className="overlay-intro">
            {t('common.removeFromTheRoomQueue', { name: removing.track.name })}
          </p>
          {p.error && (
            <p className="private-error" role="alert">
              {p.error}
            </p>
          )}
          <div className="row-actions">
            <button className="secondary" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="primary"
              disabled={!!p.busy}
              onClick={() =>
                p.act(t('membersDrawer.removeRecommendation'), async () => {
                  await p.recommendOperation('multiRemove', removing)
                  setRemoving(null)
                })
              }
            >
              {t('membersDrawer.confirmRemoveRecommendation')}
            </button>
          </div>
        </Overlay>
      )}
    </aside>
  )
}

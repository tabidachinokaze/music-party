import { t } from '../../shared/ui-language'
import { useEffect, useRef, useState } from 'react'
import { Disc3, Library, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import type { Playlist, Song } from '../../shared/types'
import { writablePlaylists } from './music-data'
import { PanelHeader } from './windows/Surface'
import { IconButton } from './design/Primitives'

type AddResult =
  { name: string; state: 'added' | 'exists' } | { name: string; state: 'failed'; reason: string }

export function AddToPlaylist({
  addSongToPlaylist,
  uid,
  song,
  playlists,
  loading,
  error,
  onRefresh,
  onComplete,
}: {
  addSongToPlaylist(playlistId: string, songId: string): Promise<boolean>
  uid: string
  song: Song
  playlists: Playlist[]
  loading: boolean
  error: string
  onRefresh(): void
  onComplete(message: string): void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(new Set<string>())
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(new Map<string, AddResult>())
  const lock = useRef(false)
  const epoch = useRef(0)
  useEffect(() => {
    epoch.current++
    return () => {
      epoch.current++
    }
  }, [uid])
  const writable = writablePlaylists(playlists, uid)
  const visible = writable.filter((playlist) =>
    playlist.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  const targets = writable.filter((playlist) => selected.has(playlist.id))
  const failedCount = targets.filter(
    (playlist) => results.get(playlist.id)?.state === 'failed',
  ).length
  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  async function submit() {
    if (!targets.length || lock.current) return
    const run = epoch.current
    lock.current = true
    setBusy(true)
    const writes = await Promise.allSettled(
      targets.map((playlist) => addSongToPlaylist(playlist.id, song.id)),
    )
    if (epoch.current !== run) return
    const next = new Map(results)
    const retry = new Set<string>()
    writes.forEach((write, index) => {
      const { id, name } = targets[index]
      if (write.status === 'fulfilled') {
        next.set(id, { name, state: write.value ? 'exists' : 'added' })
      } else {
        retry.add(id)
        next.set(id, {
          name,
          state: 'failed',
          reason:
            write.reason?.message || t('addToPlaylist.couldNotConfirmWhetherTheTrackWasAdded'),
        })
      }
    })
    lock.current = false
    setBusy(false)
    setResults(next)
    if (retry.size) {
      setSelected(retry)
      setQuery('')
      return
    }
    const completed = [...next.values()].filter((item) => item.state !== 'failed')
    if (completed.length === 1) {
      const { name, state } = completed[0]
      onComplete(
        state === 'exists'
          ? t('addToPlaylist.alreadyIn', { name })
          : t('addToPlaylist.addedTo', { name }),
      )
      return
    }
    const added = completed.filter((item) => item.state === 'added').length
    const existed = completed.length - added
    onComplete(
      [
        added && t('playlist.addedCount', { count: added }),
        existed && t('playlist.existingCount', { count: existed }),
      ]
        .filter(Boolean)
        .join(t('addToPlaylist.value')),
    )
  }
  return (
    <>
      <PanelHeader>
        <div className="playlist-add-actions">
          <IconButton
            label={t('addToPlaylist.refreshPlaylists')}
            disabled={busy || loading}
            onClick={onRefresh}
          >
            <RefreshCw size={16} className={loading ? 'spin' : undefined} />
          </IconButton>
          <button
            className="primary"
            disabled={!targets.length || busy}
            onClick={() => void submit()}
          >
            {busy ? t('common.adding') : t('addToPlaylist.add')}
            {targets.length > 0 && `（${targets.length}）`}
          </button>
        </div>
      </PanelHeader>
      <div className="add-to-playlist">
        <div className="playlist-add-song">
          {song.cover ? <img src={song.cover} alt="" /> : <Disc3 size={24} />}
          <div>
            <strong>{song.name}</strong>
            <span>{song.artist}</span>
          </div>
        </div>
        <label className="playlist-target-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={t('addToPlaylist.searchAvailablePlaylists')}
            placeholder={t('addToPlaylist.searchMyPlaylists')}
            disabled={busy}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div
          data-list-viewport=""
          className="playlist-target-list"
          role="group"
          aria-label={t('addToPlaylist.myPlaylists')}
        >
          {(failedCount > 0 || error) && (
            <div className="alert error" role="alert">
              {[failedCount && t('playlist.failedCount', { count: failedCount }), error]
                .filter(Boolean)
                .join('；')}
            </div>
          )}
          {visible.map((playlist) => {
            const result = results.get(playlist.id)
            const completed = result?.state === 'added' || result?.state === 'exists'
            return (
              <label key={playlist.id} className="playlist-target">
                {playlist.cover ? <img src={playlist.cover} alt="" /> : <Library size={24} />}
                <span>
                  <strong>{playlist.name}</strong>
                  <small>
                    {t('music.trackCount', { count: playlist.count })}
                    {result?.state === 'failed' && ` · ${result.reason}`}
                    {result?.state === 'added' && t('addToPlaylist.added')}
                    {result?.state === 'exists' && t('addToPlaylist.alreadyAdded')}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={selected.has(playlist.id) || completed}
                  disabled={busy || completed}
                  onChange={() => toggle(playlist.id)}
                />
              </label>
            )
          })}
          {loading && (
            <p className="loading">
              <LoaderCircle size={16} className="spin" />
              {t('addToPlaylist.loadingPlaylists')}
            </p>
          )}
          {!loading && !error && !visible.length && (
            <p className="playlist-add-empty">
              {query.trim()
                ? t('common.noMatchingPlaylists')
                : t('addToPlaylist.noAvailablePlaylistsCreateAPlaylistInNetease')}
            </p>
          )}
        </div>
      </div>
    </>
  )
}

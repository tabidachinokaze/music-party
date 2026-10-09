import { useEffect, useRef, useState } from 'react'
import { Check, Library, LoaderCircle, Search } from 'lucide-react'
import type { Playlist, Song } from '../../shared/types'
import { writablePlaylists, type ApiCall } from './music-data'
import { Overlay } from './player/Overlay'

export function AddToPlaylist({
  api,
  uid,
  song,
  playlists,
  loading,
  error,
  onRefresh,
  onClose,
  onAdded,
}: {
  api: ApiCall
  uid: string
  song: Song
  playlists: Playlist[]
  loading: boolean
  error: string
  onRefresh(): void
  onClose(): void
  onAdded(playlist: Playlist, alreadyExists: boolean): void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const lock = useRef(false)
  const epoch = useRef(0)
  useEffect(() => {
    epoch.current++
    return () => {
      epoch.current++
    }
  }, [uid])
  const writable = writablePlaylists(playlists, uid)
  const target = writable.find((playlist) => playlist.id === selected)
  const visible = writable.filter((playlist) =>
    playlist.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  async function submit() {
    if (!target || lock.current) return
    const run = epoch.current
    lock.current = true
    setBusy(true)
    setFailure('')
    try {
      const body = await api('playlistAdd', { uid, playlistId: target.id, songId: song.id })
      if (run === epoch.current) onAdded(target, body.alreadyExists === true)
    } catch (error: any) {
      if (run === epoch.current) setFailure(error.message || '添加结果未确认，请刷新歌单后重试')
    } finally {
      if (run === epoch.current) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  return (
    <Overlay title="添加歌曲到歌单" onClose={onClose}>
      <div className="add-to-playlist">
        <p className="playlist-add-song">
          <strong>{song.name}</strong>
          <span>{song.artist}</span>
        </p>
        <label className="playlist-target-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索可添加的歌单"
            placeholder="搜索我创建的歌单"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {failure && (
          <div className="alert error" role="alert">
            {failure}
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="playlist-target-list" aria-label="我创建的歌单">
          {visible.map((playlist) => (
            <button
              key={playlist.id}
              className="playlist-target"
              aria-pressed={playlist.id === selected}
              disabled={busy}
              onClick={() => setSelected(playlist.id)}
            >
              {playlist.cover ? <img src={playlist.cover} alt="" /> : <Library size={24} />}
              <span>
                <strong>{playlist.name}</strong>
                <small>{playlist.count} 首</small>
              </span>
              {playlist.id === selected && <Check size={18} aria-hidden="true" />}
            </button>
          ))}
        </div>
        {loading && (
          <p className="loading">
            <LoaderCircle size={16} className="spin" />
            正在读取歌单…
          </p>
        )}
        {!loading && !visible.length && (
          <p className="playlist-add-empty">
            {query.trim() ? '没有找到匹配歌单' : '没有可添加的歌单，请先在网易云创建歌单'}
          </p>
        )}
        <p className="playlist-add-hint">添加到“喜欢的音乐”请使用歌曲红心按钮。</p>
        <div className="playlist-add-actions">
          <button className="secondary" disabled={busy || loading} onClick={onRefresh}>
            刷新歌单
          </button>
          <button className="primary" disabled={!target || busy} onClick={() => void submit()}>
            {busy && <LoaderCircle size={15} className="spin" />}
            {busy ? '正在添加…' : '确认添加'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

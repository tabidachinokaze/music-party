import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Heart,
  Library,
  LoaderCircle,
  Music2,
  Play,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import type { Artist, Playlist, SearchKind, Song } from '../../shared/types'
import { toSong } from '../../shared/protocol'
import { artistFrom, playlistFrom, type ApiCall } from './music-data'
import { useSongCollection, type useLibrary } from './useLibrary'

type LibraryState = ReturnType<typeof useLibrary>
type Source = { key: string; title: string; playlistId?: string; artistId?: string; ids?: string[] }
export function SongRows({
  songs,
  ids,
  room,
  currentId,
  busy,
  library,
  onPlay,
  onLike,
}: {
  songs: Song[]
  ids?: string[]
  room: boolean
  currentId?: string
  busy: boolean
  library: LibraryState
  onPlay(song: Song, ids?: string[]): void
  onLike(song: Song): void
}) {
  return (
    <div className="song-list">
      <div className="song-row list-label">
        <span>#</span>
        <span>歌曲 / 歌手</span>
        <span>专辑</span>
        <span>时长</span>
        <span />
      </div>
      {songs.map((song, index) => (
        <div
          className={`song-row ${currentId === song.id ? 'is-playing' : ''}`}
          key={`${song.id}-${index}`}
          onDoubleClick={() => onPlay(song, ids || songs.map((item) => item.id))}
        >
          <span className="song-index">{String(index + 1).padStart(2, '0')}</span>
          <div className="song-title">
            {song.cover && <img src={song.cover} alt="" />}
            <div>
              <strong>{song.name}</strong>
              <small>{song.artist}</small>
            </div>
          </div>
          <span className="album">{song.album}</span>
          <span>
            {Math.floor(song.duration / 60000)}:
            {String(Math.floor(song.duration / 1000) % 60).padStart(2, '0')}
          </span>
          <div className="song-actions">
            <button
              className={`icon-btn ${library.likes.has(song.id) ? 'liked' : ''}`}
              aria-label={`${library.likes.has(song.id) ? '取消喜欢' : '喜欢'} ${song.name}`}
              disabled={!library.likesReady || library.likeBusy.has(song.id)}
              onClick={() => onLike(song)}
            >
              <Heart size={15} fill={library.likes.has(song.id) ? 'currentColor' : 'none'} />
            </button>
            <button
              className="icon-btn"
              aria-label={`${room ? '推送' : '播放'} ${song.name}`}
              disabled={busy}
              onClick={() => onPlay(song, ids || songs.map((item) => item.id))}
            >
              {room ? <Plus size={16} /> : <Play size={16} />}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function MusicBrowser({
  api,
  uid,
  view,
  library,
  room,
  currentId,
  busy,
  onPlay,
  onLike,
}: {
  api: ApiCall
  uid: string | null
  view: 'library' | 'liked' | 'search'
  library: LibraryState
  room: boolean
  currentId?: string
  busy: boolean
  onPlay(song: Song, ids?: string[]): void
  onLike(song: Song): void
}) {
  const [source, setSource] = useState<Source | null>(null)
  const [filter, setFilter] = useState<'all' | 'created' | 'collected'>('all')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<SearchKind>('songs')
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('music-party-search-history') || '[]')
      return Array.isArray(value) ? value.filter((x) => typeof x === 'string').slice(0, 10) : []
    } catch {
      return []
    }
  })
  const [songResults, setSongResults] = useState<Song[]>([])
  const [playlistResults, setPlaylistResults] = useState<Playlist[]>([])
  const [artistResults, setArtistResults] = useState<Artist[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchMore, setSearchMore] = useState(false)
  const [searched, setSearched] = useState(false)
  const searchEpoch = useRef(0)
  const searchOffset = useRef(0)
  const searchKey = useRef({ query: '', kind: 'songs' as SearchKind })
  useEffect(() => {
    setSource(null)
  }, [view, uid])
  useEffect(
    () => () => {
      searchEpoch.current++
    },
    [],
  )
  const likedIds = [...library.likes]
  const effectiveSource =
    view === 'liked'
      ? { key: `liked:${uid}:${likedIds.join(',')}`, title: '我喜欢的音乐', ids: likedIds }
      : source
  const collection = useSongCollection(api, effectiveSource)
  async function search(reset: boolean, newKind = kind, newQuery = query) {
    if (!newQuery.trim() || (!reset && searchBusy)) return
    const epoch = ++searchEpoch.current
    const offset = reset ? 0 : searchOffset.current
    if (reset) {
      searchKey.current = { query: newQuery.trim(), kind: newKind }
      setSongResults([])
      setPlaylistResults([])
      setArtistResults([])
      setSource(null)
    }
    const selection = searchKey.current
    if (reset)
      setHistory((old) => {
        const next = [selection.query, ...old.filter((q) => q !== selection.query)].slice(0, 10)
        try {
          localStorage.setItem('music-party-search-history', JSON.stringify(next))
        } catch {}
        return next
      })
    setSearchBusy(true)
    setSearchError('')
    setSearched(true)
    try {
      const byId = selection.kind === 'songs' && /^\d+$/.test(selection.query)
      const body = byId
        ? { result: { songs: (await api('song', { ids: selection.query })).songs, songCount: 1 } }
        : await api('search', { keywords: selection.query, kind: selection.kind, offset })
      if (epoch !== searchEpoch.current) return
      const result = body.result || {}
      const raw =
        selection.kind === 'songs'
          ? result.songs
          : selection.kind === 'playlists'
            ? result.playlists
            : result.artists
      const values = Array.isArray(raw) ? raw : []
      const total = Number(
        result[
          selection.kind === 'songs'
            ? 'songCount'
            : selection.kind === 'playlists'
              ? 'playlistCount'
              : 'artistCount'
        ] || 0,
      )
      searchOffset.current = offset + values.length
      setSearchMore(
        values.length > 0 && (total ? offset + values.length < total : values.length === 30),
      )
      if (selection.kind === 'songs')
        setSongResults((old) => (reset ? values.map(toSong) : [...old, ...values.map(toSong)]))
      else if (selection.kind === 'playlists')
        setPlaylistResults((old) =>
          reset ? values.map(playlistFrom) : [...old, ...values.map(playlistFrom)],
        )
      else
        setArtistResults((old) =>
          reset ? values.map(artistFrom) : [...old, ...values.map(artistFrom)],
        )
    } catch (e: any) {
      if (epoch === searchEpoch.current) setSearchError(e.message)
    } finally {
      if (epoch === searchEpoch.current) setSearchBusy(false)
    }
  }
  function openPlaylist(playlist: Playlist) {
    setSource({ key: `playlist:${playlist.id}`, title: playlist.name, playlistId: playlist.id })
  }
  const cards = (items: Playlist[]) => (
    <div className="playlist-grid">
      {items.map((item) => (
        <button key={item.id} className="playlist-card" onClick={() => openPlaylist(item)}>
          {item.cover ? (
            <img src={item.cover} alt="" loading="lazy" />
          ) : (
            <div className="playlist-art">
              <Library size={36} />
            </div>
          )}
          <strong>{item.name}</strong>
          <small>
            {item.count} 首 · {item.creator}
          </small>
        </button>
      ))}
    </div>
  )
  if (!uid && view !== 'search')
    return (
      <div className="empty">
        <Library size={28} />
        <strong>登录后查看你的音乐库</strong>
        <span>到“一起听”页面扫码连接网易云账号</span>
      </div>
    )
  if (view === 'liked' && !library.likesReady)
    return (
      <section>
        <div className="empty">
          <Heart size={25} />
          <strong>{library.error || '正在读取喜欢的音乐…'}</strong>
          {library.error && (
            <button className="secondary" onClick={library.refresh}>
              重试
            </button>
          )}
        </div>
      </section>
    )
  return (
    <section className="music-browser">
      {room && (
        <div className="room-context">
          <span className="dot" />
          正在官方多人房间中 · 歌曲播放操作会推送到房间
        </div>
      )}
      {effectiveSource ? (
        <>
          <div className="section-title">
            <div>
              {view !== 'liked' && (
                <button className="text-btn" onClick={() => setSource(null)}>
                  <ArrowLeft size={15} />
                  返回
                </button>
              )}
              <h2>{effectiveSource.title}</h2>
              <p>
                已加载 {collection.songs.length} / {collection.total} 首
                {collection.unavailable > 0 ? ` · ${collection.unavailable} 首暂不可用` : ''}
              </p>
            </div>
            {!room && (
              <button
                className="primary"
                disabled={!collection.songs.length || busy}
                onClick={() => onPlay(collection.songs[0], collection.ids)}
              >
                <Play size={15} />
                播放全部
              </button>
            )}
          </div>
          {collection.error && (
            <div className="alert error" role="alert">
              {collection.error}
              <button onClick={collection.retry}>重试</button>
            </div>
          )}
          <SongRows
            songs={collection.songs}
            ids={collection.ids}
            room={room}
            currentId={currentId}
            busy={busy}
            library={library}
            onPlay={onPlay}
            onLike={onLike}
          />
          {collection.loading && (
            <div className="loading">
              <LoaderCircle size={16} className="spin" />
              正在加载歌曲…
            </div>
          )}
          {!collection.loading && !collection.error && !collection.songs.length && (
            <div className="empty">
              <Music2 size={25} />
              <strong>这里还没有歌曲</strong>
            </div>
          )}
          {collection.more && (
            <button
              className="secondary load-more"
              disabled={collection.loading}
              onClick={() => collection.loadMore()}
            >
              加载更多歌曲
            </button>
          )}
        </>
      ) : view === 'library' ? (
        <>
          <div className="section-title">
            <div>
              <h2>我的歌单</h2>
              <p>
                {library.complete ? '全部歌单' : '已加载歌单'} · {library.playlists.length} 个
              </p>
            </div>
            <button className="secondary" disabled={library.loading} onClick={library.refresh}>
              <RefreshCw size={15} />
              刷新音乐库
            </button>
          </div>
          <div className="filter-tabs">
            {(['all', 'created', 'collected'] as const).map((value, i) => (
              <button
                key={value}
                className={filter === value ? 'selected' : ''}
                onClick={() => setFilter(value)}
              >
                {['全部', '我创建的', '我收藏的'][i]}
              </button>
            ))}
          </div>
          {library.error && (
            <div className="alert error" role="alert">
              {library.error}
            </div>
          )}
          {cards(
            library.playlists.filter(
              (item) =>
                filter === 'all' ||
                (filter === 'created' ? item.creatorId === uid : item.creatorId !== uid),
            ),
          )}
          {library.loading && (
            <div className="loading">
              <LoaderCircle size={16} className="spin" />
              正在读取全部歌单…
            </div>
          )}
          {library.complete && !library.playlists.length && (
            <div className="empty">
              <Library size={25} />
              <strong>还没有歌单</strong>
            </div>
          )}
        </>
      ) : (
        <>
          <form
            className="wide-search"
            onSubmit={(e) => {
              e.preventDefault()
              search(true)
            }}
          >
            <Search size={20} />
            <input
              aria-label="搜索音乐库"
              placeholder="搜索歌曲、歌单、歌手"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="primary" disabled={!query.trim()}>
              <ArrowRight size={17} />
              搜索
            </button>
          </form>
          {history.length > 0 && (
            <div className="search-history">
              <span>最近搜索</span>
              {history.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuery(q)
                    search(true, kind, q)
                  }}
                >
                  {q}
                </button>
              ))}
              <button
                className="text-btn"
                onClick={() => {
                  setHistory([])
                  try {
                    localStorage.removeItem('music-party-search-history')
                  } catch {}
                }}
              >
                清空
              </button>
            </div>
          )}
          <div className="filter-tabs">
            {(['songs', 'playlists', 'artists'] as const).map((value, i) => (
              <button
                key={value}
                className={kind === value ? 'selected' : ''}
                onClick={() => {
                  setKind(value)
                  search(true, value)
                }}
              >
                {['歌曲', '歌单', '歌手'][i]}
              </button>
            ))}
          </div>
          {searchError && (
            <div className="alert error" role="alert">
              {searchError}
            </div>
          )}
          {kind === 'songs' && (
            <SongRows
              songs={songResults}
              room={room}
              currentId={currentId}
              busy={busy}
              library={library}
              onPlay={onPlay}
              onLike={onLike}
            />
          )}
          {kind === 'playlists' && cards(playlistResults)}
          {kind === 'artists' && (
            <div className="playlist-grid">
              {artistResults.map((artist) => (
                <button
                  className="playlist-card artist-card"
                  key={artist.id}
                  onClick={() =>
                    setSource({
                      key: `artist:${artist.id}`,
                      title: artist.name,
                      artistId: artist.id,
                    })
                  }
                >
                  {artist.cover ? (
                    <img src={artist.cover} alt="" />
                  ) : (
                    <div className="playlist-art">
                      <Music2 size={30} />
                    </div>
                  )}
                  <strong>{artist.name}</strong>
                  <small>{artist.aliases.join(' / ')}</small>
                </button>
              ))}
            </div>
          )}
          {searchBusy && (
            <div className="loading">
              <LoaderCircle size={16} className="spin" />
              正在搜索…
            </div>
          )}
          {!searchBusy &&
            !searchError &&
            (kind === 'songs'
              ? !songResults.length
              : kind === 'playlists'
                ? !playlistResults.length
                : !artistResults.length) && (
              <div className="empty">
                <Search size={26} />
                <strong>{searched ? '没有找到匹配内容' : '从一首好歌开始'}</strong>
              </div>
            )}
          {searchMore && (
            <button
              className="secondary load-more"
              disabled={searchBusy}
              onClick={() => search(false)}
            >
              加载更多结果
            </button>
          )}
        </>
      )}
    </section>
  )
}

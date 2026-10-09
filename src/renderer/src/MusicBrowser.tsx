import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  Disc3,
  Trash2,
  X,
  Heart,
  Headphones,
  Library,
  LoaderCircle,
  ListPlus,
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
import { useScrollPagination } from './useScrollPagination'
import { AddToPlaylist } from './AddToPlaylist'
import './add-to-playlist.css'
import { BrowserSearch, type BrowserNavigationState } from './BrowserNavigation'

type LibraryState = ReturnType<typeof useLibrary>
export type MusicSource = {
  key: string
  title: string
  playlistId?: string
  albumId?: string
  artistId?: string
  ids?: string[]
}
export function SongRows({
  songs,
  ids,
  room,
  currentId,
  busy,
  library,
  onPlay,
  onLike,
  onAudition,
  onAddToPlaylist,
}: {
  songs: Song[]
  ids?: string[]
  room: boolean
  currentId?: string
  busy: boolean
  library: LibraryState
  onPlay(song: Song, ids?: string[]): void
  onLike(song: Song): void
  onAudition?(song: Song): void
  onAddToPlaylist?(song: Song): void
}) {
  if (!songs.length) return null
  return (
    <div
      className={`song-list ${room && onAudition ? 'has-audition' : ''} ${onAddToPlaylist ? 'has-playlist-action' : ''}`}
    >
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
          <div className="song-actions" onDoubleClick={(event) => event.stopPropagation()}>
            {onAddToPlaylist && (
              <button
                className="icon-btn"
                aria-label={`添加到歌单 ${song.name}`}
                onClick={() => onAddToPlaylist(song)}
              >
                <ListPlus size={16} />
              </button>
            )}
            {room && onAudition && (
              <button
                className="icon-btn"
                aria-label={`试听 ${song.name}`}
                disabled={busy}
                onClick={() => onAudition(song)}
              >
                <Headphones size={15} />
              </button>
            )}
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
  onAudition,
  initialSource,
  onNavigation,
}: {
  api: ApiCall
  uid: string | null
  view: 'library' | 'albums' | 'liked' | 'search'
  library: LibraryState
  room: boolean
  currentId?: string
  busy: boolean
  onPlay(song: Song, ids?: string[]): void
  onLike(song: Song): void
  onAudition?(song: Song): void
  initialSource?: MusicSource
  onNavigation?(navigation: BrowserNavigationState): void
}) {
  const [source, setSource] = useState<MusicSource | null>(() => initialSource || null)
  const [filter, setFilter] = useState<'all' | 'created' | 'collected'>('all')
  const [query, setQuery] = useState('')
  const [listQuery, setListQuery] = useState('')
  const navigationRevision = useRef(0)
  const [inputRevision, setInputRevision] = useState(0)
  const [addSong, setAddSong] = useState<Song | null>(null)
  const [addNotice, setAddNotice] = useState('')
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
  const searchLock = useRef(false)
  const searchOffset = useRef(0)
  const searchKey = useRef({ query: '', kind: 'songs' as SearchKind })
  useEffect(() => {
    setSource(initialSource || null)
  }, [view, uid, initialSource?.key])
  useEffect(() => {
    setAddSong(null)
    setAddNotice('')
  }, [uid, view])
  useEffect(() => {
    searchEpoch.current++
    searchLock.current = false
    searchOffset.current = 0
    setSongResults([])
    setPlaylistResults([])
    setArtistResults([])
    setSearchBusy(false)
    setSearchError('')
    setSearchMore(false)
    setSearched(false)
  }, [uid])
  useEffect(
    () => () => {
      searchEpoch.current++
    },
    [],
  )
  const likedIds = [...library.likes]
  const effectiveSource =
    view === 'liked'
      ? !library.complete && !library.error
        ? null
        : {
            key: `liked:${uid}:${library.likedPlaylist?.id || ''}:${likedIds.join(',')}`,
            title: '我喜欢的音乐',
            ...(library.likedPlaylist
              ? { playlistId: library.likedPlaylist.id }
              : { ids: likedIds }),
          }
      : source
  const collection = useSongCollection(api, effectiveSource)
  const [collectionSearch, setCollectionSearch] = useState({ key: '', text: '' })
  const collectionKey = `${uid}:${view}:${effectiveSource?.key || ''}`
  useEffect(() => setCollectionSearch({ key: collectionKey, text: '' }), [collectionKey])
  const collectionQuery = collectionSearch.key === collectionKey ? collectionSearch.text : ''
  const searchable = !!effectiveSource
  const terms = collectionQuery
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const filtering = searchable && terms.length > 0
  const visibleSongs = filtering
    ? collection.songs.filter((song) => {
        const text = `${song.name} ${song.artist} ${song.album}`
          .normalize('NFKC')
          .toLocaleLowerCase()
        return terms.every((term) => text.includes(term))
      })
    : collection.songs
  const collectionSentinel = useScrollPagination({
    enabled: !!effectiveSource && !filtering,
    scope: collectionKey,
    loading: collection.loading,
    hasMore: collection.more,
    blocked: !!collection.error,
    contentKey: collection.songs.length,
    onLoad: collection.loadMore,
  })
  const resultCount = songResults.length + playlistResults.length + artistResults.length
  const searchSentinel = useScrollPagination({
    enabled: view === 'search' && !effectiveSource,
    scope: `${uid}:${kind}:${searchKey.current.query}`,
    loading: searchBusy,
    hasMore: searchMore,
    blocked: !!searchError,
    contentKey: resultCount,
    onLoad: () => search(false),
  })
  // Search the entire collection, including tracks beyond the first loaded page.
  // Stop on errors; retry remains an explicit user action.
  useEffect(() => {
    if (!filtering || !collection.more || collection.loading || collection.error) return
    const timer = window.setTimeout(() => void collection.loadMore(), 200)
    return () => window.clearTimeout(timer)
  }, [
    collectionKey,
    collectionQuery,
    filtering,
    collection.more,
    collection.loading,
    collection.error,
    collection.songs.length,
  ])

  async function search(reset: boolean, newKind = kind, newQuery = query) {
    if (!newQuery.trim() || (!reset && searchLock.current)) return
    const epoch = ++searchEpoch.current
    searchLock.current = true
    const offset = reset ? 0 : searchOffset.current
    if (reset) {
      searchOffset.current = 0
      searchKey.current = { query: newQuery.trim(), kind: newKind }
      setSongResults([])
      setPlaylistResults([])
      setArtistResults([])
      setSource(null)
      setSearchMore(false)
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
      const previous = reset
        ? []
        : selection.kind === 'songs'
          ? songResults
          : selection.kind === 'playlists'
            ? playlistResults
            : artistResults
      const seen = new Set(previous.map((item) => item.id))
      const fresh = values.filter((item: any) => {
        const id = String(item.id)
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      const total = Number(
        result[
          selection.kind === 'songs'
            ? 'songCount'
            : selection.kind === 'playlists'
              ? 'playlistCount'
              : 'artistCount'
        ] || 0,
      )
      if (values.length && !fresh.length) throw new Error('搜索结果分页未继续前进，请重试')
      searchOffset.current = offset + values.length
      setSearchMore(
        values.length > 0 && (total ? offset + values.length < total : values.length === 30),
      )
      if (selection.kind === 'songs')
        setSongResults((old) => (reset ? fresh.map(toSong) : [...old, ...fresh.map(toSong)]))
      else if (selection.kind === 'playlists')
        setPlaylistResults((old) =>
          reset ? fresh.map(playlistFrom) : [...old, ...fresh.map(playlistFrom)],
        )
      else
        setArtistResults((old) =>
          reset ? fresh.map(artistFrom) : [...old, ...fresh.map(artistFrom)],
        )
    } catch (e: any) {
      if (epoch === searchEpoch.current) setSearchError(e.message)
    } finally {
      if (epoch === searchEpoch.current) {
        searchLock.current = false
        setSearchBusy(false)
      }
    }
  }
  function openPlaylist(playlist: Playlist) {
    setSource({ key: `playlist:${playlist.id}`, title: playlist.name, playlistId: playlist.id })
  }
  const navigation: BrowserNavigationState = {
    scope: `${uid}:${view}`,
    inputKey: collectionKey,
    revision: inputRevision,
    title:
      effectiveSource?.title ||
      { library: '我的歌单', albums: '收藏的专辑', liked: '我喜欢的音乐', search: '搜索' }[view],
    query: effectiveSource ? collectionQuery : view === 'search' ? query : listQuery,
    label: effectiveSource
      ? effectiveSource.artistId
        ? '搜索当前歌手歌曲'
        : '搜索当前歌单或专辑'
      : view === 'search'
        ? '搜索音乐库'
        : view === 'albums'
          ? '搜索当前专辑列表'
          : '搜索当前歌单列表',
    placeholder: effectiveSource
      ? '搜索歌曲、歌手、专辑'
      : view === 'search'
        ? '搜索歌曲、歌单、歌手'
        : view === 'albums'
          ? '搜索专辑名称'
          : '搜索歌单名称',
    busy: searchBusy,
    onQuery: (text) => {
      const revision = ++navigationRevision.current
      setInputRevision(revision)
      if (effectiveSource) setCollectionSearch({ key: collectionKey, text })
      else if (view === 'search') setQuery(text)
      else setListQuery(text)
      return revision
    },
    onBack:
      effectiveSource && view !== 'liked' && !initialSource ? () => setSource(null) : undefined,
    onSubmit:
      !effectiveSource && view === 'search' ? (text) => void search(true, kind, text) : undefined,
  }
  const publishNavigation = useEffectEvent(() => onNavigation?.(navigation))
  useEffect(() => {
    publishNavigation()
  }, [
    uid,
    view,
    effectiveSource?.key,
    effectiveSource?.title,
    collectionKey,
    collectionQuery,
    query,
    listQuery,
    kind,
    searchBusy,
    inputRevision,
  ])
  const matchesList = (name: string) =>
    name
      .normalize('NFKC')
      .toLocaleLowerCase()
      .includes(listQuery.normalize('NFKC').trim().toLocaleLowerCase())
  const visiblePlaylists = library.playlists.filter(
    (item) =>
      matchesList(item.name) &&
      (filter === 'all' ||
        (filter === 'created' ? item.creatorId === uid : item.creatorId !== uid)),
  )
  const visibleAlbums = library.albums.filter((album) => matchesList(album.name))
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
  if (view === 'liked' && (!library.likesReady || (!library.complete && !library.error)))
    return (
      <section className="music-browser">
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
      {!onNavigation && <BrowserSearch navigation={navigation} />}
      {addNotice && (
        <div className="alert" role="status">
          {addNotice}
        </div>
      )}
      {addSong && uid && (
        <AddToPlaylist
          key={`${uid}:${addSong.id}`}
          api={api}
          uid={uid}
          song={addSong}
          playlists={library.playlists}
          loading={library.loading}
          error={library.error}
          onRefresh={library.refresh}
          onClose={() => setAddSong(null)}
          onAdded={(playlist, alreadyExists) => {
            setAddNotice(
              alreadyExists ? `歌曲已在“${playlist.name}”中` : `已添加到“${playlist.name}”`,
            )
            if (!alreadyExists) library.recordPlaylistAdded(playlist.id)
            if (effectiveSource?.playlistId === playlist.id) collection.retry()
            setAddSong(null)
          }}
        />
      )}
      {effectiveSource ? (
        <>
          <div className="section-title">
            <div>
              <p>
                已加载 {collection.songs.length} / {collection.total} 首
                {collection.unavailable > 0 ? ` · ${collection.unavailable} 首暂不可用` : ''}
              </p>
            </div>
            {!room && (
              <button
                className="primary"
                disabled={
                  !visibleSongs.length ||
                  busy ||
                  (filtering && (collection.loading || collection.more || !!collection.error))
                }
                onClick={() =>
                  onPlay(
                    visibleSongs[0],
                    filtering ? visibleSongs.map((song) => song.id) : collection.ids,
                  )
                }
              >
                <Play size={15} />
                {filtering ? '播放搜索结果' : '播放全部'}
              </button>
            )}
          </div>
          {filtering && (
            <span className="collection-search-status" role="status">
              {collection.loading || collection.more
                ? `已找到 ${visibleSongs.length} 首 · ${collection.error ? '搜索未完成，请重试' : '正在搜索完整列表…'}`
                : `找到 ${visibleSongs.length} 首`}
            </span>
          )}
          {collection.error && (
            <div className="alert error" role="alert">
              {collection.error}
              <button onClick={collection.retry}>重试</button>
            </div>
          )}
          <SongRows
            songs={visibleSongs}
            ids={filtering ? visibleSongs.map((song) => song.id) : collection.ids}
            room={room}
            currentId={currentId}
            busy={busy}
            library={library}
            onPlay={onPlay}
            onLike={onLike}
            onAudition={onAudition}
            onAddToPlaylist={uid ? setAddSong : undefined}
          />
          {collection.loading && (
            <div className="loading">
              <LoaderCircle size={16} className="spin" />
              正在加载歌曲…
            </div>
          )}
          {!collection.loading && !collection.error && !collection.more && !visibleSongs.length && (
            <div className="empty">
              <Music2 size={25} />
              <strong>{filtering ? '没有找到匹配歌曲' : '这里还没有歌曲'}</strong>
            </div>
          )}
          <div ref={collectionSentinel} className="pagination-sentinel" aria-hidden="true" />
        </>
      ) : view === 'albums' ? (
        <>
          <div className="section-title">
            <div>
              <p>
                {library.albumsComplete ? '全部专辑' : '已加载专辑'} · {library.albums.length} 张
              </p>
            </div>
            <button className="secondary" disabled={library.loading} onClick={library.refresh}>
              <RefreshCw size={15} />
              刷新专辑
            </button>
          </div>
          {library.albumsError && (
            <div className="alert error" role="alert">
              {library.albumsError}
            </div>
          )}
          <div className="playlist-grid album-grid">
            {visibleAlbums.map((album) => (
              <button
                className="playlist-card"
                key={album.id}
                onClick={() =>
                  setSource({ key: `album:${album.id}`, title: album.name, albumId: album.id })
                }
              >
                {album.cover ? (
                  <img src={album.cover} alt="" loading="lazy" />
                ) : (
                  <div className="playlist-art">
                    <Disc3 size={36} />
                  </div>
                )}
                <strong>{album.name}</strong>
                <small>
                  {album.artist}
                  {album.count ? ` · ${album.count} 首` : ''}
                </small>
              </button>
            ))}
          </div>
          {listQuery.trim() && !library.loading && !visibleAlbums.length && (
            <div className="empty">
              <strong>没有找到匹配专辑</strong>
            </div>
          )}
          {library.loading && !library.albumsComplete && (
            <div className="loading">
              <LoaderCircle size={16} className="spin" />
              正在读取收藏专辑…
            </div>
          )}
          {library.albumsComplete && !library.albums.length && (
            <div className="empty">
              <Disc3 size={28} />
              <strong>还没有收藏专辑</strong>
              <span>在网易云收藏的专辑会显示在这里</span>
            </div>
          )}
        </>
      ) : view === 'library' ? (
        <>
          <div className="section-title">
            <div>
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
                aria-pressed={filter === value}
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
          {cards(visiblePlaylists)}
          {listQuery.trim() && !library.loading && !visiblePlaylists.length && (
            <div className="empty">
              <strong>没有找到匹配歌单</strong>
            </div>
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
          {history.length > 0 && (
            <div className="search-history">
              <span>最近搜索</span>
              {history.map((q) => (
                <div className="search-history-chip" key={q}>
                  <button
                    title={q}
                    onClick={() => {
                      setQuery(q)
                      search(true, kind, q)
                    }}
                  >
                    {q}
                  </button>
                  <button
                    className="history-delete"
                    aria-label={`删除搜索记录 ${q}`}
                    title="删除这条记录"
                    onClick={() => {
                      const next = history.filter((item) => item !== q)
                      setHistory(next)
                      try {
                        localStorage.setItem('music-party-search-history', JSON.stringify(next))
                      } catch {}
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                className="text-btn history-clear"
                aria-label="清空搜索记录"
                onClick={() => {
                  setHistory([])
                  try {
                    localStorage.removeItem('music-party-search-history')
                  } catch {}
                }}
              >
                <Trash2 size={14} />
                清空
              </button>
            </div>
          )}
          <div className="filter-tabs">
            {(['songs', 'playlists', 'artists'] as const).map((value, i) => (
              <button
                key={value}
                className={kind === value ? 'selected' : ''}
                aria-pressed={kind === value}
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
              <button onClick={() => search(searchOffset.current === 0)}>重试</button>
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
              onAudition={onAudition}
              onAddToPlaylist={uid ? setAddSong : undefined}
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
          <div ref={searchSentinel} className="pagination-sentinel" aria-hidden="true" />
        </>
      )}
    </section>
  )
}

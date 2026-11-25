import { ui } from '../../shared/ui-language'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  AudioLines,
  Disc3,
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
import type { Album, Artist, Playlist, SearchKind, Song } from '../../shared/types'
import { toSong } from '../../shared/protocol'
import { artistFrom, playlistFrom, readSearchPage, type ApiCall } from './music-data'
import { useSongCollection, type useLibrary } from './useLibrary'
import { useScrollPagination } from './useScrollPagination'
import './add-to-playlist.css'
import { useSurfaceActive } from './windows/Surface'
import { MusicianNames } from './MusicianNames'
import { PlayingSongLocator } from './PlayingSongLocator'
import { BrowserSearch, type BrowserNavigationState } from './BrowserNavigation'
import { SearchHistory, useSearchHistory } from './SearchHistory'

type LibraryState = ReturnType<typeof useLibrary>
export type MusicSource = {
  key: string
  title: string
  byline?: string
  cover?: string
  playlistId?: string
  albumId?: string
  artistId?: string
  ids?: string[]
}
function CollectionArtwork({ src, album = false }: { src?: string; album?: boolean }) {
  const [broken, setBroken] = useState('')
  const Icon = album ? Disc3 : Library
  return (
    <span className={'catalog-cover' + (album ? ' vinyl-cover' : '')}>
      {src && src !== broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(src)} />
      ) : (
        <span className="playlist-art">
          <Icon size={36} aria-hidden="true" />
        </span>
      )}
    </span>
  )
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
  onAlbum,
  onArtist,
  artistId,
  openCurrent,
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
  onAlbum?(song: Song): void
  onArtist(id: string, name: string): void
  artistId?: string
  openCurrent?(): void
}) {
  if (!songs.length) return null
  const play = (song: Song) => onPlay(song, ids || songs.map((item) => item.id))
  return (
    <div
      className={`song-list ${room && onAudition ? 'has-audition' : ''} ${onAddToPlaylist ? 'has-playlist-action' : ''}`}
    >
      <div className="song-row list-label">
        <span>#</span>
        <span>{ui('歌曲 / 歌手', 'Track / Artist')}</span>
        <span>{ui('专辑', 'Album')}</span>
        <span>{ui('时长', 'Duration')}</span>
        <span />
      </div>
      {songs.map((song, index) => (
        <div
          className={`song-row ${currentId === song.id ? 'is-playing' : ''}`}
          key={`${song.id}-${index}`}
          aria-current={currentId === song.id ? 'true' : undefined}
          onDoubleClick={openCurrent ? undefined : () => play(song)}
        >
          <span className="song-index">
            {currentId === song.id ? (
              <AudioLines size={15} aria-label={ui('当前歌曲', 'Current track')} />
            ) : (
              String(index + 1).padStart(2, '0')
            )}
          </span>
          <div className="song-title">
            {song.cover ? (
              <img src={song.cover} alt="" loading="lazy" />
            ) : (
              <span className="song-art-fallback">
                <Disc3 size={18} />
              </span>
            )}
            <div>
              <strong title={openCurrent ? undefined : song.name}>
                {openCurrent ? (
                  <button
                    className="track-open"
                    type="button"
                    aria-label={
                      (song.id === currentId
                        ? ui('查看正在播放', 'View Now Playing')
                        : room
                          ? ui('推送', 'Recommend')
                          : ui('播放', 'Play')) +
                      ' ' +
                      song.name
                    }
                    disabled={song.id !== currentId && busy}
                    onClick={() => (song.id === currentId ? openCurrent() : play(song))}
                  >
                    {song.name}
                  </button>
                ) : (
                  song.name
                )}
              </strong>
              <small
                title={
                  openCurrent ? undefined : [song.artist, song.album].filter(Boolean).join(' · ')
                }
              >
                <MusicianNames
                  credits={song.artists}
                  fallback={song.artist}
                  onOpen={onArtist}
                  artistId={artistId}
                />
                {!!song.composers?.length && (
                  <>
                    {' '}
                    {ui('· 作曲：', '· Composer: ')}
                    <MusicianNames credits={song.composers} onOpen={onArtist} artistId={artistId} />
                  </>
                )}
                {song.album && <span className="compact-track-album"> · {song.album}</span>}
              </small>
            </div>
          </div>
          {song.albumId && song.album && onAlbum ? (
            <button
              type="button"
              className="album album-link"
              title={ui('打开专辑《{0}》', 'Open album “{0}”', song.album)}
              onClick={() => onAlbum(song)}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {song.album}
            </button>
          ) : (
            <span className="album">{song.album}</span>
          )}
          <time className="song-duration" dateTime={`PT${Math.floor(song.duration / 1000)}S`}>
            {Math.floor(song.duration / 60000)}:
            {String(Math.floor(song.duration / 1000) % 60).padStart(2, '0')}
          </time>
          <div className="song-actions" onDoubleClick={(event) => event.stopPropagation()}>
            {onAddToPlaylist && (
              <button
                className="icon-btn"
                title={ui('添加到歌单', 'Add to playlist')}
                aria-label={ui('添加到歌单 {0}', 'Add {0} to a playlist', song.name)}
                onClick={() => onAddToPlaylist(song)}
              >
                <ListPlus size={16} />
              </button>
            )}
            {room && onAudition && (
              <button
                className="icon-btn"
                title={ui('试听', 'Preview')}
                aria-label={ui('试听 {0}', 'Preview {0}', song.name)}
                disabled={busy}
                onClick={() => onAudition(song)}
              >
                <Headphones size={15} />
              </button>
            )}
            <button
              className={`icon-btn ${library.likes.has(song.id) ? 'liked' : ''}`}
              title={library.likes.has(song.id) ? ui('取消喜欢', 'Unlike') : ui('喜欢', 'Like')}
              aria-label={`${library.likes.has(song.id) ? ui('取消喜欢', 'Unlike') : ui('喜欢', 'Like')} ${song.name}`}
              disabled={!library.likesReady || library.likeBusy.has(song.id)}
              onClick={() => onLike(song)}
            >
              <Heart size={15} fill={library.likes.has(song.id) ? 'currentColor' : 'none'} />
            </button>
            {!openCurrent && (
              <button
                className="icon-btn"
                title={room ? ui('推送到房间', 'Recommend to room') : ui('播放', 'Play')}
                aria-label={`${room ? ui('推送', 'Recommend') : ui('播放', 'Play')} ${song.name}`}
                disabled={busy}
                onClick={() => play(song)}
              >
                {room ? <Plus size={16} /> : <Play size={16} />}
              </button>
            )}
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
  createdOnly = false,
  recentIds,
  compactHome = false,
  openCurrent,
  onSource,
  onLogin,
  onSearch,
  onAdd,
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
  onSource(source: MusicSource): void
  onLogin(): void
  onSearch(): void
  onAdd(song: Song): void
  createdOnly?: boolean
  recentIds?: string[]
  compactHome?: boolean
  openCurrent?(): void
  initialSource?: MusicSource
  onNavigation?(navigation: BrowserNavigationState): void
}) {
  const source = initialSource || null
  const [filter, setFilter] = useState<'all' | 'created' | 'collected'>('all')
  const [query, setQuery] = useState('')
  const [listQuery, setListQuery] = useState('')
  const navigationRevision = useRef(0)
  const [inputRevision, setInputRevision] = useState(0)
  const [kind, setKind] = useState<SearchKind>('songs')
  const history = useSearchHistory('music-party-search-history')
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
  const active = useSurfaceActive()
  const likedIds = [...library.likes]
  const overview =
    !!uid && view === 'library' && !source && !createdOnly && filter === 'all' && !listQuery.trim()
  const previewIds = [
    ...new Set([...(recentIds?.slice(0, 5) || []), ...likedIds.slice(0, 5)]),
  ].slice(0, 5)
  const previewKey = overview ? previewIds.join(',') : ''
  const [visiblePreview, setVisiblePreview] = useState('')
  useEffect(() => {
    // Opening a drawer leaves the existing library visible behind it.
    if (active) setVisiblePreview(previewKey)
  }, [active, previewKey])
  const preview = useSongCollection(
    api,
    visiblePreview
      ? {
          key: 'preview:' + uid + ':' + visiblePreview,
          ids: visiblePreview.split(','),
          title: ui('近期播放和喜欢的歌曲', 'Recently played and liked tracks'),
        }
      : null,
  )
  const effectiveSource =
    view === 'liked'
      ? !library.complete && !library.error
        ? null
        : {
            key: `liked:${uid}:${library.likedPlaylist?.id || ''}:${likedIds.join(',')}`,
            title: ui('我喜欢的音乐', 'Liked Songs'),
            ...(library.likedPlaylist
              ? { playlistId: library.likedPlaylist.id }
              : { ids: likedIds }),
          }
      : source
  const collection = useSongCollection(
    api,
    effectiveSource,
    effectiveSource?.playlistId ? library.playlistChanges[effectiveSource.playlistId] : 0,
  )
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
  const canLoadCurrent =
    !!currentId &&
    !filtering &&
    (collection.more || collection.loading) &&
    collection.ids.indexOf(currentId, collection.loadedIdCount) !== -1
  const showLocator =
    active && currentId && (canLoadCurrent || visibleSongs.some((song) => song.id === currentId))
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
      setSearchMore(false)
    }
    const selection = searchKey.current
    if (reset) history.remember(selection.query)
    setSearchBusy(true)
    setSearchError('')
    setSearched(true)
    try {
      const byId = selection.kind === 'songs' && /^\d+$/.test(selection.query)
      const body = byId
        ? { result: { songs: (await api('song', { ids: selection.query })).songs, songCount: 1 } }
        : await api('search', { keywords: selection.query, kind: selection.kind, offset })
      if (epoch !== searchEpoch.current) return
      const previous = reset
        ? []
        : selection.kind === 'songs'
          ? songResults
          : selection.kind === 'playlists'
            ? playlistResults
            : artistResults
      const {
        items: fresh,
        nextOffset,
        more,
      } = readSearchPage(body.result, selection.kind, offset, previous)
      searchOffset.current = nextOffset
      setSearchMore(more)
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
    onSource({
      key: `playlist:${playlist.id}`,
      title: playlist.name,
      cover: playlist.cover,
      byline: playlist.creator,
      playlistId: playlist.id,
    })
  }
  const navigation: BrowserNavigationState = {
    scope: `${uid}:${view}`,
    inputKey: collectionKey,
    revision: inputRevision,
    title:
      effectiveSource?.title ||
      {
        library: ui('我的歌单', 'My playlists'),
        albums: ui('收藏的专辑', 'Saved albums'),
        liked: ui('我喜欢的音乐', 'Liked Songs'),
        search: ui('搜索', 'Search'),
      }[view],
    query: effectiveSource ? collectionQuery : view === 'search' ? query : listQuery,
    label: effectiveSource
      ? effectiveSource.artistId
        ? ui('搜索当前歌手歌曲', 'Search this artist’s tracks')
        : ui('搜索当前歌单或专辑', 'Search this playlist or album')
      : view === 'search'
        ? ui('搜索音乐库', 'Search library')
        : view === 'albums'
          ? ui('搜索当前专辑列表', 'Search saved albums')
          : ui('搜索当前歌单列表', 'Search playlists'),
    placeholder: effectiveSource
      ? ui('搜索歌曲、歌手、专辑', 'Search tracks, artists, or albums')
      : view === 'search'
        ? ui('搜索歌曲、歌单、歌手', 'Search tracks, playlists, or artists')
        : view === 'albums'
          ? ui('搜索专辑名称', 'Search album names')
          : ui('搜索歌单名称', 'Search playlist names'),
    busy: searchBusy,
    onQuery: (text) => {
      const revision = ++navigationRevision.current
      setInputRevision(revision)
      if (effectiveSource) setCollectionSearch({ key: collectionKey, text })
      else if (view === 'search') setQuery(text)
      else setListQuery(text)
      return revision
    },
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
    navigation.placeholder,
    collectionKey,
    collectionQuery,
    query,
    listQuery,
    kind,
    history.queries,
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
      (createdOnly
        ? item.creatorId === uid
        : filter === 'all' ||
          (filter === 'created' ? item.creatorId === uid : item.creatorId !== uid)),
  )
  const visibleAlbums = library.albums.filter((album) => matchesList(album.name))
  function openArtist(id: string, name: string) {
    onSource({ key: `artist:${id}`, title: name, artistId: id })
  }
  function openSongAlbum(song: Song) {
    if (song.albumId && source?.albumId !== song.albumId)
      onSource({
        key: `album:${song.albumId}`,
        title: song.album,
        albumId: song.albumId,
        cover: song.cover,
      })
  }
  const byline = source?.byline || collection.albumArtist
  const cover =
    source?.cover ||
    (view === 'liked' ? library.likedPlaylist?.cover : '') ||
    collection.songs[0]?.cover
  function playlistCard(item: Playlist) {
    return (
      <button
        key={'playlist:' + item.id}
        className="playlist-card"
        title={ui('打开歌单《{0}》', 'Open playlist “{0}”', item.name)}
        onClick={() => openPlaylist(item)}
      >
        <CollectionArtwork
          src={
            item.cover ||
            (library.likedPlaylist?.id === item.id
              ? preview.songs.find((song) => library.likes.has(song.id) && song.cover)?.cover
              : undefined)
          }
        />
        <strong>{item.name}</strong>
        <small>
          {ui('{0} 首', item.count === 1 ? '{0} track' : '{0} tracks', item.count)}
          {item.creator && ' · ' + item.creator}
        </small>
      </button>
    )
  }
  function albumCard(album: Album) {
    return (
      <button
        className="playlist-card"
        key={'album:' + album.id}
        title={ui('打开专辑《{0}》', 'Open album “{0}”', album.name)}
        onClick={() =>
          onSource({
            key: 'album:' + album.id,
            title: album.name,
            cover: album.cover,
            byline: album.artist,
            albumId: album.id,
          })
        }
      >
        <CollectionArtwork
          album
          src={
            album.cover ||
            preview.songs.find((song) => song.albumId === album.id && song.cover)?.cover
          }
        />
        <strong>{album.name}</strong>
        <small>
          {album.artist}
          {album.count
            ? ' · ' + ui('{0} 首', album.count === 1 ? '{0} track' : '{0} tracks', album.count)
            : ''}
        </small>
      </button>
    )
  }
  const leadLists = overview
    ? visiblePlaylists.slice(0, (compactHome ? 2 : 3) - (library.albums.length ? 1 : 0))
    : []
  const remainingLists = visiblePlaylists.slice(leadLists.length)
  if (!uid && !source && view !== 'search')
    return (
      <div className="empty">
        <Library size={28} />
        <strong>{ui('登录后查看你的音乐库', 'Sign in to see your library')}</strong>
        <div className="row-actions">
          <button className="primary" onClick={onLogin}>
            {ui('扫码登录', 'Sign in with QR code')}
          </button>
          <button className="secondary" onClick={onSearch}>
            <Search size={15} />
            {ui('全站搜索', 'Search all music')}
          </button>
        </div>
      </div>
    )
  if (view === 'liked' && (!library.likesReady || (!library.complete && !library.error)))
    return (
      <section className="music-browser">
        <div className="empty">
          <Heart size={25} />
          <strong>{library.error || ui('正在读取喜欢的音乐…', 'Loading Liked Songs…')}</strong>
          {library.error && (
            <button className="secondary" onClick={library.refresh}>
              {ui('重试', 'Retry')}
            </button>
          )}
        </div>
      </section>
    )
  return (
    <section className="music-browser">
      {!onNavigation && <BrowserSearch navigation={navigation} />}
      {effectiveSource ? (
        <>
          <div className="section-title collection-summary">
            {cover ? (
              <img alt="" src={cover} />
            ) : (
              <span className="collection-cover-fallback">
                {view === 'liked' ? <Heart /> : <Disc3 />}
              </span>
            )}
            <div>
              <span className="catalog-type">
                {source?.albumId
                  ? ui('专辑', 'Album')
                  : source?.artistId
                    ? ui('歌手', 'Artist')
                    : source?.key.startsWith('recent:')
                      ? ui('播放记录', 'Listening history')
                      : ui('歌单', 'Playlists')}
              </span>
              <h2>{effectiveSource.title}</h2>
              {byline && <span className="collection-byline">{byline}</span>}
              <p>
                {ui(
                  '已加载 {0} / {1} 首',
                  'Tracks loaded: {0} / {1}',
                  collection.songs.length,
                  collection.total,
                )}
                {collection.unavailable > 0
                  ? ui(' · {0} 首暂不可用', ' · Unavailable: {0}', collection.unavailable)
                  : ''}
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
                {filtering ? ui('播放搜索结果', 'Play search results') : ui('播放全部', 'Play all')}
              </button>
            )}
          </div>
          {filtering && (
            <span className="collection-search-status" role="status">
              {collection.loading || collection.more
                ? ui(
                    '已找到 {0} 首 · {1}',
                    'Matches: {0} · {1}',
                    visibleSongs.length,
                    collection.error
                      ? ui('搜索未完成，请重试', 'Search incomplete. Try again.')
                      : ui('正在搜索完整列表…', 'Searching the full list…'),
                  )
                : ui('找到 {0} 首', 'Matches: {0}', visibleSongs.length)}
            </span>
          )}
          {collection.error && (
            <div className="alert error" role="alert">
              {collection.error}
              <button onClick={collection.retry}>{ui('重试', 'Retry')}</button>
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
            onAddToPlaylist={uid ? onAdd : undefined}
            onArtist={openArtist}
            artistId={source?.artistId}
            onAlbum={source?.albumId ? undefined : openSongAlbum}
          />
          {collection.loading && (
            <div className="loading">
              <LoaderCircle size={16} className="spin" />
              {ui('正在加载歌曲…', 'Loading tracks…')}
            </div>
          )}
          {!collection.loading && !collection.error && !collection.more && !visibleSongs.length && (
            <div className="empty">
              <Music2 size={25} />
              <strong>
                {filtering
                  ? ui('没有找到匹配歌曲', 'No matching tracks')
                  : ui('这里还没有歌曲', 'No tracks here yet')}
              </strong>
              {filtering && (
                <button className="secondary" onClick={() => navigation.onQuery('')}>
                  {ui('清除筛选', 'Clear filter')}
                </button>
              )}
            </div>
          )}
          {showLocator && (
            <PlayingSongLocator
              key={JSON.stringify([collectionKey, currentId, collectionQuery])}
              loadedIdCount={collection.loadedIdCount}
              canLoadTarget={canLoadCurrent}
              loading={collection.loading}
              error={collection.error}
              loadMore={collection.loadMore}
            />
          )}
          <div ref={collectionSentinel} className="pagination-sentinel" aria-hidden="true" />
        </>
      ) : view === 'albums' ? (
        <>
          <div className="section-title">
            <div>
              <p>
                {library.albumsComplete
                  ? ui('全部专辑', 'All albums')
                  : ui('已加载专辑', 'Loaded albums')}{' '}
                · {library.albums.length} {ui('张', 'albums')}
              </p>
            </div>
            <button className="secondary" disabled={library.loading} onClick={library.refresh}>
              <RefreshCw size={15} />
              {ui('刷新专辑', 'Refresh albums')}
            </button>
          </div>
          {library.albumsError && (
            <div className="alert error" role="alert">
              {library.albumsError}
            </div>
          )}
          <div className="playlist-grid album-grid">{visibleAlbums.map(albumCard)}</div>
          {listQuery.trim() && !library.loading && !visibleAlbums.length && (
            <div className="empty">
              <strong>{ui('没有找到匹配专辑', 'No matching albums')}</strong>
              <button className="secondary" onClick={() => navigation.onQuery('')}>
                {ui('清除筛选', 'Clear filter')}
              </button>
            </div>
          )}
          {library.loading && !library.albumsComplete && (
            <div className="loading">
              <LoaderCircle size={16} className="spin" />
              {ui('正在读取收藏专辑…', 'Loading saved albums…')}
            </div>
          )}
          {library.albumsComplete && !library.albums.length && (
            <div className="empty">
              <Disc3 size={28} />
              <strong>{ui('还没有收藏专辑', 'No saved albums yet')}</strong>
              <span>
                {ui(
                  '在网易云收藏的专辑会显示在这里',
                  'Albums you save in NetEase Cloud Music appear here',
                )}
              </span>
            </div>
          )}
        </>
      ) : view === 'library' ? (
        <>
          {overview && (leadLists.length > 0 || library.albums.length > 0) && (
            <div className="library-overview" aria-label={ui('音乐库概览', 'Library overview')}>
              <div className="playlist-grid overview-cards">
                {leadLists[0] && playlistCard(leadLists[0])}
                {library.albums[0] && albumCard(library.albums[0])}
                {leadLists.slice(1).map(playlistCard)}
              </div>
              {preview.songs.length > 0 && (
                <section
                  className="overview-tracks"
                  aria-label={ui('近期播放和喜欢的歌曲', 'Recently played and liked tracks')}
                >
                  <SongRows
                    songs={preview.songs}
                    room={room}
                    currentId={currentId}
                    busy={busy}
                    library={library}
                    onPlay={onPlay}
                    onLike={onLike}
                    openCurrent={openCurrent}
                    onArtist={openArtist}
                    onAlbum={openSongAlbum}
                  />
                </section>
              )}
              {preview.error && (
                <button className="text-btn" onClick={preview.retry}>
                  {ui('重试加载歌曲', 'Retry loading tracks')}
                </button>
              )}
            </div>
          )}
          <div className="section-title">
            <div>
              <p>
                {createdOnly
                  ? ui('已创建', 'Created')
                  : library.complete
                    ? ui('全部歌单', 'All playlists')
                    : ui('已加载歌单', 'Loaded playlists')}{' '}
                ·{' '}
                {createdOnly
                  ? library.playlists.filter((p) => p.creatorId === uid).length
                  : library.playlists.length}{' '}
                {ui('个', 'playlists')}
              </p>
            </div>
            <button className="secondary" disabled={library.loading} onClick={library.refresh}>
              <RefreshCw size={15} />
              {ui('刷新音乐库', 'Refresh library')}
            </button>
          </div>
          {!createdOnly && (
            <div className="filter-tabs">
              {(['all', 'created', 'collected'] as const).map((value, i) => (
                <button
                  key={value}
                  className={filter === value ? 'selected' : ''}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {
                    [
                      ui('全部', 'All'),
                      ui('我创建的', 'Created by me'),
                      ui('我收藏的', 'Saved by me'),
                    ][i]
                  }
                </button>
              ))}
            </div>
          )}
          {library.error && (
            <div className="alert error" role="alert">
              {library.error}
            </div>
          )}
          {remainingLists.length > 0 && (
            <div className="playlist-grid">{remainingLists.map(playlistCard)}</div>
          )}
          {listQuery.trim() && !library.loading && !visiblePlaylists.length && (
            <div className="empty">
              <strong>{ui('没有找到匹配歌单', 'No matching playlists')}</strong>
              <button className="secondary" onClick={() => navigation.onQuery('')}>
                {ui('清除筛选', 'Clear filter')}
              </button>
            </div>
          )}
          {library.loading && (
            <div className="loading">
              <LoaderCircle size={16} className="spin" />
              {ui('正在读取全部歌单…', 'Loading playlists…')}
            </div>
          )}
          {library.complete && !library.playlists.length && (
            <div className="empty">
              <Library size={25} />
              <strong>{ui('还没有歌单', 'No playlists yet')}</strong>
            </div>
          )}
        </>
      ) : (
        <>
          <SearchHistory
            history={history}
            onSearch={(keyword) => {
              setQuery(keyword)
              void search(true, kind, keyword)
            }}
          />
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
                {[ui('歌曲', 'Tracks'), ui('歌单', 'Playlists'), ui('歌手', 'Artists')][i]}
              </button>
            ))}
          </div>
          {searchError && (
            <div className="alert error" role="alert">
              {searchError}
              <button onClick={() => search(searchOffset.current === 0)}>
                {ui('重试', 'Retry')}
              </button>
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
              onAddToPlaylist={uid ? onAdd : undefined}
              onArtist={openArtist}
              artistId={source?.artistId}
              onAlbum={source?.albumId ? undefined : openSongAlbum}
            />
          )}
          {kind === 'playlists' && (
            <div className="playlist-grid">{playlistResults.map(playlistCard)}</div>
          )}
          {kind === 'artists' && (
            <div className="playlist-grid">
              {artistResults.map((artist) => (
                <button
                  className="playlist-card artist-card"
                  key={artist.id}
                  title={ui('查看歌手 {0}', 'View artist {0}', artist.name)}
                  onClick={() =>
                    onSource({
                      key: `artist:${artist.id}`,
                      title: artist.name,
                      artistId: artist.id,
                      cover: artist.cover,
                      byline: artist.aliases.join(' / '),
                    })
                  }
                >
                  <span className="catalog-cover artist-cover">
                    {artist.cover ? (
                      <img src={artist.cover} alt="" />
                    ) : (
                      <span className="playlist-art">
                        <Music2 size={30} />
                      </span>
                    )}
                  </span>
                  <strong>{artist.name}</strong>
                  <small>{artist.aliases.join(' / ')}</small>
                </button>
              ))}
            </div>
          )}
          {searchBusy && (
            <div className="loading">
              <LoaderCircle size={16} className="spin" />
              {ui('正在搜索…', 'Searching…')}
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
                <strong>
                  {searched
                    ? ui('没有找到匹配内容', 'No results')
                    : ui('从一首好歌开始', 'Search for a track to get started')}
                </strong>
              </div>
            )}
          <div ref={searchSentinel} className="pagination-sentinel" aria-hidden="true" />
        </>
      )}
    </section>
  )
}

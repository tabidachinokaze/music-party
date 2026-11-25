import { Check, Disc3, Heart, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toSong } from '../../../shared/protocol'
import type { Song } from '../../../shared/types'
import { ui } from '../../../shared/ui-language'
import { readSearchPage, type ApiCall } from '../music-data'
import { SearchHistory, useSearchHistory } from '../SearchHistory'
import { useScrollPagination } from '../useScrollPagination'
import './match-song-picker.css'

type Results = { songs: Song[]; nextOffset: number; more: boolean }

export function MatchSongPicker({
  api,
  uid,
  likes,
  selected,
  onSelect,
}: {
  api: ApiCall
  uid: string
  likes: ReadonlySet<string> | null
  selected: Song | null
  onSelect(song: Song): void
}) {
  const [query, setQuery] = useState('')
  const history = useSearchHistory(`music-party.match-song-search-history.${uid}`)
  const [results, setResults] = useState<Results | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    return () => {
      generation.current++
    }
  }, [])

  function editQuery(value: string) {
    generation.current++
    setQuery(value)
    setResults(null)
    setError('')
    setLoading(false)
  }
  async function search(append = false, term = query) {
    const keywords = term.trim()
    if (!keywords || loading || (append && !results?.more)) return
    const run = ++generation.current
    const previous = append ? results : null
    const offset = previous?.nextOffset ?? 0
    setLoading(true)
    setError('')
    if (!append) {
      history.remember(keywords)
      setResults(null)
    }
    try {
      const body = await api('search', { keywords, kind: 'songs', offset })
      if (run !== generation.current) return
      const songs = previous?.songs ?? []
      const { items, nextOffset, more } = readSearchPage(body.result, 'songs', offset, songs)
      setResults({ songs: [...songs, ...items.map(toSong)], nextOffset, more })
    } catch (cause) {
      if (run === generation.current)
        setError(
          cause instanceof Error
            ? cause.message
            : ui('搜索失败，请重试', 'Search failed. Try again.'),
        )
    } finally {
      if (run === generation.current) setLoading(false)
    }
  }
  const sentinel = useScrollPagination({
    scope: query,
    loading,
    hasMore: results?.more ?? false,
    blocked: !!error,
    contentKey: results?.nextOffset,
    onLoad: () => search(true),
  })
  return (
    <div className="match-song-dialog">
      <form
        className="match-song-search"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <label className="collection-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            type="search"
            aria-label={ui('搜索匹配用歌曲', 'Find a song for matching')}
            placeholder={ui('搜索歌曲或歌手', 'Search songs or artists')}
            value={query}
            onChange={(event) => editQuery(event.target.value)}
          />
        </label>
        <button type="submit" className="secondary" disabled={!query.trim() || loading}>
          {ui('搜索', 'Search')}
        </button>
      </form>
      <div
        className="match-song-list"
        data-list-viewport=""
        role="group"
        aria-label={ui('匹配歌曲搜索结果', 'Matching song results')}
        aria-busy={loading}
      >
        {!query.trim() && (
          <SearchHistory
            history={history}
            onSearch={(keyword) => {
              setQuery(keyword)
              void search(false, keyword)
            }}
          />
        )}
        {!results && !loading && !error && selected && (
          <p className="match-song-status">
            {ui('当前选择：{0}', 'Current selection: {0}', selected.name)}
          </p>
        )}
        {results?.songs.map((song) => (
          <button
            key={song.id}
            type="button"
            className="match-song-option"
            aria-current={song.id === selected?.id ? 'true' : undefined}
            title={ui('选择《{0}》', 'Choose “{0}”', song.name)}
            onClick={() => onSelect(song)}
          >
            {song.cover ? (
              <img src={song.cover} loading="lazy" alt="" />
            ) : (
              <Disc3 size={20} aria-hidden="true" />
            )}
            <span>
              <strong>{song.name}</strong>
              {song.artist && <small>{song.artist}</small>}
            </span>
            <span className="match-song-marks">
              {song.id === selected?.id && <Check size={16} aria-hidden="true" />}
              {likes && (
                <Heart
                  size={16}
                  role="img"
                  data-liked={likes.has(song.id)}
                  aria-label={
                    likes.has(song.id) ? ui('已红心', 'Liked') : ui('未红心', 'Not liked')
                  }
                />
              )}
            </span>
          </button>
        ))}
        {loading && (
          <p className="match-song-status" role="status">
            {ui('正在搜索歌曲…', 'Searching for tracks…')}
          </p>
        )}
        {error && (
          <div className="match-song-status" role="alert">
            {error}
            <button className="text-btn" onClick={() => void search(!!results?.more)}>
              {ui('重试', 'Retry')}
            </button>
          </div>
        )}
        {results && !results.songs.length && !loading && !error && (
          <p className="match-song-status" role="status">
            {ui('没有找到匹配的歌曲', 'No matching songs')}
          </p>
        )}
        <div ref={sentinel} className="pagination-sentinel" aria-hidden="true" />
      </div>
    </div>
  )
}

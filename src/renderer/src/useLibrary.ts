import { useEffect, useRef, useState } from 'react'
import type { Playlist, Song } from '../../shared/types'
import { toSong } from '../../shared/protocol'
import { allPlaylists, songsByIds, type ApiCall } from './music-data'

export function useLibrary(api: ApiCall, uid: string | null) {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [likes, setLikes] = useState<Set<string>>(new Set())
  const [likesReady, setLikesReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const [revision, setRevision] = useState(0)
  const [likeBusy, setLikeBusy] = useState<Set<string>>(new Set())
  const likeLock = useRef(new Set<string>())
  const epoch = useRef(0)
  useEffect(() => {
    const run = ++epoch.current
    const active = () => epoch.current === run
    setPlaylists([])
    setLikes(new Set())
    setLikesReady(false)
    setError('')
    setComplete(false)
    setLikeBusy(new Set())
    likeLock.current.clear()
    if (!uid) {
      setLoading(false)
      return
    }
    setLoading(true)
    Promise.allSettled([
      allPlaylists(api, uid, active, (items) => {
        if (active()) setPlaylists(items)
      }).then(() => {
        if (active()) setComplete(true)
      }),
      api('likes', { uid }).then((body) => {
        if (!Array.isArray(body.ids)) throw new Error('喜欢列表响应异常')
        if (active()) {
          setLikes(new Set(body.ids.map(String)))
          setLikesReady(true)
        }
      }),
    ]).then((results) => {
      if (active()) {
        setLoading(false)
        const errors = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason?.message || '音乐库加载失败'] : [],
        )
        setError(errors.join('；'))
      }
    })
    return () => {
      epoch.current++
    }
  }, [uid, revision])
  async function toggleLike(song: Song) {
    if (!uid) throw new Error('请先登录网易云账号')
    if (!likesReady) throw new Error('喜欢列表尚未加载完成，请稍后重试')
    if (likeLock.current.has(song.id)) return
    const run = epoch.current
    likeLock.current.add(song.id)
    setLikeBusy(new Set(likeLock.current))
    const desired = !likes.has(song.id)
    try {
      await api('like', { id: song.id, value: desired })
      if (run === epoch.current)
        setLikes((previous) => {
          const next = new Set(previous)
          if (desired) next.add(song.id)
          else next.delete(song.id)
          return next
        })
    } finally {
      if (run === epoch.current) {
        likeLock.current.delete(song.id)
        setLikeBusy(new Set(likeLock.current))
      }
    }
  }
  return {
    playlists,
    likes,
    likesReady,
    loading,
    error,
    complete,
    likeBusy,
    toggleLike,
    refresh: () => setRevision((n) => n + 1),
  }
}

export function useSongCollection(
  api: ApiCall,
  source: {
    key: string
    title: string
    playlistId?: string
    ids?: string[]
    artistId?: string
  } | null,
) {
  const [songs, setSongs] = useState<Song[]>([])
  const [ids, setIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [more, setMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(0)
  const [retryRevision, setRetryRevision] = useState(0)
  const epoch = useRef(0)
  const position = useRef(0)
  const busy = useRef(false)
  const allIds = useRef<string[]>([])
  async function page(run: number, reset = false) {
    if (busy.current && !reset) return
    busy.current = true
    setLoading(true)
    setError('')
    try {
      const offset = position.current
      const batch = source?.artistId ? [] : allIds.current.slice(offset, offset + 100)
      let items: Song[], hasMore: boolean, count: number
      if (source?.artistId) {
        const body = await api('artistSongs', { id: source.artistId, offset })
        if (!Array.isArray(body.songs)) throw new Error('歌手歌曲响应异常')
        items = body.songs.map(toSong)
        hasMore = body.more === true
        count = Number(body.total || offset + items.length)
        if (!items.length && hasMore) throw new Error('歌曲分页暂不可用，请重试')
      } else {
        items = await songsByIds(api, batch)
        hasMore = offset + batch.length < allIds.current.length
        count = allIds.current.length
      }
      if (run !== epoch.current) return
      position.current += source?.artistId ? items.length : batch.length
      setSongs((old) => (reset ? items : [...old, ...items]))
      setMore(hasMore)
      setTotal(count)
      if (source?.artistId) {
        allIds.current = reset
          ? items.map((s) => s.id)
          : [...allIds.current, ...items.map((s) => s.id)]
        setIds([...allIds.current])
      } else setUnavailable((old) => (reset ? 0 : old) + batch.length - items.length)
    } catch (e: any) {
      if (run === epoch.current) setError(e.message)
    } finally {
      if (run === epoch.current) {
        busy.current = false
        setLoading(false)
      }
    }
  }
  useEffect(() => {
    const run = ++epoch.current
    setSongs([])
    setIds([])
    setTotal(0)
    setMore(false)
    setError('')
    setUnavailable(0)
    position.current = 0
    allIds.current = []
    busy.current = false
    if (!source) {
      setLoading(false)
      return
    }
    setLoading(true)
    const load = async () => {
      try {
        let trackIds = source.ids || []
        if (source.playlistId) {
          const body = await api('playlist', { id: source.playlistId })
          if (!Array.isArray(body.playlist?.trackIds)) throw new Error('未获取到完整歌单，请重试')
          trackIds = body.playlist.trackIds.map((item: any) => String(item.id))
        }
        if (run !== epoch.current) return
        allIds.current = trackIds
        setIds(trackIds)
        setTotal(trackIds.length)
        await page(run, true)
      } catch (e: any) {
        if (run === epoch.current) {
          setError(e.message)
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      epoch.current++
      busy.current = false
    }
  }, [source?.key, retryRevision])
  return {
    songs,
    ids,
    loading,
    more,
    total,
    error,
    unavailable,
    loadMore: () => page(epoch.current),
    retry: () => setRetryRevision((n) => n + 1),
  }
}

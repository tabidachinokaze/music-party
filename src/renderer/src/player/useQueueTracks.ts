import { useEffect, useRef, useState } from 'react'
import type { Song } from '../../../shared/types'
import { ui } from '../../../shared/ui-language'
import { songsByIds, type ApiCall } from '../music-data'

/** Room lists carry display names only. Resolve credits by track ID for the rows on screen. */
export function useQueueTracks(api: ApiCall, scope: string, ids: string[]) {
  const [tracks, setTracks] = useState<Record<string, Song | null>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const cache = useRef<Record<string, Song | null>>({})
  const latestApi = useRef(api)
  latestApi.current = api
  const idsKey = [...new Set(ids)].join(',')
  useEffect(() => {
    cache.current = {}
    setTracks({})
  }, [scope])
  useEffect(() => {
    let active = true
    const missing = idsKey.split(',').filter((id) => id && !Object.hasOwn(cache.current, id))
    setError('')
    setLoading(missing.length > 0)
    async function load() {
      try {
        for (let offset = 0; offset < missing.length; offset += 100) {
          const batch = missing.slice(offset, offset + 100)
          const songs = await songsByIds(latestApi.current, batch)
          if (!active) return
          for (const id of batch) cache.current[id] = null
          for (const song of songs) cache.current[song.id] = song
          setTracks({ ...cache.current })
        }
      } catch (error) {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : ui('歌曲信息暂时无法读取', 'Song details unavailable'),
          )
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [scope, idsKey, revision])
  return { tracks, loading, error, retry: () => setRevision((value) => value + 1) }
}

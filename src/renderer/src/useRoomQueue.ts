import { ui } from '../../shared/ui-language'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RoomQueueEntry } from '../../shared/types'
import type { ApiCall } from './music-data'
import { RoomQueuePages, type RoomQueueMethod } from './room-queue-pages'

export function useRoomQueue(
  api: ApiCall,
  roomId: string | undefined,
  version: number | undefined,
  enabled: boolean,
  actionRevision = 0,
  method: RoomQueueMethod = 'multiQueue',
  limit = Infinity,
) {
  const scope = `${roomId || ''}:${method}`
  const [revision, setRevision] = useState(0)
  const [list, setList] = useState({ scope, entries: [] as RoomQueueEntry[], complete: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const latestApi = useRef(api)
  latestApi.current = api
  const pages = useMemo(() => new RoomQueuePages(), [scope, version, revision, actionRevision])
  useEffect(() => {
    let active = true
    setError('')
    setList((prev) => (prev.scope === scope ? prev : { scope, entries: [], complete: false }))
    if (!roomId || !enabled) {
      setLoading(false)
      return
    }
    async function load(id: string) {
      setLoading(!pages.complete && pages.rows.size < limit)
      try {
        // A hidden tab may have already finished an in-flight page.
        if (pages.complete || pages.rows.size >= limit) {
          setList({ scope, entries: [...pages.rows.values()], complete: pages.complete })
          return
        }
        while (!pages.complete && pages.rows.size < limit) {
          await pages.next(latestApi.current, id, method)
          if (!active) return
          const entries = [...pages.rows.values()]
          const complete = pages.complete
          // Keep the old rows while refreshing up to the user's current scroll position.
          setList((prev) =>
            prev.scope === scope && !complete && entries.length < prev.entries.length
              ? { ...prev, complete }
              : { scope, entries, complete },
          )
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : ui('列表读取失败', "Couldn't load the list"),
          )
      } finally {
        if (active) setLoading(false)
      }
    }
    void load(roomId)
    return () => {
      active = false
    }
  }, [roomId, method, pages, scope, enabled, limit])
  return {
    entries: list.scope === scope ? list.entries : [],
    complete: list.scope === scope && list.complete,
    loading,
    error: list.scope === scope ? error : '',
    refresh: () => setRevision((value) => value + 1),
  }
}

import { useEffect, useRef, useState } from 'react'
import type { RoomQueueEntry } from '../../shared/types'
import { parseRoomQueue } from '../../shared/playback-queue'
import type { ApiCall } from './music-data'

export function useRoomQueue(
  api: ApiCall,
  roomId: string | undefined,
  version: number | undefined,
  enabled: boolean,
) {
  const [entries, setEntries] = useState<RoomQueueEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const epoch = useRef(0)
  useEffect(() => {
    setEntries([])
    setComplete(false)
    setError('')
  }, [roomId])
  useEffect(() => {
    const run = ++epoch.current
    if (!roomId || !enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    setComplete(false)
    setError('')
    const load = async () => {
      const rows = new Map<string, RoomQueueEntry>()
      const cursors = new Set<string>()
      let cursor: string | null = null
      try {
        do {
          const page = parseRoomQueue(
            await api('multiQueue', { roomId, ...(cursor ? { cursor } : {}) }),
          )
          if (run !== epoch.current) return
          const before = rows.size
          page.entries.forEach((entry) => rows.set(entry.songBizId, entry))
          setEntries([...rows.values()])
          if (!page.more) {
            setComplete(true)
            break
          }
          if (!page.cursor || cursors.has(page.cursor) || rows.size === before)
            throw new Error('待播列表分页未继续前进，请刷新重试')
          cursors.add(page.cursor)
          cursor = page.cursor
        } while (run === epoch.current)
      } catch (error: any) {
        if (run === epoch.current) setError(error.message || '待播列表读取失败')
      } finally {
        if (run === epoch.current) setLoading(false)
      }
    }
    load()
    return () => {
      epoch.current++
    }
  }, [roomId, version, enabled, revision])
  return { entries, loading, complete, error, refresh: () => setRevision((value) => value + 1) }
}

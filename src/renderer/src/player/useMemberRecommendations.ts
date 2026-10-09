import { useEffect, useRef, useState } from 'react'
import type { RoomQueueEntry } from '../../../shared/types'
import type { ApiCall } from '../music-data'
import { loadMemberRecommendations } from '../member-recommendations'

export function useMemberRecommendations(
  api: ApiCall,
  roomId: string | undefined,
  version: number | undefined,
  membersKey: string,
  actionRevision: number,
) {
  const [records, setRecords] = useState<{ played: RoomQueueEntry[]; waiting: RoomQueueEntry[] }>({
    played: [],
    waiting: [],
  })
  const [complete, setComplete] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  const epoch = useRef(0),
    latestApi = useRef(api)
  latestApi.current = api
  useEffect(() => {
    setRecords({ played: [], waiting: [] })
    setComplete(false)
  }, [roomId])
  useEffect(() => {
    const run = ++epoch.current
    if (!roomId) return
    const current = () => epoch.current === run
    setLoading(true)
    setError('')
    Promise.all([
      loadMemberRecommendations(latestApi.current, roomId, current, 'multiPlayed'),
      loadMemberRecommendations(latestApi.current, roomId, current, 'multiQueue'),
    ])
      .then(([played, waiting]) => {
        if (!current()) return
        setRecords({ played, waiting })
        setComplete(true)
      })
      .catch((failure) => {
        if (current()) setError(failure.message || '推荐记录读取失败，请重试')
      })
      .finally(() => {
        if (current()) setLoading(false)
      })
    return () => {
      epoch.current++
    }
  }, [roomId, version, membersKey, actionRevision, revision])
  return {
    ...records,
    complete,
    loading,
    error,
    refresh: () => setRevision((value) => value + 1),
  }
}

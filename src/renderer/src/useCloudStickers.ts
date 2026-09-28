import { useEffect, useRef, useState } from 'react'
import {
  parseStickerGroups,
  stickerKey,
  type SavedSticker,
  type StickerGroup,
} from '../../shared/stickers'
import type { ApiCall } from './music-data'

export function useCloudStickers(
  api: ApiCall,
  accountKey: string,
  scope: 'room' | 'private',
  visible: boolean,
) {
  const [groups, setGroups] = useState<StickerGroup[]>([]),
    [groupId, setGroupId] = useState('')
  const [items, setItems] = useState<SavedSticker[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('')
  const [complete, setComplete] = useState(false),
    [revision, setRevision] = useState(0),
    [unavailable, setUnavailable] = useState(0)
  const selected = useRef(''),
    latest = useRef(api)
  latest.current = api
  useEffect(() => {
    setGroups([])
    setItems([])
    selected.current = ''
    setGroupId('')
    setError('')
    setComplete(false)
  }, [accountKey, scope])
  useEffect(() => {
    if (!visible || !accountKey) return
    let active = true
    setLoading(true)
    setError('')
    setItems([])
    setComplete(false)
    setUnavailable(0)
    const load = async () => {
      try {
        const groups = parseStickerGroups(await latest.current('stickerGroups', { scope }))
        if (!active) return
        setGroups(groups)
        const group = groups.find((item) => item.id === selected.current) || groups[0]
        if (!group) {
          setGroupId('')
          setComplete(true)
          return
        }
        selected.current = group.id
        setGroupId(group.id)
        const entries = new Map<string, SavedSticker>(),
          cursors = new Set<string>()
        let cursor = ''
        do {
          const body = await latest.current('stickerPage', {
            groupId: group.id,
            ...(cursor ? { cursor } : {}),
          })
          if (!active) return
          if (!Array.isArray(body.data?.emojis)) throw new Error('表情列表响应异常，请重试')
          const before = entries.size
          for (const item of body.data.emojis) entries.set(stickerKey(item), item)
          setItems([...entries.values()])
          setUnavailable((value) => value + (Number(body.data.unavailable) || 0))
          if (!body.data.page?.more) {
            setComplete(true)
            break
          }
          if (entries.size === before && !body.data.unavailable)
            throw new Error('表情分页没有继续前进，请刷新重试')
          const next = body.data.page.cursor
          if (typeof next !== 'string' || !next || cursors.has(next))
            throw new Error('表情分页没有继续前进，请刷新重试')
          cursors.add(next)
          cursor = next
        } while (active)
      } catch (error: any) {
        if (active) setError(error.message || '读取自定义表情失败')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [accountKey, scope, visible, revision])
  return {
    groups,
    groupId,
    items,
    loading,
    error,
    complete,
    unavailable,
    select: (id: string) => {
      selected.current = id
      setGroupId(id)
      setRevision((value) => value + 1)
    },
    refresh: () => setRevision((value) => value + 1),
  }
}

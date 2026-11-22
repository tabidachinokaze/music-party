import { useEffect, useState } from 'react'

type History = { key: string; ids: string[] }
function read(key: string): History {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    if (Array.isArray(saved))
      return {
        key,
        ids: saved
          .filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id))
          .slice(0, 100),
      }
  } catch {}
  return { key, ids: [] }
}

// Keep local listening history separate for each account, including guest playback.
export function useRecentTracks(uid: string | null, playingId?: string) {
  const key = 'music-party-recent:' + (uid || 'guest')
  const [history, setHistory] = useState(() => read(key))
  useEffect(() => {
    setHistory((previous) => {
      const current = previous.key === key ? previous : read(key)
      if (!playingId || current.ids[0] === playingId) return current
      return {
        key,
        ids: [playingId, ...current.ids.filter((id) => id !== playingId)].slice(0, 100),
      }
    })
  }, [key, playingId])
  useEffect(() => {
    if (history.key !== key) return
    try {
      localStorage.setItem(key, JSON.stringify(history.ids))
    } catch {}
  }, [history, key])
  return key === history.key ? history.ids : []
}

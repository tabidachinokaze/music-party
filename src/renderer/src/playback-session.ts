import { toSong } from '../../shared/protocol'
import type { Song } from '../../shared/types'

interface SavedQueue {
  ids: string[]
  index: number
  song: Song | null
}

export function readPersonalQueue(uid: string): SavedQueue {
  try {
    const value = JSON.parse(localStorage.getItem(`music-party:queue:${uid}`) || 'null')
    if (
      Array.isArray(value?.ids) &&
      value.ids.every((id: unknown) => typeof id === 'string' && /^[1-9]\d*$/.test(id)) &&
      Number.isInteger(value.index) &&
      value.index >= 0 &&
      value.index < value.ids.length
    ) {
      const id = value.ids[value.index]
      const track = value.song
      const song =
        track?.id === id && typeof track.name === 'string'
          ? toSong({
              id,
              name: track.name,
              artists: track.artists ?? track.artist,
              composers: track.composers,
              al: {
                name: typeof track.album === 'string' ? track.album : '',
                id: track.albumId,
                picUrl: typeof track.cover === 'string' ? track.cover : '',
              },
              dt: Number.isFinite(track.duration) ? Math.max(0, track.duration) : 0,
            })
          : null
      return { ids: value.ids, index: value.index, song }
    }
  } catch {}
  return { ids: [], index: -1, song: null }
}

export function savePersonalQueue(uid: string, queue: SavedQueue) {
  if (!uid) return
  if (queue.ids.length) localStorage.setItem(`music-party:queue:${uid}`, JSON.stringify(queue))
  else localStorage.removeItem(`music-party:queue:${uid}`)
}

export function rememberedRoom(uid: string) {
  try {
    return localStorage.getItem(`music-party:room:${uid}`)
  } catch {
    return null
  }
}

export function rememberRoom(uid: string, roomId: string | null) {
  if (!uid) return
  if (roomId) localStorage.setItem(`music-party:room:${uid}`, roomId)
  else localStorage.removeItem(`music-party:room:${uid}`)
}

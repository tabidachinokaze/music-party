import type { QueueSong, RoomPlayback } from './types'
export function waitingSongs(songs: QueueSong[], currentBizId?: string): QueueSong[] {
  const seen = new Set<string>()
  return songs.filter((song) => {
    if (song.songBizId === currentBizId || seen.has(song.songBizId)) return false
    seen.add(song.songBizId)
    return true
  })
}
export function waitingCount(playback: RoomPlayback | null): number | undefined {
  if (!playback) return undefined
  return Math.max(
    playback.waitSongCount,
    waitingSongs(playback.nextSongs, playback.song?.songBizId).length,
  )
}

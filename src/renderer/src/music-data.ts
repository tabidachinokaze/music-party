import { t } from '../../shared/ui-language'
import type { Album, Artist, Method, Playlist, SearchKind, Song } from '../../shared/types'
import { toSong } from '../../shared/protocol'
export type ApiCall = (method: Method, args?: Record<string, unknown>) => Promise<any>
export function readSearchPage(
  result: any,
  kind: SearchKind,
  offset: number,
  previous: readonly { id: string }[],
) {
  const rows: any[] = Array.isArray(result?.[kind]) ? result[kind] : []
  const seen = new Set(previous.map((item) => item.id))
  const items = rows.filter((item) => {
    const id = String(item.id)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  if (rows.length && !items.length)
    throw new Error(t('musicData.searchResultsStoppedLoadingTryAgain'))
  const countField = { songs: 'songCount', playlists: 'playlistCount', artists: 'artistCount' }[
    kind
  ]
  const total = Number(result?.[countField] || 0)
  const nextOffset = offset + rows.length
  return {
    items,
    nextOffset,
    more: rows.length > 0 && (total ? nextOffset < total : rows.length === 30),
  }
}
export function likedPlaylist(playlists: Playlist[], uid: string | null): Playlist | undefined {
  return playlists.find((playlist) => playlist.creatorId === uid && playlist.specialType === 5)
}
export function writablePlaylists(playlists: Playlist[], uid: string): Playlist[] {
  return playlists.filter((playlist) => playlist.creatorId === uid && playlist.specialType !== 5)
}
export function playlistFrom(value: any): Playlist {
  return {
    id: String(value.id),
    name: value.name || t('musicData.untitledPlaylist'),
    cover: value.coverImgUrl || value.picUrl || '',
    count: value.trackCount || 0,
    creatorId: String(value.creator?.userId || ''),
    creator: value.creator?.nickname || '',
    specialType: value.specialType || 0,
  }
}
export function artistFrom(value: any): Artist {
  return {
    id: String(value.id),
    name: value.name || '',
    cover: value.picUrl || value.img1v1Url || '',
    aliases: value.alias || [],
  }
}
export async function allPlaylists(
  api: ApiCall,
  uid: string,
  active: () => boolean,
  progress: (items: Playlist[]) => void,
): Promise<Playlist[]> {
  const byId = new Map<string, Playlist>()
  let offset = 0
  while (active()) {
    const body = await api('playlists', { uid, offset })
    if (!active()) return []
    if (!Array.isArray(body.playlist))
      throw new Error(t('musicData.invalidPlaylistResponseTryAgain'))
    const before = byId.size
    for (const item of body.playlist) byId.set(String(item.id), playlistFrom(item))
    progress([...byId.values()])
    if (!body.more) return [...byId.values()]
    if (!body.playlist.length || before === byId.size)
      throw new Error(t('musicData.theServerReturnedTheSamePageTwiceRefresh'))
    offset += body.playlist.length
  }
  return []
}
export async function songsByIds(api: ApiCall, ids: string[]): Promise<Song[]> {
  if (!ids.length) return []
  const body = await api('song', { ids: ids.join(',') })
  if (!Array.isArray(body.songs)) throw new Error(t('musicData.invalidTrackResponse'))
  const byId = new Map<string, Song>(body.songs.map((s: any) => [String(s.id), toSong(s)]))
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
}
/** Album credits may be returned as a list, or only as a primary artist. */
export function albumArtistName(
  album?: {
    artists?: { name?: string }[]
    artist?: { name?: string }
  } | null,
): string {
  const names = Array.isArray(album?.artists)
    ? album.artists
        .map((artist) => (typeof artist?.name === 'string' ? artist.name.trim() : ''))
        .filter(Boolean)
    : []
  return (
    names.join(' / ') || (typeof album?.artist?.name === 'string' ? album.artist.name.trim() : '')
  )
}

export async function allAlbums(
  api: ApiCall,
  active: () => boolean,
  progress: (items: Album[]) => void,
): Promise<Album[]> {
  const byId = new Map<string, Album>()
  let offset = 0
  while (active()) {
    const body = await api('albums', { offset })
    if (!active()) return []
    if (!Array.isArray(body.data)) throw new Error(t('musicData.couldNotReadSavedAlbumsTryAgain'))
    const before = byId.size
    for (const item of body.data) {
      if (!/^[1-9]\d*$/.test(String(item.id))) continue
      byId.set(String(item.id), {
        id: String(item.id),
        name: item.name || t('musicData.untitledAlbum'),
        cover: item.picUrl || '',
        count: Number(item.size || 0),
        artist: albumArtistName(item),
      })
    }
    progress([...byId.values()])
    offset += body.data.length
    const more =
      body.hasMore ??
      body.more ??
      (Number.isFinite(body.count) ? offset < body.count : body.data.length === 50)
    if (!more) return [...byId.values()]
    if (!body.data.length || before === byId.size)
      throw new Error(t('musicData.noMoreSavedAlbumsCouldBeLoadedTry'))
  }
  return []
}
export interface LyricLine {
  time: number
  text: string
}
export function parseLyrics(lrc: string): LyricLine[] {
  const result: LyricLine[] = []
  const offset = Number(lrc.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0)
  for (const line of lrc.split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    const text = line.replace(/\[[^\]]*\]/g, '').trim()
    if (!text) continue
    for (const tag of tags)
      result.push({
        time: Math.max(
          0,
          Number(tag[1]) * 60000 +
            Number(tag[2]) * 1000 +
            Number((tag[3] || '').padEnd(3, '0')) -
            offset,
        ),
        text,
      })
  }
  return result.sort((a, b) => a.time - b.time)
}

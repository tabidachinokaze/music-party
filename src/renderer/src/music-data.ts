import type { Artist, Method, Playlist, Song } from '../../shared/types'
import { toSong } from '../../shared/protocol'
export type ApiCall = (method: Method, args?: Record<string, unknown>) => Promise<any>
export function playlistFrom(value: any): Playlist {
  return {
    id: String(value.id),
    name: value.name || '未命名歌单',
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
    if (!Array.isArray(body.playlist)) throw new Error('歌单响应格式异常，请重试')
    const before = byId.size
    for (const item of body.playlist) byId.set(String(item.id), playlistFrom(item))
    progress([...byId.values()])
    if (!body.more) return [...byId.values()]
    if (!body.playlist.length || before === byId.size)
      throw new Error('服务端重复返回同一页，歌单尚未加载完整，请刷新重试')
    offset += body.playlist.length
  }
  return []
}
export async function songsByIds(api: ApiCall, ids: string[]): Promise<Song[]> {
  if (!ids.length) return []
  const body = await api('song', { ids: ids.join(',') })
  if (!Array.isArray(body.songs)) throw new Error('歌曲响应格式异常')
  const byId = new Map<string, Song>(body.songs.map((s: any) => [String(s.id), toSong(s)]))
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
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

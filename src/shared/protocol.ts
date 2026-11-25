import { t } from './ui-language'
import type { MultiInvitation, MusicianCredit, Room, Song } from './types'

export function parseInvitation(input: string): MultiInvitation {
  // Clipboard text from Markdown editors can contain literal \& or HTML-escaped separators.
  // Normalize only separators; do not decode arbitrary percent escapes or accept other hosts.
  const normalized = input
    .trim()
    .replace(/\\&/g, '&')
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
  const destination = normalized.match(/\]\(\s*<?(https:\/\/[^\s<>"\)]+)>?\s*\)/)
  const match = destination || normalized.match(/https:\/\/[^\s<>"“”\]\)]+/)
  if (!match) throw new Error(t('protocol.pasteTheFullNeteaseListenTogetherInvitationLink'))
  let url: URL
  try {
    url = new URL(destination ? destination[1] : match[0])
  } catch {
    throw new Error(t('protocol.invalidInvitationLink'))
  }
  if (url.hostname !== 'st.music.163.com' || url.username || url.password || url.port)
    throw new Error(t('protocol.useAnOfficialNeteaseGroupRoomInvitationLink'))
  const path = url.pathname.replace(/\/$/, '')
  if (path === '/listen-together/share')
    throw new Error(t('protocol.thisInvitationIsForTwoListenersCopyA'))
  if (path !== '/listen-together/multishare/index.html')
    throw new Error(t('protocol.unsupportedNeteaseGroupInvitationLink'))
  if (
    url.searchParams.getAll('roomId').length !== 1 ||
    url.searchParams.getAll('inviterUid').length !== 1 ||
    url.searchParams.getAll('isFLT').length > 1
  )
    throw new Error(t('protocol.missingOrDuplicateInvitationParameters'))
  if (url.searchParams.has('isFLT') && url.searchParams.get('isFLT') !== 'false')
    throw new Error(t('protocol.thisIsAFollowAlongLinkUseA'))
  const roomId = url.searchParams.get('roomId') || ''
  const inviterUid = url.searchParams.get('inviterUid') || ''
  if (!/^[\w-]{1,128}$/.test(roomId) || !/^\d{1,24}$/.test(inviterUid))
    throw new Error(t('protocol.theInvitationDoesNotContainAValidRoom'))
  return { roomId, inviterUid, isFLT: false }
}

export function invitation(room: Room): string {
  const url = new URL('https://st.music.163.com/listen-together/multishare/index.html')
  url.searchParams.set('roomId', room.roomId)
  url.searchParams.set('inviterUid', room.inviterUid)
  url.searchParams.set('isFLT', 'false')
  return url.toString()
}

function musicianCredits(value: unknown): MusicianCredit[] {
  const entries = Array.isArray(value) ? value : [value]
  return entries.flatMap((entry) => {
    const name = typeof entry === 'string' ? entry : entry?.name
    if (typeof name !== 'string' || !name.trim()) return []
    const id = String(entry?.id || '')
    return [{ name: name.trim(), ...(/^[1-9]\d*$/.test(id) ? { id } : {}) }]
  })
}

export function toSong(song: any): Song {
  const artists = musicianCredits(song.ar || song.artists)
  const composers = musicianCredits(song.composers || song.composer)
  const album = song.al || song.album
  const albumId = String(album?.id || '')
  return {
    id: String(song.id),
    name: song.name || t('common.unknownTrack'),
    artist: artists.map((credit) => credit.name).join(' / '),
    ...(artists.length ? { artists } : {}),
    ...(composers.length ? { composers } : {}),
    album: album?.name || '',
    ...(/^[1-9]\d*$/.test(albumId) ? { albumId } : {}),
    cover: album?.picUrl || '',
    duration: song.dt || song.duration || 0,
  }
}

export function queueIds(body: any): string[] | null {
  const ids = body?.data?.playlist?.displayList?.result
  return Array.isArray(ids) && ids.every((id) => /^\d+$/.test(String(id))) ? ids.map(String) : null
}

// Keep protocol diagnostics useful without exporting account credentials, URLs or private messages.
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /cookie|token|secret|authorization|password|MUSIC_[UA]|csrf|NMTID|qrimg|qrurl|unikey|^key$|avatar|nickname|^url$|^msg$|^text$|msgBody|msgRichText|mainStateText|^content$|^emoji$/i.test(
          key,
        )
          ? t('protocol.valueRedacted')
          : redact(item),
      ]),
    )
  if (typeof value === 'string')
    return value
      .replace(/https?:\/\/\S+/g, () => t('protocol.linkRedacted'))
      .replace(/(?:MUSIC_[UA]|__csrf|NMTID)=[^;\s]+/g, () => t('protocol.credentialsRedacted'))
  return value
}

export class SerialCommands {
  private tail: Promise<unknown> = Promise.resolve()
  private sequence = 0
  run<T>(task: (sequence: number) => Promise<T>): Promise<T> {
    const next = this.tail.then(() => task(++this.sequence))
    this.tail = next.catch(() => undefined)
    return next
  }
}

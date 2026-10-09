import type { MessageAttachment } from './types'
import { musicMessageLink } from './message-content'

export type MessageMusicResource = { type: 'song' | 'album'; id: string }

/** Route only definite music resources to the app's own catalog and playback. */
export function messageMusicResource(value: unknown): MessageMusicResource | undefined {
  const safe = musicMessageLink(value)
  if (!safe) return
  const url = new URL(safe)
  const route = /^#\/(song|album)(?:\/)?(?:\?|$)/.test(url.hash)
    ? new URL(url.hash.slice(1), url.origin)
    : url
  const match = route.pathname.match(/^\/(song|album)\/?$/)
  const id = route.searchParams.get('id')
  if (!match || !id || !/^[1-9]\d{0,23}$/.test(id) || route.searchParams.getAll('id').length !== 1)
    return
  return { type: match[1] as 'song' | 'album', id }
}

export function attachmentMusicResource(item: MessageAttachment): MessageMusicResource | undefined {
  if (
    (item.resourceType === 'song' || item.resourceType === 'album') &&
    /^[1-9]\d{0,23}$/.test(item.resourceId || '')
  )
    return { type: item.resourceType, id: item.resourceId! }
  return messageMusicResource(item.actionUrl)
}

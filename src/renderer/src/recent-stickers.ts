import type { ChatEmoji } from '../../shared/types'
import { parseEmoji } from '../../shared/message-content'

type Use = { emoji: ChatEmoji; time: number }
const key = (account: string) => `music-party.recent-stickers.${account}`

function read(account: string): Use[] {
  if (!account) return []
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key(account)) || '[]')
    if (!Array.isArray(rows)) return []
    return rows.slice(0, 32).flatMap((row) => {
      const emoji = parseEmoji(row?.emoji)
      return emoji && Number.isSafeInteger(row?.time) ? [{ emoji, time: row.time }] : []
    })
  } catch {
    return []
  }
}

export function recentStickers(account: string) {
  return read(account).map((entry) => entry.emoji)
}

export function rememberRecentStickers(account: string, incoming: Use[]) {
  if (!account || !incoming.length) return
  const previous = read(account)
  const byId = new Map<string, Use>()
  // Polling and older history pages can replay the same message. Keep the newest use.
  for (const use of [...incoming, ...previous].sort((a, b) => b.time - a.time)) {
    const emoji = parseEmoji(use.emoji)
    if (!emoji) continue
    const identity = emoji.emojiId === '0' ? emoji.emojiImgUrl : emoji.emojiId
    if (!byId.has(identity)) byId.set(identity, { emoji, time: use.time })
    if (byId.size === 32) break
  }
  const encoded = JSON.stringify([...byId.values()])
  if (encoded !== JSON.stringify(previous)) {
    try {
      localStorage.setItem(key(account), encoded)
    } catch {
      // A full or unavailable profile store must not change the outcome of a chat send.
    }
  }
}

import type { Conversation, PrivateMessage } from './types'

export interface ReadBoundary {
  time: number
  messageIds: string[]
}
export function privateReadBoundary(
  messages: PrivateMessage[],
  peerUid: string,
): ReadBoundary | null {
  const incoming = messages.filter(
    (message) =>
      message.senderId === peerUid && !message.delivery && message.id.startsWith('server:'),
  )
  if (!incoming.length) return null
  const time = Math.max(...incoming.map((message) => message.time))
  return {
    time,
    messageIds: incoming
      .filter((message) => message.time === time)
      .map((message) => message.id.slice(7)),
  }
}
export function boundaryCovers(
  boundary: ReadBoundary | undefined,
  time: number,
  messageId?: string,
): boolean {
  return (
    !!boundary &&
    (time < boundary.time ||
      (time === boundary.time && !!messageId && boundary.messageIds.includes(messageId)))
  )
}
export function sortPrivateContacts(contacts: Conversation[]): Conversation[] {
  return [...contacts].sort(
    (a, b) =>
      Number(b.online === true) - Number(a.online === true) ||
      b.time - a.time ||
      a.uid.localeCompare(b.uid),
  )
}

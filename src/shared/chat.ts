import type { ChatMessage, ChatPage } from './types'
export const CHAT_MAX_LENGTH = 100
function object(value: any): any {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {}
  }
  return {}
}
export function parseChatPage(body: any, roomId: string, viewerUid: string): ChatPage {
  const data = body?.data
  if (!data || !Array.isArray(data.records)) throw new Error('聊天记录响应格式异常，请稍后刷新')
  const messages: ChatMessage[] = []
  for (const raw of data.records) {
    if (!raw || (raw.roomId && raw.roomId !== roomId)) continue
    if (
      Array.isArray(raw.onlyCanSeeUserIds) &&
      raw.onlyCanSeeUserIds.length &&
      !raw.onlyCanSeeUserIds.some((id: unknown) => String(id) === viewerUid)
    )
      continue
    if (typeof raw.sendUid === 'number' && !Number.isSafeInteger(raw.sendUid)) continue
    const uid = String(raw.sendUid ?? '')
    const time = Number(raw.sendTime)
    if (!/^\d+$/.test(uid) || !Number.isSafeInteger(time) || time < 0) continue
    const msg = object(raw.imChatRoomMsgBody)
    let text = typeof msg.text === 'string' ? msg.text : typeof msg.msg === 'string' ? msg.msg : ''
    if (!text && typeof msg.mainStateText === 'string') text = msg.mainStateText
    if (!text && Array.isArray(msg.msgRichText?.contentTextList))
      text = msg.msgRichText.contentTextList
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
    if (!text)
      text = raw.emoji ? '[表情消息]' : raw.msgType === 2 ? '[推歌消息]' : '[暂不支持的消息]'
    // Official history deduplicates by sender + sendTime. No HTML or arbitrary links are executed.
    messages.push({
      id: `${uid}:${time}`,
      roomId,
      uid,
      nickname: typeof raw.nickname === 'string' ? raw.nickname : '听友',
      avatar: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : '',
      time,
      text: text.slice(0, 10000),
      kind: raw.msgType === 0 ? 'text' : 'notice',
    })
  }
  return {
    messages: mergeChat([], messages),
    more: data.page?.more === true,
    cursor: typeof data.page?.cursor === 'string' && data.page.cursor ? data.page.cursor : null,
  }
}
export function mergeChat(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map(previous.map((message) => [message.id, message]))
  for (const message of incoming) map.set(message.id, message)
  // A server echo replaces at most one optimistic message, even for repeated identical text.
  const server = [...map.values()].filter((m) => !m.delivery)
  const claimed = new Set<string>()
  for (const local of [...map.values()].filter((m) => m.delivery)) {
    const echo = server.find(
      (m) =>
        !claimed.has(m.id) &&
        m.roomId === local.roomId &&
        m.uid === local.uid &&
        m.text === local.text &&
        m.time > (local.echoAfter ?? -1) &&
        Math.abs(m.time - local.time) <= 60000,
    )
    if (echo) {
      claimed.add(echo.id)
      map.delete(local.id)
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
}
export function chatTrace(body: any) {
  return {
    code: body?.code,
    success: body?.data?.success,
    recordCount: Array.isArray(body?.data?.records) ? body.data.records.length : undefined,
    more: body?.data?.page?.more,
  }
}

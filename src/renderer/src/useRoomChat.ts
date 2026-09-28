import { useEffect, useRef, useState } from 'react'
import type { ChatEmoji, ChatMessage, Room } from '../../shared/types'
import { CHAT_MAX_LENGTH, mergeChat, parseChatPage } from '../../shared/chat'
import type { ApiCall } from './music-data'

export function useRoomChat(api: ApiCall, room: Room | null, account: any) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesRef = useRef<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [more, setMore] = useState(false)
  const [unread, setUnread] = useState(0)
  const [lastUpdate, setLastUpdate] = useState('')
  const [visible, setVisibleState] = useState(false)
  const visibleRef = useRef(false)
  const epoch = useRef(0)
  const olderCursor = useRef<string | null>(null)
  const hasLoaded = useRef(false)
  const fetching = useRef<Promise<void> | null>(null)
  const sendLock = useRef(false)
  function update(next: ChatMessage[]) {
    messagesRef.current = next
    setMessages(next)
  }
  function setVisible(value: boolean) {
    visibleRef.current = value
    setVisibleState(value)
    if (value) setUnread(0)
  }
  async function fetchMessages(older = false) {
    if (!room || !account || fetching.current) return fetching.current
    const roomId = room.roomId
    const run = epoch.current
    const cursor = older ? olderCursor.current : null
    if (older && !cursor) return
    setLoading(true)
    const task = (async () => {
      try {
        const body = await api('multiChatHistory', { roomId, ...(cursor ? { cursor } : {}) })
        if (run !== epoch.current) return
        const page = parseChatPage(body, roomId, String(account.userId))
        const previous = messagesRef.current
        if (hasLoaded.current && !older && !visibleRef.current) {
          const ids = new Set(previous.map((m) => m.id))
          setUnread(
            (count) =>
              count +
              page.messages.filter((m) => !ids.has(m.id) && m.uid !== String(account.userId))
                .length,
          )
        }
        update(mergeChat(previous, page.messages))
        if (!hasLoaded.current || older) {
          if (page.more && (!page.cursor || page.cursor === cursor)) {
            setMore(false)
            setError('聊天分页没有继续前进，请刷新后重试')
          } else {
            olderCursor.current = page.cursor
            setMore(page.more)
            setError('')
          }
        } else setError('')
        hasLoaded.current = true
        setLastUpdate(new Date().toLocaleTimeString('zh-CN'))
      } catch (e: any) {
        if (run === epoch.current) setError(e.message || '聊天记录暂不可用')
      } finally {
        if (run === epoch.current) setLoading(false)
      }
    })()
    fetching.current = task
    try {
      await task
    } finally {
      if (fetching.current === task) fetching.current = null
    }
  }
  useEffect(() => {
    epoch.current++
    fetching.current = null
    sendLock.current = false
    hasLoaded.current = false
    olderCursor.current = null
    update([])
    setDraft('')
    setError('')
    setMore(false)
    setUnread(0)
    setSending(false)
    setLoading(false)
    setLastUpdate('')
    if (!room || !account) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await fetchMessages()
      if (!stopped) timer = setTimeout(tick, visibleRef.current ? 3000 : 8000)
    }
    tick()
    return () => {
      stopped = true
      epoch.current++
      clearTimeout(timer)
    }
  }, [room?.roomId, account?.userId])
  useEffect(() => {
    if (visible && room) fetchMessages()
  }, [visible])
  async function send(emoji?: ChatEmoji) {
    if (!room || !account || !room.chatRoomId || sendLock.current) return
    const text = emoji ? `[${emoji.emojiName}]` : draft.trim()
    if (!text || text.length > CHAT_MAX_LENGTH) {
      setError(`请输入 1–${CHAT_MAX_LENGTH} 字的消息`)
      return
    }
    const run = epoch.current
    const requestId = crypto.randomUUID()
    const local: ChatMessage = {
      id: `local:${requestId}`,
      roomId: room.roomId,
      uid: String(account.userId),
      nickname: account.nickname || '我',
      avatar: account.avatarUrl || '',
      time: Date.now(),
      text,
      kind: emoji ? 'image' : 'text',
      ...(emoji
        ? {
            emoji,
            attachments: [
              { kind: 'image' as const, title: emoji.emojiName, url: emoji.emojiImgUrl },
            ],
          }
        : {}),
      delivery: 'sending',
      echoAfter: Math.max(
        -1,
        ...messagesRef.current
          .filter((m) => !m.delivery && m.uid === String(account.userId))
          .map((m) => m.time),
      ),
    }
    sendLock.current = true
    setSending(true)
    setError('')
    update(mergeChat(messagesRef.current, [local]))
    try {
      await api('multiChatSend', {
        roomId: room.roomId,
        text,
        requestId,
        ...(emoji ? { emoji } : {}),
      })
      if (run !== epoch.current) return
      update(mergeChat(messagesRef.current, [{ ...local, delivery: 'submitted' }]))
      if (!emoji) setDraft((current) => (current.trim() === text ? '' : current))
      await fetchMessages()
    } catch (e: any) {
      if (run !== epoch.current) return
      const ambiguous = e.deliveryUnknown === true
      const message =
        e.code === 405
          ? '发送过于频繁，请稍后再发'
          : e.code === 407
            ? '消息未通过服务端检查，请修改后重试'
            : ambiguous
              ? '发送结果未确认，请刷新聊天记录后再决定是否重发'
              : e.message || '发送失败'
      update(
        mergeChat(messagesRef.current, [
          { ...local, delivery: ambiguous ? 'uncertain' : 'failed', error: message },
        ]),
      )
      setError(message)
    } finally {
      if (run === epoch.current) {
        sendLock.current = false
        setSending(false)
      }
    }
  }
  return {
    messages,
    loading,
    error,
    sending,
    draft,
    setDraft,
    more,
    unread,
    lastUpdate,
    visible,
    setVisible,
    refresh: () => fetchMessages(),
    loadOlder: () => fetchMessages(true),
    send,
  }
}

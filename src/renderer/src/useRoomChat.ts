import { t, getUiLanguage } from '../../shared/ui-language'
import { useEffect, useRef, useState } from 'react'
import type { ChatEmoji, ChatMessage, Room } from '../../shared/types'
import { CHAT_MAX_LENGTH, mergeChat, parseChatPage } from '../../shared/chat'
import { rememberRecentStickers } from './recent-stickers'
import type { ApiCall } from './music-data'
import type { MediaReceipt, MediaTarget } from '../../shared/media'

export function useRoomChat(api: ApiCall, room: Room | null, account: any, displayed = false) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesRef = useRef<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [more, setMore] = useState(false)
  const [unread, setUnread] = useState(0)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const [visible, setVisibleState] = useState(false)
  const visibleRef = useRef(false)
  visibleRef.current = visible || displayed
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
    visibleRef.current = value || displayed
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
        rememberRecentStickers(
          String(account.userId),
          page.messages.flatMap(({ emoji, time }) => (emoji ? [{ emoji, time }] : [])),
        )
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
            setError(t('roomChat.olderMessagesAreTemporarilyUnavailable'))
          } else {
            olderCursor.current = page.cursor
            setMore(page.more)
            setError('')
          }
        } else setError('')
        hasLoaded.current = true
        setLastUpdate(Date.now())
      } catch (e: any) {
        if (run === epoch.current)
          setError(e.message || t('roomChat.chatHistoryIsTemporarilyUnavailable'))
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
    setLastUpdate(null)
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
    if ((visible || displayed) && room) {
      setUnread(0)
      fetchMessages()
    }
  }, [visible, displayed])
  async function send(emoji?: ChatEmoji) {
    if (!room || !account || !room.chatRoomId || sendLock.current) return
    const text = emoji ? `[${emoji.emojiName}]` : draft.trim()
    if (!text || text.length > CHAT_MAX_LENGTH) {
      setError(t('roomChat.enterAMessageOf1Characters', { limit: CHAT_MAX_LENGTH }))
      return
    }
    const run = epoch.current
    const requestId = crypto.randomUUID()
    const local: ChatMessage = {
      id: `local:${requestId}`,
      roomId: room.roomId,
      uid: String(account.userId),
      nickname: account.nickname || t('common.me'),
      avatar: account.avatarUrl || '',
      time: Date.now(),
      text,
      kind: emoji ? 'image' : 'text',
      ...(emoji
        ? {
            emoji,
            previewOnlyText: true,
            attachments: [
              { kind: 'image' as const, title: emoji.emojiName, url: emoji.emojiImgUrl, emoji },
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
      if (emoji) rememberRecentStickers(local.uid, [{ emoji, time: local.time }])
      if (run !== epoch.current) return
      update(mergeChat(messagesRef.current, [{ ...local, delivery: 'submitted' }]))
      if (!emoji) setDraft((current) => (current.trim() === text ? '' : current))
      await fetchMessages()
    } catch (e: any) {
      if (run !== epoch.current) return
      const ambiguous = e.deliveryUnknown === true
      const message =
        e.code === 405
          ? t('roomChat.youreSendingTooQuicklyTryAgainInA')
          : e.code === 407
            ? t('roomChat.theServerRejectedThisMessageEditItAnd')
            : ambiguous
              ? t('roomChat.deliveryUnconfirmedWaitForTheChatToUpdate')
              : e.message || t('common.sendFailed')
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
    api,
    acceptMedia(receipt: MediaReceipt, target: MediaTarget) {
      if (target.kind === 'room' && receipt.emoji)
        rememberRecentStickers(receipt.senderUid, [{ emoji: receipt.emoji, time: receipt.time }])
      if (
        target.kind !== 'room' ||
        target.roomId !== room?.roomId ||
        receipt.senderUid !== String(account?.userId)
      )
        return
      update(
        mergeChat(messagesRef.current, [
          {
            id: `local:${receipt.requestId}`,
            roomId: target.roomId,
            uid: receipt.senderUid,
            nickname: account?.nickname || t('common.me'),
            avatar: account?.avatarUrl || '',
            time: receipt.time,
            text: receipt.text,
            previewOnlyText: receipt.attachments.length > 0,
            kind: 'image',
            emoji: receipt.emoji,
            attachments: receipt.attachments,
            delivery: 'submitted',
            echoAfter: Math.max(
              -1,
              ...messagesRef.current
                .filter((message) => !message.delivery && message.uid === receipt.senderUid)
                .map((message) => message.time),
            ),
          },
        ]),
      )
      fetchMessages()
    },
    messages,
    loading,
    error,
    sending,
    draft,
    setDraft,
    more,
    unread,
    lastUpdate: lastUpdate === null ? '' : new Date(lastUpdate).toLocaleTimeString(getUiLanguage()),
    visible,
    setVisible,
    loadOlder: () => fetchMessages(true),
    send,
  }
}

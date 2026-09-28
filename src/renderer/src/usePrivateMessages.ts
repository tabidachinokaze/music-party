import { useEffect, useRef, useState } from 'react'
import type { Conversation, PrivateMessage, Room } from '../../shared/types'
import {
  inviteText,
  mergeConversations,
  mergePrivate,
  parseConversations,
  parsePrivatePage,
  PRIVATE_TEXT_LIMIT,
} from '../../shared/private-messages'
import type { ApiCall } from './music-data'
import type { MediaReceipt, MediaTarget } from '../../shared/media'

export function usePrivateMessages(api: ApiCall, account: any, visible: boolean) {
  const selfUid = account ? String(account.userId) : ''
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationMore, setConversationMore] = useState(false)
  const [conversationBusy, setConversationBusy] = useState(false)
  const [conversationError, setConversationError] = useState('')
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<PrivateMessage[]>([])
  const [historyMore, setHistoryMore] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [readError, setReadError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [contacts, setContacts] = useState<Conversation[]>([])
  const [contactsMore, setContactsMore] = useState(false)
  const [contactsBusy, setContactsBusy] = useState(false)
  const [contactsError, setContactsError] = useState('')
  const accountEpoch = useRef(0),
    historyEpoch = useRef(0)
  const selectedRef = useRef<Conversation | null>(null)
  const convRef = useRef<Conversation[]>([]),
    messagesRef = useRef<PrivateMessage[]>([])
  const convOffset = useRef(0),
    contactsOffset = useRef(0),
    before = useRef<number | null>(null)
  const convPending = useRef<Promise<void> | null>(null),
    historyPending = useRef<Promise<void> | null>(null)
  const contactsLock = useRef(false),
    sendLock = useRef(false),
    initializedHistory = useRef(false)
  const drafts = useRef(new Map<string, string>())
  const readThrough = useRef(new Map<string, number>())
  const serverConversationTime = useRef(new Map<string, number>())
  const readPending = useRef(new Set<string>())
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const draftRef = useRef(draft)
  draftRef.current = draft
  function updateConversations(next: Conversation[]) {
    convRef.current = next
    setConversations(next)
  }
  function updateMessages(next: PrivateMessage[]) {
    messagesRef.current = next
    setMessages(next)
  }
  async function fetchConversations(older = false) {
    if (!selfUid || convPending.current) return convPending.current
    const epoch = accountEpoch.current,
      offset = older ? convOffset.current : 0
    setConversationBusy(true)
    const task = (async () => {
      try {
        const page = parseConversations(await api('privateConversations', { offset }), selfUid)
        if (epoch !== accountEpoch.current) return
        for (const conversation of page.conversations)
          serverConversationTime.current.set(conversation.uid, conversation.time)
        if (
          older &&
          page.more &&
          (!page.count ||
            page.conversations.every((c) => convRef.current.some((old) => old.uid === c.uid)))
        )
          throw new Error('会话分页未继续前进，请稍后刷新')
        updateConversations(
          mergeConversations(
            convRef.current,
            page.conversations.map((c) =>
              (readThrough.current.get(c.uid) ?? -1) >= c.time ? { ...c, unread: 0 } : c,
            ),
          ),
        )
        if (older || convOffset.current === 0) {
          convOffset.current = offset + page.count
          setConversationMore(page.more)
        }
        setConversationError('')
      } catch (e: any) {
        if (epoch === accountEpoch.current) setConversationError(e.message || '私信列表加载失败')
      } finally {
        if (epoch === accountEpoch.current) setConversationBusy(false)
      }
    })()
    convPending.current = task
    try {
      await task
    } finally {
      if (convPending.current === task) convPending.current = null
    }
  }
  async function markRead(peer: Conversation, through: number) {
    if (
      !visibleRef.current ||
      document.visibilityState !== 'visible' ||
      !document.hasFocus() ||
      selectedRef.current?.uid !== peer.uid
    )
      return
    if ((readThrough.current.get(peer.uid) ?? -1) >= through || readPending.current.has(peer.uid))
      return
    const accountRun = accountEpoch.current
    readPending.current.add(peer.uid)
    try {
      await api('privateRead', { uid: peer.uid })
      if (accountRun !== accountEpoch.current) return
      readThrough.current.set(peer.uid, through)
      updateConversations(
        convRef.current.map((c) =>
          c.uid === peer.uid && (serverConversationTime.current.get(c.uid) || 0) <= through
            ? { ...c, unread: 0 }
            : c,
        ),
      )
      if (selectedRef.current?.uid === peer.uid) setReadError('')
    } catch (error: any) {
      if (accountRun === accountEpoch.current && selectedRef.current?.uid === peer.uid)
        setReadError(error.message || '已读状态同步失败')
    } finally {
      if (accountRun === accountEpoch.current) readPending.current.delete(peer.uid)
    }
  }
  async function fetchHistory(older = false) {
    const peer = selectedRef.current
    if (!selfUid || !peer || historyPending.current) return historyPending.current
    const epoch = historyEpoch.current,
      requestBefore = older ? before.current : null
    const conversationTime = serverConversationTime.current.get(peer.uid) || 0
    if (older && !requestBefore) return
    setHistoryBusy(true)
    const task = (async () => {
      try {
        const page = parsePrivatePage(
          await api('privateHistory', {
            uid: peer.uid,
            ...(requestBefore ? { before: requestBefore } : {}),
          }),
          selfUid,
          peer.uid,
        )
        if (epoch !== historyEpoch.current) return
        updateMessages(mergePrivate(messagesRef.current, page.messages))
        if (older || !initializedHistory.current) {
          if (page.more && (!page.before || (requestBefore && page.before >= requestBefore)))
            throw new Error('历史分页没有继续前进，请刷新重试')
          before.current = page.before
          setHistoryMore(page.more)
        }
        initializedHistory.current = true
        setHistoryError('')
        if (!older) {
          const through = Math.max(
            conversationTime,
            ...page.messages
              .filter((message) => message.senderId === peer.uid)
              .map((message) => message.time),
          )
          await markRead(peer, through)
        }
      } catch (e: any) {
        if (epoch === historyEpoch.current) setHistoryError(e.message || '私信内容加载失败')
      } finally {
        if (epoch === historyEpoch.current) setHistoryBusy(false)
      }
    })()
    historyPending.current = task
    try {
      await task
    } finally {
      if (historyPending.current === task) historyPending.current = null
    }
  }
  function select(peer: Conversation) {
    if (peer.uid === selfUid || peer.uid === selectedRef.current?.uid) return
    if (selectedRef.current) drafts.current.set(selectedRef.current.uid, draftRef.current)
    historyEpoch.current++
    historyPending.current = null
    initializedHistory.current = false
    before.current = null
    selectedRef.current = peer
    setSelected(peer)
    updateMessages([])
    setHistoryMore(false)
    setHistoryError('')
    setReadError('')
    setHistoryBusy(false)
    const nextDraft = drafts.current.get(peer.uid) || ''
    setDraft(nextDraft)
    draftRef.current = nextDraft
    updateConversations(mergeConversations(convRef.current, [peer]))
  }
  useEffect(() => {
    accountEpoch.current++
    historyEpoch.current++
    convPending.current = historyPending.current = null
    convOffset.current = contactsOffset.current = 0
    before.current = null
    initializedHistory.current = false
    selectedRef.current = null
    setSelected(null)
    updateConversations([])
    updateMessages([])
    drafts.current.clear()
    readThrough.current.clear()
    serverConversationTime.current.clear()
    readPending.current.clear()
    setReadError('')
    setDraft('')
    draftRef.current = ''
    sendLock.current = contactsLock.current = false
    setSending(false)
    setContactsBusy(false)
    setConversationBusy(false)
    setHistoryBusy(false)
    setContacts([])
    setContactsMore(false)
    setConversationMore(false)
    setHistoryMore(false)
    setConversationError('')
    setHistoryError('')
    setContactsError('')
    if (!selfUid) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await fetchConversations()
      if (!stopped) timer = setTimeout(tick, visibleRef.current ? 15000 : 60000)
    }
    tick()
    return () => {
      stopped = true
      accountEpoch.current++
      historyEpoch.current++
      clearTimeout(timer)
    }
  }, [selfUid])
  useEffect(() => {
    if (!visible || !selfUid || !selected) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await fetchHistory()
      if (!stopped) timer = setTimeout(tick, 5000)
    }
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [selected?.uid, selfUid, visible])
  useEffect(() => {
    if (visible) fetchConversations()
  }, [visible])
  useEffect(() => {
    const refreshVisible = () => {
      if (visibleRef.current && document.visibilityState === 'visible' && document.hasFocus())
        fetchHistory()
    }
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [selfUid])
  async function loadContacts(older = false) {
    if (!selfUid || contactsLock.current) return
    contactsLock.current = true
    setContactsBusy(true)
    setContactsError('')
    const epoch = accountEpoch.current
    const offset = older ? contactsOffset.current : 0
    try {
      const body = await api('follows', { uid: selfUid, offset })
      if (epoch !== accountEpoch.current) return
      if (!Array.isArray(body.follow)) throw new Error('关注列表响应异常')
      const people: Conversation[] = body.follow
        .filter((p: any) => /^[1-9]\d*$/.test(String(p.userId)) && String(p.userId) !== selfUid)
        .map((p: any) => ({
          uid: String(p.userId),
          nickname: p.nickname || `用户 ${p.userId}`,
          avatar: p.avatarUrl || '',
          preview: '',
          time: 0,
          unread: 0,
        }))
      if (
        body.more &&
        (!body.follow.length ||
          (older && people.every((person) => contacts.some((old) => old.uid === person.uid))))
      )
        throw new Error('联系人分页暂不可用')
      contactsOffset.current = offset + body.follow.length
      setContacts((old) => (older ? mergeConversations(old, people) : people))
      setContactsMore(body.more === true)
    } catch (e: any) {
      if (epoch === accountEpoch.current) setContactsError(e.message)
    } finally {
      if (epoch === accountEpoch.current) {
        contactsLock.current = false
        setContactsBusy(false)
      }
    }
  }
  async function send(room?: Room) {
    const peer = selectedRef.current
    const text = room ? inviteText(room.roomId, selfUid) : draftRef.current.trim()
    if (!peer || !selfUid || sendLock.current || !text || text.length > PRIVATE_TEXT_LIMIT)
      return false
    const userEpoch = accountEpoch.current,
      run = historyEpoch.current
    const requestId = crypto.randomUUID()
    const local: PrivateMessage = {
      id: `local:${requestId}`,
      senderId: selfUid,
      recipientId: peer.uid,
      time: Date.now(),
      text,
      invitations: room ? [{ roomId: room.roomId, inviterUid: selfUid, isFLT: false }] : [],
      delivery: 'sending',
      echoAfter: Math.max(
        -1,
        ...messagesRef.current
          .filter((m) => !m.delivery && m.senderId === selfUid)
          .map((m) => m.time),
      ),
    }
    sendLock.current = true
    setSending(true)
    setHistoryError('')
    updateMessages(mergePrivate(messagesRef.current, [local]))
    try {
      await api(room ? 'privateInvite' : 'privateSend', {
        uid: peer.uid,
        ...(room ? { roomId: room.roomId } : { text }),
        requestId,
      })
      if (userEpoch !== accountEpoch.current) return false
      if (run === historyEpoch.current) {
        updateMessages(mergePrivate(messagesRef.current, [{ ...local, delivery: 'submitted' }]))
        if (!room) setDraft((current) => (current.trim() === text ? '' : current))
        await fetchHistory()
      } else if (!room && drafts.current.get(peer.uid)?.trim() === text)
        drafts.current.set(peer.uid, '')
      updateConversations(
        mergeConversations(convRef.current, [
          {
            ...peer,
            unread: convRef.current.find((c) => c.uid === peer.uid)?.unread || 0,
            time: Math.max(
              serverConversationTime.current.get(peer.uid) || 0,
              ...messagesRef.current
                .filter(
                  (message) =>
                    !message.delivery &&
                    (message.senderId === peer.uid || message.recipientId === peer.uid),
                )
                .map((message) => message.time),
            ),
            preview: text,
          },
        ]),
      )
      return true
    } catch (e: any) {
      if (userEpoch !== accountEpoch.current) return false
      if (run === historyEpoch.current) {
        const message = e.deliveryUnknown
          ? '发送结果未确认，请刷新私信后再决定是否重发'
          : e.message || '发送失败，请重试'
        updateMessages(
          mergePrivate(messagesRef.current, [
            { ...local, delivery: e.deliveryUnknown ? 'uncertain' : 'failed', error: message },
          ]),
        )
        setHistoryError(message)
      }
      return false
    } finally {
      if (userEpoch === accountEpoch.current) {
        sendLock.current = false
        setSending(false)
      }
    }
  }
  return {
    acceptMedia(receipt: MediaReceipt, target: MediaTarget) {
      if (target.kind !== 'private' || receipt.senderUid !== selfUid) return
      if (selectedRef.current?.uid === target.uid) {
        updateMessages(
          mergePrivate(messagesRef.current, [
            {
              id: receipt.messageId ? `server:${receipt.messageId}` : `local:${receipt.requestId}`,
              senderId: selfUid,
              recipientId: target.uid,
              time: receipt.time,
              text: receipt.text,
              attachments: receipt.attachments,
              invitations: [],
              delivery: 'submitted',
              echoAfter: Math.max(
                -1,
                ...messagesRef.current
                  .filter((message) => !message.delivery && message.senderId === selfUid)
                  .map((message) => message.time),
              ),
            },
          ]),
        )
        fetchHistory()
      }
      fetchConversations()
    },
    conversations,
    conversationMore,
    conversationBusy,
    conversationError,
    selected,
    select,
    messages,
    historyMore,
    historyBusy,
    historyError,
    readError,
    draft,
    setDraft,
    sending,
    send,
    unread: conversations.reduce((sum, c) => sum + c.unread, 0),
    refreshConversations: () => fetchConversations(),
    loadConversations: () => fetchConversations(true),
    refreshHistory: () => fetchHistory(),
    loadHistory: () => fetchHistory(true),
    contacts,
    contactsMore,
    contactsBusy,
    contactsError,
    loadContacts,
  }
}

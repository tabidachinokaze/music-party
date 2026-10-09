import { PrivateHistoryGaps } from '../../shared/private-history-gaps'
import { useEffect, useRef, useState } from 'react'
import type {
  ChatEmoji,
  Conversation,
  PrivateMessage,
  Room,
  AccountNotifications,
} from '../../shared/types'
import {
  privateReadBoundary,
  boundaryCovers,
  sortPrivateContacts,
  type ReadBoundary,
} from '../../shared/private-activity'
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
  const historyGaps = useRef(new PrivateHistoryGaps())
  const historyMemory = useRef(
    new Map<
      string,
      {
        messages: PrivateMessage[]
        before: number | null
        more: boolean
        initialized: boolean
        gaps: { after: number; before: number }[]
      }
    >(),
  )
  const [contacts, setContacts] = useState<Conversation[]>([])
  const [contactsMore, setContactsMore] = useState(false)
  const [contactsBusy, setContactsBusy] = useState(false)
  const [contactsError, setContactsError] = useState('')
  const [notificationsConnected, setNotificationsConnected] = useState(false)
  const [notificationInbox, setNotificationInbox] = useState<Conversation[]>([])
  const notificationCursor = useRef({ session: '', cursor: 0 })
  const pushRevision = useRef(0)
  const noticeSeen = useRef(new Set<string>())
  const presence = useRef(new Map<string, boolean | null>())
  const presenceChecked = useRef(new Map<string, number>())
  const presencePending = useRef(new Set<string>())
  const unreadNotices = useRef(new Map<string, { time: number; id: string }[]>())
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
  const conversationDirty = useRef(false),
    historyDirty = useRef(false)
  const contactsRef = useRef<Conversation[]>([])
  contactsRef.current = contacts
  const contactsLock = useRef(false),
    sendLock = useRef(false),
    initializedHistory = useRef(false)
  const drafts = useRef(new Map<string, string>())
  const readThrough = useRef(new Map<string, ReadBoundary>())
  const serverConversationTime = useRef(new Map<string, number>())
  const readPending = useRef(new Set<string>())
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const draftRef = useRef(draft)
  draftRef.current = draft
  function updateConversations(next: Conversation[]) {
    next = sortPrivateContacts(
      next.map((peer) => ({
        ...peer,
        online: presence.current.has(peer.uid)
          ? presence.current.get(peer.uid)!
          : (peer.online ?? null),
      })),
    )
    if (JSON.stringify(next) === JSON.stringify(convRef.current)) return
    convRef.current = next
    setConversations(next)
  }
  function updateMessages(next: PrivateMessage[]) {
    if (JSON.stringify(next) === JSON.stringify(messagesRef.current)) return
    messagesRef.current = next
    setMessages(next)
  }
  async function refreshPresence(peers: Conversation[]) {
    const epoch = accountEpoch.current
    const due = [...new Map(peers.map((peer) => [peer.uid, peer])).values()].filter(
      (peer) =>
        !presencePending.current.has(peer.uid) &&
        Date.now() - (presenceChecked.current.get(peer.uid) || 0) >= 45000,
    )
    due.forEach((peer) => presencePending.current.add(peer.uid))
    let offset = 0
    const work = async () => {
      while (offset < due.length && epoch === accountEpoch.current) {
        const peer = due[offset++]
        try {
          const result = (await api('privatePresence', { uid: peer.uid })).data
          if (epoch !== accountEpoch.current) return
          const online =
            result?.uid === peer.uid && typeof result.online === 'boolean' ? result.online : null
          presence.current.set(peer.uid, online)
          presenceChecked.current.set(peer.uid, Date.now())
          updateConversations(convRef.current)
          setContacts((items) =>
            sortPrivateContacts(items.map((c) => (c.uid === peer.uid ? { ...c, online } : c))),
          )
          if (selectedRef.current?.uid === peer.uid) {
            selectedRef.current = { ...selectedRef.current, online }
            setSelected(selectedRef.current)
          }
          setNotificationInbox((items) =>
            items.map((c) => (c.uid === peer.uid ? { ...c, online } : c)),
          )
        } catch {
          if (epoch === accountEpoch.current) {
            presence.current.set(peer.uid, null)
            presenceChecked.current.set(peer.uid, Date.now() - 15000)
            updateConversations(convRef.current)
            setContacts((items) =>
              sortPrivateContacts(
                items.map((c) => (c.uid === peer.uid ? { ...c, online: null } : c)),
              ),
            )
            if (selectedRef.current?.uid === peer.uid) {
              selectedRef.current = { ...selectedRef.current, online: null }
              setSelected(selectedRef.current)
            }
            setNotificationInbox((items) =>
              items.map((c) => (c.uid === peer.uid ? { ...c, online: null } : c)),
            )
          }
        } finally {
          if (epoch === accountEpoch.current) presencePending.current.delete(peer.uid)
        }
      }
    }
    await Promise.all([work(), work()])
  }
  async function fetchConversations(older = false) {
    if (!selfUid) return
    if (convPending.current) {
      if (!older) conversationDirty.current = true
      return convPending.current
    }
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
            page.conversations.map((c) => {
              const boundary = readThrough.current.get(c.uid)
              const pending = unreadNotices.current.get(c.uid) || []
              return boundary &&
                c.time <= boundary.time &&
                pending.every((m) => boundaryCovers(boundary, m.time, m.id))
                ? { ...c, unread: 0 }
                : { ...c, unread: Math.max(c.unread, pending.length) }
            }),
          ),
        )
        if (older || convOffset.current === 0) {
          convOffset.current = offset + page.count
          setConversationMore(page.more)
        }
        setConversationError('')
        void refreshPresence([...convRef.current, ...contactsRef.current])
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
      if (epoch === accountEpoch.current && conversationDirty.current) {
        conversationDirty.current = false
        void fetchConversations()
      }
    }
  }
  async function markRead(peer: Conversation, through: ReadBoundary | null) {
    if (
      !through ||
      !visibleRef.current ||
      document.visibilityState !== 'visible' ||
      !document.hasFocus() ||
      selectedRef.current?.uid !== peer.uid
    )
      return
    const previous = readThrough.current.get(peer.uid)
    if (
      (previous && through.messageIds.every((id) => boundaryCovers(previous, through.time, id))) ||
      readPending.current.has(peer.uid)
    )
      return
    const accountRun = accountEpoch.current
    readPending.current.add(peer.uid)
    try {
      await api('privateRead', { uid: peer.uid })
      if (accountRun !== accountEpoch.current) return
      readThrough.current.set(peer.uid, through)
      unreadNotices.current.set(
        peer.uid,
        (unreadNotices.current.get(peer.uid) || []).filter(
          (m) => !boundaryCovers(through, m.time, m.id),
        ),
      )
      updateConversations(
        convRef.current.map((c) =>
          c.uid === peer.uid &&
          Math.max(c.time, serverConversationTime.current.get(c.uid) || 0) <= through.time &&
          !unreadNotices.current.get(peer.uid)?.length
            ? { ...c, unread: 0 }
            : c,
        ),
      )
      setNotificationInbox((items) =>
        items.map((c) =>
          c.uid === peer.uid &&
          c.time <= through.time &&
          !unreadNotices.current.get(peer.uid)?.length
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
    if (!selfUid || !peer) return
    if (historyPending.current) {
      if (!older) historyDirty.current = true
      return historyPending.current
    }
    const epoch = historyEpoch.current,
      gapCursor = older ? historyGaps.current.next() : null,
      requestBefore = older ? (gapCursor ?? before.current) : null
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
        if (gapCursor !== null) historyGaps.current.accept(gapCursor, page)
        else if (!older) historyGaps.current.observe(messagesRef.current, page)
        updateMessages(mergePrivate(messagesRef.current, page.messages))
        if ((older && gapCursor === null) || !initializedHistory.current) {
          if (page.more && (!page.before || (requestBefore && page.before >= requestBefore)))
            throw new Error('历史分页没有继续前进，请刷新重试')
          before.current = page.before
          setHistoryMore(page.more)
        }
        initializedHistory.current = true
        setHistoryError('')
        if (!older) {
          // Match the mod's bounded foreground catch-up without moving the history cursor.
          for (let count = 0; count < 2 && visibleRef.current && document.hasFocus(); count++) {
            const cursor = historyGaps.current.next()
            if (cursor === null) break
            const missing = parsePrivatePage(
              await api('privateHistory', { uid: peer.uid, before: cursor }),
              selfUid,
              peer.uid,
            )
            if (epoch !== historyEpoch.current) return
            historyGaps.current.accept(cursor, missing)
            updateMessages(mergePrivate(messagesRef.current, missing.messages))
          }
          const through = privateReadBoundary(page.messages, peer.uid)
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
      if (epoch === historyEpoch.current && historyDirty.current && visibleRef.current) {
        historyDirty.current = false
        void fetchHistory()
      }
    }
  }
  function select(peer: Conversation) {
    if (peer.uid === selfUid || peer.uid === selectedRef.current?.uid) return
    if (selectedRef.current) {
      const previous = selectedRef.current.uid
      drafts.current.set(previous, draftRef.current)
      historyMemory.current.delete(previous)
      historyMemory.current.set(previous, {
        messages: messagesRef.current,
        before: before.current,
        more: historyMore,
        initialized: initializedHistory.current,
        gaps: historyGaps.current.snapshot(),
      })
      while (historyMemory.current.size > 20)
        historyMemory.current.delete(historyMemory.current.keys().next().value!)
    }
    const memory = historyMemory.current.get(peer.uid)
    historyEpoch.current++
    historyPending.current = null
    historyDirty.current = false
    initializedHistory.current = false
    before.current = null
    historyGaps.current.clear()
    selectedRef.current = peer
    setSelected(peer)
    initializedHistory.current = memory?.initialized ?? false
    before.current = memory?.before ?? null
    historyGaps.current.restore(memory?.gaps ?? [])
    updateMessages(memory?.messages ?? [])
    setHistoryMore(memory?.more ?? false)
    setHistoryError('')
    setReadError('')
    setHistoryBusy(false)
    const nextDraft = drafts.current.get(peer.uid) || ''
    setDraft(nextDraft)
    draftRef.current = nextDraft
    updateConversations(mergeConversations(convRef.current, [peer]))
    void refreshPresence([peer])
  }
  useEffect(() => {
    accountEpoch.current++
    historyEpoch.current++
    convPending.current = historyPending.current = null
    conversationDirty.current = historyDirty.current = false
    convOffset.current = contactsOffset.current = 0
    before.current = null
    historyGaps.current.clear()
    initializedHistory.current = false
    selectedRef.current = null
    setSelected(null)
    updateConversations([])
    updateMessages([])
    drafts.current.clear()
    historyMemory.current.clear()
    readThrough.current.clear()
    unreadNotices.current.clear()
    presence.current.clear()
    presenceChecked.current.clear()
    presencePending.current.clear()
    notificationCursor.current = { session: '', cursor: 0 }
    noticeSeen.current.clear()
    pushRevision.current++
    setNotificationsConnected(false)
    setNotificationInbox([])
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
      if (visibleRef.current && document.visibilityState === 'visible' && document.hasFocus())
        await fetchConversations()
      if (!stopped) timer = setTimeout(tick, 10000)
    }
    // Background reception belongs to the account's Mini session. HTTP only backs up a visible view.
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
      if (document.visibilityState === 'visible' && document.hasFocus()) await fetchHistory()
      if (!stopped) timer = setTimeout(tick, 10000)
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
    if (!selfUid || !visible) return
    const refresh = () => {
      if (document.visibilityState === 'visible' && document.hasFocus())
        void refreshPresence([
          ...convRef.current,
          ...contactsRef.current,
          ...(selectedRef.current ? [selectedRef.current] : []),
        ])
    }
    refresh()
    const timer = setInterval(refresh, 45000)
    return () => clearInterval(timer)
  }, [visible, selfUid])
  useEffect(() => {
    const refreshVisible = () => {
      if (visibleRef.current && document.visibilityState === 'visible' && document.hasFocus()) {
        fetchConversations()
        fetchHistory()
      }
    }
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [selfUid])
  useEffect(() => {
    if (!selfUid) return
    let stopped = false
    const consume = (batch: AccountNotifications, replay = false, metadata = true) => {
      if (stopped || batch.accountUid !== selfUid) return
      if (metadata) setNotificationsConnected(batch.connected)
      const old = notificationCursor.current
      if (old.session !== batch.session) {
        old.session = batch.session
        old.cursor = 0
        noticeSeen.current.clear()
      }
      if (metadata && batch.reset && visibleRef.current) {
        void fetchConversations()
        void fetchHistory()
      }
      for (const { sequence, notice } of batch.events) {
        if (noticeSeen.current.has(notice.id)) continue
        noticeSeen.current.add(notice.id)
        if (noticeSeen.current.size > 1024)
          noticeSeen.current.delete(noticeSeen.current.values().next().value!)
        old.cursor = Math.max(old.cursor, sequence)
        if (notice.kind === 'sync') {
          if (visibleRef.current) {
            void fetchConversations()
            void fetchHistory()
          }
          continue
        }
        if (notice.kind === 'change') {
          if (visibleRef.current) {
            void fetchConversations()
            if (selectedRef.current?.uid === notice.peerUid) void fetchHistory()
          }
          continue
        }
        const existing = convRef.current.find((peer) => peer.uid === notice.peerUid)
        const records = unreadNotices.current.get(notice.peerUid) || []
        const unread =
          !notice.self &&
          !boundaryCovers(
            readThrough.current.get(notice.peerUid),
            notice.timestamp,
            notice.messageId,
          )
        if (unread && !records.some((m) => m.id === notice.messageId)) {
          records.push({ time: notice.timestamp, id: notice.messageId })
          unreadNotices.current.set(notice.peerUid, records.slice(-100))
        }
        const peer: Conversation = {
          uid: notice.peerUid,
          nickname:
            existing?.nickname ||
            (!notice.self ? notice.senderName : '') ||
            `用户 ${notice.peerUid}`,
          avatar: existing?.avatar || (!notice.self ? notice.senderAvatar : '') || '',
          online: presence.current.get(notice.peerUid) ?? null,
          time: Math.max(existing?.time || 0, notice.timestamp),
          preview:
            notice.timestamp >= (existing?.time || 0) ? notice.text : existing?.preview || '',
          unread: Math.max(existing?.unread || 0, records.length),
        }
        updateConversations(mergeConversations(convRef.current, [peer]))
        void refreshPresence([peer])
        if (
          unread &&
          (!visibleRef.current || selectedRef.current?.uid !== peer.uid || !document.hasFocus()) &&
          (!replay || Date.now() - notice.timestamp < 30000)
        )
          setNotificationInbox((items) =>
            [peer, ...items.filter((c) => c.uid !== peer.uid)].slice(0, 8),
          )
        if (visibleRef.current && selectedRef.current?.uid === peer.uid) void fetchHistory()
      }
      old.cursor = Math.max(old.cursor, batch.cursor)
    }
    const stop = window.together.onPrivateNotifications((batch) => {
      pushRevision.current++
      consume(batch)
    })
    const snapshot = () => {
      const revision = pushRevision.current
      return window.together
        .privateNotifications(
          notificationCursor.current.cursor,
          notificationCursor.current.session || undefined,
        )
        .then((batch) => {
          const superseded = revision !== pushRevision.current
          if (superseded && notificationCursor.current.session !== batch.session) return
          consume(batch, true, !superseded)
        })
        .catch(() => {
          if (!stopped && revision === pushRevision.current) setNotificationsConnected(false)
        })
    }
    void snapshot()
    const resume = window.together.onLifecycle((event) => {
      if (event === 'resume') {
        void snapshot()
        if (visibleRef.current) {
          void fetchConversations()
          void fetchHistory()
        }
      }
    })
    const online = () => {
      void snapshot()
      if (visibleRef.current) {
        void fetchConversations()
        void fetchHistory()
      }
    }
    window.addEventListener('online', online)
    return () => {
      stopped = true
      stop()
      resume()
      window.removeEventListener('online', online)
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
      void refreshPresence(people)
    } catch (e: any) {
      if (epoch === accountEpoch.current) setContactsError(e.message)
    } finally {
      if (epoch === accountEpoch.current) {
        contactsLock.current = false
        setContactsBusy(false)
      }
    }
  }
  async function send(room?: Room, emoji?: ChatEmoji) {
    const peer = selectedRef.current
    const text = emoji
      ? `[${emoji.emojiName}]`
      : room
        ? inviteText(room.roomId, selfUid)
        : draftRef.current.trim()
    if (!peer || !selfUid || sendLock.current || !text || text.length > PRIVATE_TEXT_LIMIT)
      return false
    const userEpoch = accountEpoch.current
    const requestId = crypto.randomUUID()
    const local: PrivateMessage = {
      id: `local:${requestId}`,
      senderId: selfUid,
      recipientId: peer.uid,
      time: Date.now(),
      text,
      invitations: room ? [{ roomId: room.roomId, inviterUid: selfUid, isFLT: false }] : [],
      ...(emoji
        ? {
            attachments: [
              { kind: 'image' as const, title: emoji.emojiName, url: emoji.emojiImgUrl },
            ],
          }
        : {}),
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
      await api(emoji ? 'privateSticker' : room ? 'privateInvite' : 'privateSend', {
        uid: peer.uid,
        ...(emoji ? { emoji } : room ? { roomId: room.roomId } : { text }),
        requestId,
      })
      if (userEpoch !== accountEpoch.current) return false
      if (selectedRef.current?.uid === peer.uid) {
        updateMessages(mergePrivate(messagesRef.current, [{ ...local, delivery: 'submitted' }]))
        if (!room && !emoji) setDraft((current) => (current.trim() === text ? '' : current))
        await fetchHistory()
      } else {
        const memory = historyMemory.current.get(peer.uid)
        if (memory)
          memory.messages = mergePrivate(memory.messages, [{ ...local, delivery: 'submitted' }])
        if (!room && !emoji && drafts.current.get(peer.uid)?.trim() === text)
          drafts.current.set(peer.uid, '')
      }
      if (userEpoch !== accountEpoch.current) return false
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
      if (selectedRef.current?.uid === peer.uid) {
        const message = e.deliveryUnknown
          ? '发送结果未确认，请刷新私信后再决定是否重发'
          : e.message || '发送失败，请重试'
        updateMessages(
          mergePrivate(messagesRef.current, [
            { ...local, delivery: e.deliveryUnknown ? 'uncertain' : 'failed', error: message },
          ]),
        )
        setHistoryError(message)
      } else {
        const memory = historyMemory.current.get(peer.uid)
        if (memory)
          memory.messages = mergePrivate(memory.messages, [
            {
              ...local,
              delivery: e.deliveryUnknown ? 'uncertain' : 'failed',
              error: e.message || '发送失败，请重试',
            },
          ])
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
    notificationInbox,
    notificationsConnected,
    dismissNotification: (uid: string) =>
      setNotificationInbox((items) => items.filter((peer) => peer.uid !== uid)),
    conversationMore,
    conversationBusy,
    conversationError,
    selected,
    select,
    messages,
    historyMore: historyMore || historyGaps.current.next() !== null,
    historyBusy,
    historyError,
    readError,
    draft,
    setDraft,
    sending,
    send,
    sendSticker: (emoji: ChatEmoji) => send(undefined, emoji),
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

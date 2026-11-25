import { localizedMessageText } from '../../shared/message-content'
import { t, getUiLanguage } from '../../shared/ui-language'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Headphones,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Sticker,
  ArrowDown,
} from 'lucide-react'
import type { Conversation, MultiInvitation, Room, Song } from '../../shared/types'
import { UserAvatar, userPresence } from './design/UserAvatar'
import { MessageContent } from './MessageContent'
import { PanelHeader } from './windows/Surface'
import { ChatMessageCard } from './ChatMessageCard'
import { EmojiPicker } from './EmojiPicker'
import { MediaComposer } from './MediaComposer'
import {
  PRIVATE_TEXT_LIMIT,
  inviteText,
  conversationName,
  conversationPreview,
} from '../../shared/private-messages'
import type { usePrivateMessages } from './usePrivateMessages'
import type { ApiCall } from './music-data'
import { Overlay } from './player/Overlay'
import { useScrollPagination } from './useScrollPagination'
import { ChatComposer } from './ChatComposer'
import { captureHistoryAnchor, restoreHistoryAnchor, type HistoryAnchor } from './history-scroll'
import { privateViewAccount, privateViewPosition, savePrivateView } from './private-view-state'

type Inbox = ReturnType<typeof usePrivateMessages>
type InviteCheck =
  | { state: 'idle' | 'loading' | 'ended' | 'unavailable' }
  | { state: 'ready'; song: string }
  | { state: 'error'; message: string }

function inviteCheckLabel(result: InviteCheck) {
  switch (result.state) {
    case 'idle':
      return t('privateMessages.checkTheRoomBeforeJoining')
    case 'loading':
      return t('common.checking')
    case 'ready':
      return result.song || t('privateMessages.roomAvailable')
    case 'ended':
      return t('privateMessages.theInviteExpiredOrTheRoomHasEnded')
    case 'unavailable':
      return t('privateMessages.couldntCheckTheRoomTryAgainLater')
    case 'error':
      return result.message || t('privateMessages.couldntCheckTheInvite')
  }
}
function InviteCard({
  invite,
  api,
  room,
  busy,
  onJoin,
}: {
  invite: MultiInvitation
  api: ApiCall
  room: Room | null
  busy: boolean
  onJoin(invite: MultiInvitation): void
}) {
  const [result, setResult] = useState<InviteCheck>({ state: 'idle' })
  const { state } = result
  const epoch = useRef(0)
  useEffect(
    () => () => {
      epoch.current++
    },
    [],
  )
  async function check() {
    const run = ++epoch.current
    setResult({ state: 'loading' })
    try {
      const body = await api('multiPreview', {
        roomId: invite.roomId,
        inviterUid: invite.inviterUid,
      })
      if (run !== epoch.current) return
      if (body.data?.roomStatus === 'AVAILABLE') {
        setResult({ state: 'ready', song: body.data?.songData?.name || '' })
      } else if (body.data?.roomStatus === 'EXPIRED') {
        setResult({ state: 'ended' })
      } else {
        setResult({ state: 'unavailable' })
      }
    } catch (e: any) {
      if (run === epoch.current) {
        setResult({ state: 'error', message: e.message || '' })
      }
    }
  }
  return (
    <div className="private-invite-card">
      <div>
        <Headphones size={20} />
        <strong>{t('privateMessages.groupListeningRoom')}</strong>
      </div>
      <p>{inviteCheckLabel(result)}</p>
      {room?.roomId === invite.roomId ? (
        <small>{t('privateMessages.youreAlreadyInThisRoom')}</small>
      ) : state === 'ready' ? (
        <button className="primary" disabled={busy} onClick={() => onJoin(invite)}>
          {room ? t('privateMessages.switchToThisRoom') : t('privateMessages.joinRoom')}
          <ArrowRight size={14} />
        </button>
      ) : (
        <button
          className="secondary"
          disabled={state === 'loading' || state === 'ended' || busy}
          onClick={check}
        >
          {state === 'loading'
            ? t('common.checking')
            : state === 'ended'
              ? t('privateMessages.inviteExpired')
              : t('privateMessages.checkInvite')}
        </button>
      )}
    </div>
  )
}
export function PrivateMessages({
  inbox,
  account,
  room,
  api,
  busy,
  onJoin,
  onSong,
  onAlbum,
  onAudition,
  onMediaPlay,
  compact = false,
  onExpand,
  onList,
  onSelect,
}: {
  inbox: Inbox
  account: any
  room: Room | null
  api: ApiCall
  busy: boolean
  onJoin(invite: MultiInvitation): Promise<void>
  onSong(song: Song): void
  onAlbum(id: string, title: string): void
  onAudition(song: Song): void
  onMediaPlay(): void
  compact?: boolean
  onList(): void
  onExpand(): void
  onSelect(peer: Conversation): void
}) {
  const [filter, setFilter] = useState('')
  const [showContacts, setShowContacts] = useState(false)
  const [newUid, setNewUid] = useState('')
  const [confirmInvite, setConfirmInvite] = useState<{
    room: Room
    uid: string
    nickname: string
  } | null>(null)
  const [switchInvite, setSwitchInvite] = useState<MultiInvitation | null>(null)
  const log = useRef<HTMLDivElement>(null),
    stick = useRef(true),
    historyAnchor = useRef<HistoryAnchor | null>(null)
  const conversationPages = useScrollPagination({
    enabled: Boolean(account) && !compact,
    loading: inbox.conversationBusy,
    hasMore: inbox.conversationMore,
    blocked: Boolean(inbox.conversationError),
    scope: `${account?.userId}:conversations`,
    contentKey: inbox.conversations.length,
    onLoad: inbox.loadConversations,
  })
  const historyPages = useScrollPagination({
    enabled: Boolean(account && inbox.selected) && !compact,
    loading: inbox.historyBusy,
    hasMore: inbox.historyMore,
    blocked: Boolean(inbox.historyError),
    scope: `${account?.userId}:${inbox.selected?.uid}`,
    contentKey: inbox.messages.length,
    direction: 'top',
    autoFill: false,
    onLoad: older,
  })
  const contactPages = useScrollPagination({
    enabled: showContacts,
    loading: inbox.contactsBusy,
    hasMore: inbox.contactsMore,
    blocked: Boolean(inbox.contactsError),
    scope: `${account?.userId}:contacts`,
    contentKey: inbox.contacts.length,
    onLoad: () => inbox.loadContacts(true),
  })
  const [showLatest, setShowLatest] = useState(false)
  const readingKey = String(inbox.selected?.uid || '')
  useLayoutEffect(() => {
    privateViewAccount(String(account?.userId || ''))
    const saved = compact ? undefined : privateViewPosition(readingKey)
    setShowLatest(saved?.latest === false)
    stick.current = saved?.latest ?? true
    historyAnchor.current = saved && !saved.latest ? saved.anchor : null
    setConfirmInvite(null)
    setSwitchInvite(null)
  }, [readingKey, account?.userId, compact])
  useLayoutEffect(() => {
    const box = log.current
    if (!box) return
    const anchor = historyAnchor.current
    if (anchor) {
      restoreHistoryAnchor(box, anchor)
      historyAnchor.current = null
    } else if (stick.current) box.scrollTop = box.scrollHeight
  }, [inbox.messages, readingKey, compact])
  useEffect(() => {
    const box = log.current
    if (!box) return
    const observer = new ResizeObserver(() => {
      if (stick.current) box.scrollTop = box.scrollHeight
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [inbox.selected?.uid])
  async function older() {
    const anchor = log.current ? captureHistoryAnchor(log.current) : null
    historyAnchor.current = anchor
    await inbox.loadHistory()
    requestAnimationFrame(() => {
      if (historyAnchor.current === anchor) historyAnchor.current = null
    })
  }
  function join(invite: MultiInvitation) {
    if (room && room.roomId !== invite.roomId) setSwitchInvite(invite)
    else onJoin(invite)
  }
  if (!account)
    return (
      <div className="empty private-inbox-empty">
        <Mail size={28} />
        <strong>{t('privateMessages.signInToViewYourNeteaseCloudMusic')}</strong>
      </div>
    )
  const ThreadHeader = compact ? PanelHeader : Fragment
  const selfUid = String(account.userId)
  const latestIncoming = compact
    ? inbox.messages.map((m) => m.senderId !== selfUid).lastIndexOf(true)
    : -1
  // A quick reply quotes the latest incoming message and keeps subsequent replies and their delivery status.
  const messages = compact
    ? inbox.messages.slice(latestIncoming >= 0 ? latestIncoming : -1)
    : inbox.messages
  const filtered = inbox.conversations.filter((c) =>
    `${conversationName(c)} ${c.uid} ${conversationPreview(c)}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  )
  const dateLabel = (time: number) =>
    new Date(time).toLocaleDateString(getUiLanguage(), { month: 'long', day: 'numeric' })
  return (
    <section
      data-selected={!!inbox.selected}
      className={`private-layout ${compact ? 'private-compact' : ''}`}
    >
      <aside className="conversation-pane">
        <div className="conversation-toolbar">
          <label className="contact-filter">
            <Search size={15} />
            <input
              title={t('private.searchConversations', { count: inbox.conversations.length })}
              aria-label={t('privateMessages.filterConversations')}
              placeholder={t('privateMessages.filterContacts')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <span
            className="private-connection"
            data-connected={inbox.notificationsConnected}
            title={
              inbox.notificationsConnected
                ? t('privateMessages.connectedToLiveNotifications')
                : t('privateMessages.reconnectingToNotificationsOpeningAConversationAlsoChecks')
            }
          >
            {inbox.notificationsConnected
              ? t('privateMessages.live')
              : t('privateMessages.reconnecting')}
          </span>
          <div className="conversation-actions">
            <button
              className="icon-btn"
              aria-label={t('privateMessages.refreshConversations')}
              disabled={inbox.conversationBusy}
              onClick={inbox.refreshConversations}
            >
              <RefreshCw size={15} />
            </button>
            <button
              className="icon-btn"
              aria-label={t('privateMessages.messageAFriend')}
              onClick={() => {
                setShowContacts(true)
                inbox.loadContacts()
              }}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        {inbox.conversationError && (
          <p className="private-error" role="alert">
            {inbox.conversationError}
          </p>
        )}
        <div data-list-viewport="" className="conversation-list">
          {filtered.map((c) => (
            <button
              className={inbox.selected?.uid === c.uid ? 'selected' : ''}
              key={c.uid}
              title={t('common.openConversationWith', { nickname: conversationName(c) })}
              aria-current={inbox.selected?.uid === c.uid ? 'true' : undefined}
              onClick={() => onSelect(c)}
            >
              <span className="conversation-copy">
                <span className="conversation-name">
                  <strong>{conversationName(c)}</strong>
                  {c.time > 0 && (
                    <time>
                      {new Date(c.time).toLocaleDateString() === new Date().toLocaleDateString()
                        ? new Date(c.time).toLocaleTimeString(getUiLanguage(), {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : dateLabel(c.time)}
                    </time>
                  )}
                </span>
                <span className="conversation-preview">
                  <small>{conversationPreview(c) || t('privateMessages.startAConversation')}</small>
                  {c.unread > 0 && (
                    <span
                      className="unread-count"
                      aria-label={t('privateMessages.unread', { count: c.unread })}
                    >
                      {c.unread > 99 ? '99+' : c.unread}
                    </span>
                  )}
                </span>
              </span>
              <UserAvatar
                className="contact-avatar"
                name={conversationName(c)}
                src={c.avatar}
                presence={userPresence(c.online)}
              />
            </button>
          ))}
          {!inbox.conversationBusy && !inbox.conversationError && !filtered.length && (
            <p className="chat-empty">
              {filter
                ? t('privateMessages.noMatchingContacts')
                : t('privateMessages.noMessagesYetSelectToMessageAFriend')}
            </p>
          )}
          {inbox.conversationBusy && (
            <p className="loading">
              <LoaderCircle size={14} className="spin" />
              {t('privateMessages.loading')}
            </p>
          )}
          <div ref={conversationPages} className="pagination-sentinel" aria-hidden="true" />
        </div>
      </aside>
      <div className="private-thread">
        {!inbox.selected ? (
          <div className="private-welcome">
            <Mail size={34} />
            <h2>{t('privateMessages.emptyConversation')}</h2>
            <p>{t('privateMessages.chooseAConversationToReadMessagesOrShare')}</p>
          </div>
        ) : (
          <>
            <ThreadHeader>
              <div className="private-thread-heading">
                <UserAvatar
                  className="thread-avatar"
                  name={conversationName(inbox.selected)}
                  src={inbox.selected.avatar}
                  presence={userPresence(inbox.selected.online)}
                />
                <div>
                  <strong title={conversationName(inbox.selected)}>
                    {conversationName(inbox.selected)}
                  </strong>
                  <small data-presence={userPresence(inbox.selected.online)}>
                    {inbox.selected.online === true
                      ? t('common.online')
                      : inbox.selected.online === false
                        ? t('common.offline')
                        : t('common.presenceUnknown')}
                    {compact && t('privateMessages.quickReply')}
                  </small>
                </div>
                {!compact && (
                  <button type="button" className="text-btn switch-conversation" onClick={onList}>
                    {t('privateMessages.switchContact', { count: inbox.conversations.length })}
                  </button>
                )}
                {compact && (
                  <button
                    className="text-btn expand-conversation"
                    aria-label={t('common.openFullConversation')}
                    title={t('common.openFullConversation')}
                    onClick={onExpand}
                  >
                    {t('privateMessages.fullConversation')} <ArrowUpRight size={12} />
                  </button>
                )}
                {!compact && (
                  <button
                    className="icon-btn thread-invite"
                    aria-label={t('common.inviteToRoom')}
                    title={t('common.inviteToRoom')}
                    disabled={!room || inbox.sending}
                    onClick={() => {
                      if (room && inbox.selected)
                        setConfirmInvite({
                          room: { ...room },
                          uid: inbox.selected.uid,
                          nickname: inbox.selected.nickname,
                        })
                    }}
                  >
                    <Headphones size={15} />
                    <span>{t('common.inviteToRoom')}</span>
                  </button>
                )}
                <button
                  className="icon-btn"
                  aria-label={t('privateMessages.refreshConversation')}
                  disabled={inbox.historyBusy}
                  onClick={inbox.refreshHistory}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </ThreadHeader>
            {inbox.readError && (
              <div className="private-read-error" role="status">
                <span>
                  {t('privateMessages.couldntSyncReadReceipts', { readError: inbox.readError })}
                </span>
                <button className="text-btn" onClick={inbox.refreshHistory}>
                  {t('privateMessages.retryReadReceipt')}
                </button>
              </div>
            )}
            {inbox.historyError && (
              <p className="private-error" role="alert">
                {inbox.historyError}
              </p>
            )}
            <div className="chat-history-frame">
              <div
                ref={log}
                data-list-viewport=""
                className="private-messages"
                role="log"
                aria-label={t('privateMessages.directMessages')}
                aria-live="polite"
                onScroll={() => {
                  const box = log.current
                  if (box?.clientHeight) {
                    stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 70
                    if (inbox.messages.length) setShowLatest(!stick.current)
                    if (!compact)
                      savePrivateView(readingKey, stick.current, captureHistoryAnchor(box))
                  }
                }}
              >
                <div ref={historyPages} className="pagination-sentinel" aria-hidden="true" />
                {inbox.historyBusy && !inbox.messages.length && (
                  <p className="loading">{t('privateMessages.loadingMessages')}</p>
                )}
                {!inbox.historyBusy && !inbox.historyError && !inbox.messages.length && (
                  <p className="chat-empty">{t('privateMessages.noMessagesYet')}</p>
                )}
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    data-message-id={message.id}
                    className="private-message-item"
                  >
                    {!compact &&
                      (index === 0 ||
                        new Date(messages[index - 1].time).toDateString() !==
                          new Date(message.time).toDateString()) && (
                        <div className="message-date">{dateLabel(message.time)}</div>
                      )}
                    <ChatMessageCard
                      mine={message.senderId === selfUid}
                      author={
                        message.senderId === selfUid
                          ? account.nickname || t('common.me')
                          : inbox.selected
                            ? conversationName(inbox.selected)
                            : t('common.listener')
                      }
                      avatar={
                        message.senderId === selfUid ? account.avatarUrl : inbox.selected?.avatar
                      }
                      time={message.time}
                    >
                      <MessageContent
                        api={api}
                        accountKey={selfUid}
                        text={
                          message.previewOnlyText
                            ? ''
                            : localizedMessageText(message.text, message.fallbackText)
                        }
                        attachments={message.attachments}
                        richText={message.richText}
                        room={!!room}
                        roomKey={room?.roomId}
                        onSong={onSong}
                        onAlbum={onAlbum}
                        onAudition={onAudition}
                        onMediaPlay={onMediaPlay}
                      >
                        {message.invitations.length > 0 &&
                          message.invitations.map((invite) => (
                            <InviteCard
                              key={`${invite.roomId}:${invite.inviterUid}`}
                              invite={invite}
                              api={api}
                              room={room}
                              busy={busy}
                              onJoin={join}
                            />
                          ))}
                      </MessageContent>
                      {message.delivery && (
                        <small className={message.error ? 'chat-failed' : ''}>
                          {message.error ||
                            {
                              sending: t('common.sending'),
                              submitted: t('privateMessages.sentWaitingForDeliveryConfirmation'),
                              failed: t('common.sendFailed'),
                              uncertain: t('common.deliveryUnconfirmed'),
                            }[message.delivery]}
                        </small>
                      )}
                    </ChatMessageCard>
                  </div>
                ))}
              </div>
              {showLatest && (
                <button
                  className="back-to-latest"
                  aria-label={t('common.jumpToLatest')}
                  onClick={() => {
                    if (log.current) log.current.scrollTop = log.current.scrollHeight
                    stick.current = true
                    setShowLatest(false)
                  }}
                >
                  <ArrowDown size={16} />
                </button>
              )}
            </div>
            <ChatComposer
              key={`${selfUid}:${inbox.selected.uid}`}
              className="private-compose"
              value={inbox.draft}
              onChange={inbox.setDraft}
              label={t('privateMessages.directMessage')}
              placeholder={t('privateMessages.writeAMessage')}
              maxLength={PRIVATE_TEXT_LIMIT}
              busy={inbox.sending}
              submitLabel={t('privateMessages.sendMessage')}
              onSubmit={() => {
                stick.current = true
                return inbox.send()
              }}
              renderTools={() => (
                <>
                  <EmojiPicker
                    api={api}
                    accountKey={selfUid}
                    scope="private"
                    recipient={conversationName(inbox.selected!)}
                    triggerLabel={t('common.stickers')}
                    triggerIcon={<Sticker size={16} />}
                    disabled={inbox.sending}
                    onSticker={inbox.sendSticker}
                  />
                  <MediaComposer
                    accountKey={selfUid}
                    target={{ kind: 'private', uid: inbox.selected!.uid }}
                    label={conversationName(inbox.selected!)}
                    disabled={inbox.sending}
                    onSent={inbox.acceptMedia}
                    onMediaPlay={onMediaPlay}
                  />
                </>
              )}
            />
          </>
        )}
      </div>
      {showContacts && (
        <Overlay
          title={t('privateMessages.chooseARecipient')}
          onClose={() => setShowContacts(false)}
        >
          <form
            className="recipient-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (/^[1-9]\d{0,23}$/.test(newUid) && newUid !== selfUid) {
                onSelect({
                  uid: newUid,
                  nickname: '',
                  avatar: '',
                  preview: '',
                  time: 0,
                  unread: 0,
                })
                setShowContacts(false)
              }
            }}
          >
            <input
              aria-label={t('privateMessages.recipientsNeteaseCloudMusicId')}
              placeholder={t('privateMessages.orEnterANeteaseCloudMusicUserId')}
              value={newUid}
              onChange={(e) => setNewUid(e.target.value.trim())}
            />
            <button
              className="secondary"
              disabled={!/^[1-9]\d{0,23}$/.test(newUid) || newUid === selfUid}
            >
              {t('privateMessages.openConversation')}
            </button>
          </form>
          <p className="muted">{t('privateMessages.following')}</p>
          {inbox.contactsError && (
            <p role="alert" className="private-error">
              {inbox.contactsError}
            </p>
          )}
          <div data-list-viewport="" className="contacts-picker">
            {inbox.contacts.map((c) => (
              <button
                key={c.uid}
                title={t('common.openConversationWith', { nickname: conversationName(c) })}
                onClick={() => {
                  onSelect(c)
                  setShowContacts(false)
                }}
              >
                <UserAvatar
                  name={conversationName(c)}
                  src={c.avatar}
                  presence={userPresence(c.online)}
                />
                <span>{conversationName(c)}</span>
                <small>{c.uid}</small>
              </button>
            ))}
            <div ref={contactPages} className="pagination-sentinel" aria-hidden="true" />
          </div>
          {inbox.contactsBusy && <p className="loading">{t('privateMessages.loadingContacts')}</p>}
        </Overlay>
      )}
      {confirmInvite && (
        <Overlay
          title={t('privateMessages.inviteToListenTogether', {
            nickname: conversationName(confirmInvite),
          })}
          onClose={() => setConfirmInvite(null)}
        >
          <p>{t('privateMessages.sendThisRoomLinkInADirectMessage')}</p>
          <pre className="invite-preview-text">
            {inviteText(confirmInvite.room.roomId, selfUid)}
          </pre>
          <div className="row-actions">
            <button className="secondary" onClick={() => setConfirmInvite(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="primary"
              disabled={inbox.sending || inbox.selected?.uid !== confirmInvite.uid}
              onClick={async () => {
                if (inbox.selected?.uid === confirmInvite.uid) {
                  await inbox.send(confirmInvite.room)
                  setConfirmInvite(null)
                }
              }}
            >
              {t('privateMessages.sendInvitation')}
            </button>
          </div>
        </Overlay>
      )}
      {switchInvite && (
        <Overlay
          title={t('privateMessages.switchListeningRooms')}
          onClose={() => setSwitchInvite(null)}
        >
          <p>{t('privateMessages.youllLeaveYourCurrentRoomAndJoinThe')}</p>
          <div className="row-actions">
            <button className="secondary" onClick={() => setSwitchInvite(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                await onJoin(switchInvite)
                setSwitchInvite(null)
              }}
            >
              {t('privateMessages.switchRooms')}
            </button>
          </div>
        </Overlay>
      )}
    </section>
  )
}

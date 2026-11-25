import { ui, getUiLanguage } from '../../shared/ui-language'
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
      return ui('检查房间后加入', 'Check the room before joining')
    case 'loading':
      return ui('正在检查…', 'Checking…')
    case 'ready':
      return result.song || ui('房间可以加入', 'Room available')
    case 'ended':
      return ui('邀请已过期或房间已结束', 'The invite expired or the room has ended')
    case 'unavailable':
      return ui('未能确认房间状态，请稍后重试', 'Couldn’t check the room. Try again later.')
    case 'error':
      return result.message || ui('检查失败', 'Couldn’t check the invite')
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
        <strong>{ui('官方多人一起听', 'Group listening room')}</strong>
      </div>
      <p>{inviteCheckLabel(result)}</p>
      {room?.roomId === invite.roomId ? (
        <small>{ui('你已在这个房间', 'You’re already in this room')}</small>
      ) : state === 'ready' ? (
        <button className="primary" disabled={busy} onClick={() => onJoin(invite)}>
          {room ? ui('切换到这个房间', 'Switch to this room') : ui('加入一起听', 'Join room')}
          <ArrowRight size={14} />
        </button>
      ) : (
        <button
          className="secondary"
          disabled={state === 'loading' || state === 'ended' || busy}
          onClick={check}
        >
          {state === 'loading'
            ? ui('正在检查…', 'Checking…')
            : state === 'ended'
              ? ui('邀请已失效', 'Invite expired')
              : ui('检查邀请', 'Check invite')}
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
        <strong>
          {ui('登录后查看网易云私信', 'Sign in to view your NetEase Cloud Music messages')}
        </strong>
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
              title={ui(
                '筛选 {0} 个会话中的联系人或消息',
                'Search contacts or messages across {0} conversations',
                inbox.conversations.length,
              )}
              aria-label={ui('筛选私信会话', 'Filter conversations')}
              placeholder={ui('筛选私信联系人…', 'Filter contacts…')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <span
            className="private-connection"
            data-connected={inbox.notificationsConnected}
            title={
              inbox.notificationsConnected
                ? ui('Mini 通知已连接', 'Connected to live notifications')
                : ui(
                    '通知重连中，打开页面时保留历史查询补偿',
                    'Reconnecting to notifications. Opening a conversation also checks for missed messages.',
                  )
            }
          >
            {inbox.notificationsConnected ? ui('实时', 'Live') : ui('重连中', 'Reconnecting')}
          </span>
          <div className="conversation-actions">
            <button
              className="icon-btn"
              aria-label={ui('刷新私信会话', 'Refresh conversations')}
              disabled={inbox.conversationBusy}
              onClick={inbox.refreshConversations}
            >
              <RefreshCw size={15} />
            </button>
            <button
              className="icon-btn"
              aria-label={ui('选择好友发私信', 'Message a friend')}
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
              title={ui('打开与 {0} 的会话', 'Open conversation with {0}', conversationName(c))}
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
                  <small>{conversationPreview(c) || ui('开始私信', 'Start a conversation')}</small>
                  {c.unread > 0 && (
                    <span
                      className="unread-count"
                      aria-label={ui('{0} 条未读', '{0} unread', c.unread)}
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
                ? ui('没有匹配的联系人', 'No matching contacts')
                : ui('暂无私信，点击 + 选择好友', 'No messages yet. Select + to message a friend.')}
            </p>
          )}
          {inbox.conversationBusy && (
            <p className="loading">
              <LoaderCircle size={14} className="spin" />
              {ui('加载中…', 'Loading…')}
            </p>
          )}
          <div ref={conversationPages} className="pagination-sentinel" aria-hidden="true" />
        </div>
      </aside>
      <div className="private-thread">
        {!inbox.selected ? (
          <div className="private-welcome">
            <Mail size={34} />
            <h2>{ui('从一句话，一起听起', 'Start a conversation')}</h2>
            <p>
              {ui(
                '选择会话，查看私信或分享当前多人房间。',
                'Choose a conversation to read messages or share your listening room.',
              )}
            </p>
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
                      ? ui('在线', 'Online')
                      : inbox.selected.online === false
                        ? ui('离线', 'Offline')
                        : ui('在线状态未知', 'Presence unknown')}
                    {compact && ui(' · 私信快捷回复', ' · Quick reply')}
                  </small>
                </div>
                {!compact && (
                  <button type="button" className="text-btn switch-conversation" onClick={onList}>
                    {ui('切换联系人 ({0})', 'Switch contact ({0})', inbox.conversations.length)}
                  </button>
                )}
                {compact && (
                  <button
                    className="text-btn expand-conversation"
                    aria-label={ui('打开完整对话', 'Open full conversation')}
                    title={ui('打开完整对话', 'Open full conversation')}
                    onClick={onExpand}
                  >
                    {ui('完整对话', 'Full conversation')} <ArrowUpRight size={12} />
                  </button>
                )}
                {!compact && (
                  <button
                    className="icon-btn thread-invite"
                    aria-label={ui('邀请到当前房间', 'Invite to room')}
                    title={ui('邀请到当前房间', 'Invite to room')}
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
                    <span>{ui('邀请到当前房间', 'Invite to room')}</span>
                  </button>
                )}
                <button
                  className="icon-btn"
                  aria-label={ui('刷新当前私信', 'Refresh conversation')}
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
                  {ui('已读状态同步失败：{0}', 'Couldn’t sync read receipts: {0}', inbox.readError)}
                </span>
                <button className="text-btn" onClick={inbox.refreshHistory}>
                  {ui('重试同步已读', 'Retry read receipt')}
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
                aria-label={ui('私信消息', 'Direct messages')}
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
                  <p className="loading">{ui('正在读取私信…', 'Loading messages…')}</p>
                )}
                {!inbox.historyBusy && !inbox.historyError && !inbox.messages.length && (
                  <p className="chat-empty">{ui('还没有聊天记录', 'No messages yet')}</p>
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
                          ? account.nickname || ui('我', 'Me')
                          : inbox.selected
                            ? conversationName(inbox.selected)
                            : ui('听友', 'Listener')
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
                            : message.fallbackTextEn
                              ? ui(message.text, message.fallbackTextEn)
                              : message.text
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
                              sending: ui('发送中…', 'Sending…'),
                              submitted: ui(
                                '已提交，等待私信回显',
                                'Sent. Waiting for delivery confirmation.',
                              ),
                              failed: ui('发送失败', 'Send failed'),
                              uncertain: ui('结果未确认', 'Delivery unconfirmed'),
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
                  aria-label={ui('回到最新消息', 'Jump to latest')}
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
              label={ui('私信内容', 'Direct message')}
              placeholder={ui('发送私信…', 'Write a message…')}
              maxLength={PRIVATE_TEXT_LIMIT}
              busy={inbox.sending}
              submitLabel={ui('发送私信', 'Send message')}
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
                    triggerLabel={ui('表情包', 'Stickers')}
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
          title={ui('选择私信收件人', 'Choose a recipient')}
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
              aria-label={ui('收件人网易云 ID', 'Recipient’s NetEase Cloud Music ID')}
              placeholder={ui('或输入网易云用户 ID', 'Or enter a NetEase Cloud Music user ID')}
              value={newUid}
              onChange={(e) => setNewUid(e.target.value.trim())}
            />
            <button
              className="secondary"
              disabled={!/^[1-9]\d{0,23}$/.test(newUid) || newUid === selfUid}
            >
              {ui('打开会话', 'Open conversation')}
            </button>
          </form>
          <p className="muted">{ui('我关注的人', 'Following')}</p>
          {inbox.contactsError && (
            <p role="alert" className="private-error">
              {inbox.contactsError}
            </p>
          )}
          <div data-list-viewport="" className="contacts-picker">
            {inbox.contacts.map((c) => (
              <button
                key={c.uid}
                title={ui('打开与 {0} 的会话', 'Open conversation with {0}', conversationName(c))}
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
          {inbox.contactsBusy && (
            <p className="loading">{ui('正在读取联系人…', 'Loading contacts…')}</p>
          )}
        </Overlay>
      )}
      {confirmInvite && (
        <Overlay
          title={ui(
            '邀请 {0} 一起听',
            'Invite {0} to listen together',
            conversationName(confirmInvite),
          )}
          onClose={() => setConfirmInvite(null)}
        >
          <p>
            {ui(
              '将通过网易云私信发送以下多人房间链接：',
              'Send this room link in a direct message?',
            )}
          </p>
          <pre className="invite-preview-text">
            {inviteText(confirmInvite.room.roomId, selfUid)}
          </pre>
          <div className="row-actions">
            <button className="secondary" onClick={() => setConfirmInvite(null)}>
              {ui('取消', 'Cancel')}
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
              {ui('确认发送邀请', 'Send invitation')}
            </button>
          </div>
        </Overlay>
      )}
      {switchInvite && (
        <Overlay
          title={ui('切换一起听房间？', 'Switch listening rooms?')}
          onClose={() => setSwitchInvite(null)}
        >
          <p>
            {ui(
              '将先离开当前房间，再加入这条邀请对应的官方多人房间。',
              'You’ll leave your current room and join the room in this invite.',
            )}
          </p>
          <div className="row-actions">
            <button className="secondary" onClick={() => setSwitchInvite(null)}>
              {ui('取消', 'Cancel')}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                await onJoin(switchInvite)
                setSwitchInvite(null)
              }}
            >
              {ui('确认切换房间', 'Switch rooms')}
            </button>
          </div>
        </Overlay>
      )}
    </section>
  )
}

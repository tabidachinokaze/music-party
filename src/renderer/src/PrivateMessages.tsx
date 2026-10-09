import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Headphones,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Sticker,
  Users,
} from 'lucide-react'
import type { MultiInvitation, Room, Song } from '../../shared/types'
import { MessageContent } from './MessageContent'
import { ChatMessageCard } from './ChatMessageCard'
import { EmojiPicker } from './EmojiPicker'
import { MediaComposer } from './MediaComposer'
import { PRIVATE_TEXT_LIMIT, inviteText } from '../../shared/private-messages'
import type { usePrivateMessages } from './usePrivateMessages'
import type { ApiCall } from './music-data'
import { Overlay } from './player/Overlay'
import { useScrollPagination } from './useScrollPagination'
import { ChatComposer } from './ChatComposer'
import { captureHistoryAnchor, restoreHistoryAnchor, type HistoryAnchor } from './history-scroll'
import { privateViewAccount, privateViewPosition, savePrivateView } from './private-view-state'

type Inbox = ReturnType<typeof usePrivateMessages>
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
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'ended' | 'error'>('idle')
  const [label, setLabel] = useState('检查房间后加入')
  const epoch = useRef(0)
  useEffect(
    () => () => {
      epoch.current++
    },
    [],
  )
  async function check() {
    const run = ++epoch.current
    setState('loading')
    try {
      const body = await api('multiPreview', {
        roomId: invite.roomId,
        inviterUid: invite.inviterUid,
      })
      if (run !== epoch.current) return
      if (body.data?.roomStatus === 'AVAILABLE') {
        setState('ready')
        setLabel(body.data?.songData?.name || '房间可以加入')
      } else if (body.data?.roomStatus === 'EXPIRED') {
        setState('ended')
        setLabel('邀请已过期或房间已结束')
      } else {
        setState('error')
        setLabel('未能确认房间状态，请稍后重试')
      }
    } catch (e: any) {
      if (run === epoch.current) {
        setState('error')
        setLabel(e.message || '检查失败')
      }
    }
  }
  return (
    <div className="private-invite-card">
      <div>
        <Headphones size={20} />
        <strong>官方多人一起听</strong>
      </div>
      <p>{label}</p>
      {room?.roomId === invite.roomId ? (
        <small>你已在这个房间</small>
      ) : state === 'ready' ? (
        <button className="primary" disabled={busy} onClick={() => onJoin(invite)}>
          {room ? '切换到这个房间' : '加入一起听'}
          <ArrowRight size={14} />
        </button>
      ) : (
        <button
          className="secondary"
          disabled={state === 'loading' || state === 'ended' || busy}
          onClick={check}
        >
          {state === 'loading' ? '正在检查…' : state === 'ended' ? '邀请已失效' : '检查邀请'}
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
}) {
  const [filter, setFilter] = useState('')
  const [showContacts, setShowContacts] = useState(false)
  const [newUid, setNewUid] = useState('')
  const [confirmInvite, setConfirmInvite] = useState<{
    room: Room
    uid: string
    name: string
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
    enabled: Boolean(account && inbox.selected),
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
  const readingKey = `${compact ? 'bubble' : 'inbox'}:${inbox.selected?.uid}`
  useLayoutEffect(() => {
    privateViewAccount(String(account?.userId || ''))
    const saved = privateViewPosition(readingKey)
    stick.current = saved?.latest ?? true
    historyAnchor.current = saved && !saved.latest ? saved.anchor : null
    setConfirmInvite(null)
    setSwitchInvite(null)
  }, [readingKey, account?.userId])
  useLayoutEffect(() => {
    const box = log.current
    if (!box) return
    const anchor = historyAnchor.current
    if (anchor) {
      restoreHistoryAnchor(box, anchor)
      historyAnchor.current = null
    } else if (stick.current) box.scrollTop = box.scrollHeight
  }, [inbox.messages, readingKey])
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
        <strong>登录后查看网易云私信</strong>
        <span>点击左下角登录网易云账号</span>
      </div>
    )
  const selfUid = String(account.userId)
  const filtered = inbox.conversations.filter((c) =>
    `${c.nickname} ${c.uid}`.toLowerCase().includes(filter.toLowerCase()),
  )
  const dateLabel = (time: number) =>
    new Date(time).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  return (
    <section className={`private-layout ${compact ? 'private-compact' : ''}`}>
      <aside className="conversation-pane">
        <div className="conversation-toolbar">
          <strong>{inbox.conversations.length} 个会话</strong>
          <span
            className="private-connection"
            title={
              inbox.notificationsConnected
                ? 'Mini 通知已连接'
                : '通知重连中，打开页面时保留历史查询补偿'
            }
          >
            {inbox.notificationsConnected ? '实时' : '重连中'}
          </span>
          <div className="conversation-actions">
            <button
              className="icon-btn"
              aria-label="刷新私信会话"
              disabled={inbox.conversationBusy}
              onClick={inbox.refreshConversations}
            >
              <RefreshCw size={15} />
            </button>
            <button
              className="icon-btn"
              aria-label="选择好友发私信"
              onClick={() => {
                setShowContacts(true)
                inbox.loadContacts()
              }}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
        <label className="contact-filter">
          <Search size={15} />
          <input
            aria-label="筛选私信会话"
            placeholder="搜索联系人"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        {inbox.conversationError && (
          <p className="private-error" role="alert">
            {inbox.conversationError}
          </p>
        )}
        <div className="conversation-list">
          {filtered.map((c) => (
            <button
              className={inbox.selected?.uid === c.uid ? 'selected' : ''}
              key={c.uid}
              aria-current={inbox.selected?.uid === c.uid ? 'true' : undefined}
              onClick={() => inbox.select(c)}
            >
              <span className="contact-avatar">
                {c.avatar ? (
                  <img src={c.avatar} alt="" />
                ) : (
                  <span className="avatar">
                    <Users size={18} />
                  </span>
                )}
                {c.online === true && <i className="contact-online" aria-label="在线" />}
              </span>
              <span className="conversation-copy">
                <strong>{c.nickname}</strong>
                <small>{c.preview || '开始私信'}</small>
              </span>
              <span className="conversation-meta">
                {c.time > 0 && (
                  <time>
                    {new Date(c.time).toLocaleDateString() === new Date().toLocaleDateString()
                      ? new Date(c.time).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : dateLabel(c.time)}
                  </time>
                )}
                {c.unread > 0 && (
                  <span className="unread-count" aria-label={`${c.unread} 条未读`}>
                    {c.unread > 99 ? '99+' : c.unread}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!inbox.conversationBusy && !inbox.conversationError && !filtered.length && (
            <p className="chat-empty">
              {filter ? '没有匹配的联系人' : '暂无私信，点击 + 选择好友'}
            </p>
          )}
          {inbox.conversationBusy && (
            <p className="loading">
              <LoaderCircle size={14} className="spin" />
              加载中…
            </p>
          )}
          <div ref={conversationPages} className="pagination-sentinel" aria-hidden="true" />
        </div>
      </aside>
      <div className="private-thread">
        {!inbox.selected ? (
          <div className="private-welcome">
            <Mail size={34} />
            <h2>从一句话，一起听起</h2>
            <p>选择会话，查看私信或分享当前多人房间。</p>
          </div>
        ) : (
          <>
            <div className="private-thread-heading">
              <span className="avatar thread-avatar">
                {inbox.selected.avatar ? (
                  <img src={inbox.selected.avatar} alt="" />
                ) : (
                  inbox.selected.nickname.slice(0, 1)
                )}
              </span>
              <div>
                <strong>{inbox.selected.nickname}</strong>
                <small>{inbox.selected.online === true ? '在线' : '网易云私信'}</small>
              </div>
              <button
                className="text-btn"
                disabled={!room || inbox.sending}
                onClick={() => {
                  if (room && inbox.selected)
                    setConfirmInvite({
                      room: { ...room },
                      uid: inbox.selected.uid,
                      name: inbox.selected.nickname,
                    })
                }}
              >
                <Headphones size={15} />
                邀请到当前房间
              </button>
              <button
                className="icon-btn"
                aria-label="刷新当前私信"
                disabled={inbox.historyBusy}
                onClick={inbox.refreshHistory}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            {inbox.readError && (
              <div className="private-read-error" role="status">
                <span>已读状态同步失败：{inbox.readError}</span>
                <button className="text-btn" onClick={inbox.refreshHistory}>
                  重试同步已读
                </button>
              </div>
            )}
            {inbox.historyError && (
              <p className="private-error" role="alert">
                {inbox.historyError}
              </p>
            )}
            <div
              ref={log}
              className="private-messages"
              role="log"
              aria-label="私信消息"
              aria-live="polite"
              onScroll={() => {
                const box = log.current
                if (box) {
                  stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 70
                  if (inbox.messages.length)
                    savePrivateView(readingKey, stick.current, captureHistoryAnchor(box))
                }
              }}
            >
              <div ref={historyPages} className="pagination-sentinel" aria-hidden="true" />
              {inbox.historyBusy && !inbox.messages.length && (
                <p className="loading">正在读取私信…</p>
              )}
              {!inbox.historyBusy && !inbox.historyError && !inbox.messages.length && (
                <p className="chat-empty">还没有聊天记录</p>
              )}
              {inbox.messages.map((message, index) => (
                <div key={message.id} data-message-id={message.id} className="private-message-item">
                  {(index === 0 ||
                    new Date(inbox.messages[index - 1].time).toDateString() !==
                      new Date(message.time).toDateString()) && (
                    <div className="message-date">{dateLabel(message.time)}</div>
                  )}
                  <ChatMessageCard
                    mine={message.senderId === selfUid}
                    author={
                      message.senderId === selfUid
                        ? account.nickname || '我'
                        : inbox.selected?.nickname || '听友'
                    }
                    avatar={
                      message.senderId === selfUid ? account.avatarUrl : inbox.selected?.avatar
                    }
                    time={message.time}
                  >
                    <MessageContent
                      api={api}
                      accountKey={selfUid}
                      text={message.text}
                      attachments={message.attachments}
                      richText={message.richText}
                      room={!!room}
                      roomKey={room?.roomId}
                      onSong={onSong}
                      onAlbum={onAlbum}
                      onAudition={onAudition}
                      onMediaPlay={onMediaPlay}
                    />
                    {message.invitations.map((invite) => (
                      <InviteCard
                        key={`${invite.roomId}:${invite.inviterUid}`}
                        invite={invite}
                        api={api}
                        room={room}
                        busy={busy}
                        onJoin={join}
                      />
                    ))}
                    {message.delivery && (
                      <small className={message.error ? 'chat-failed' : ''}>
                        {message.error ||
                          {
                            sending: '发送中…',
                            submitted: '已提交，等待私信回显',
                            failed: '发送失败',
                            uncertain: '结果未确认',
                          }[message.delivery]}
                      </small>
                    )}
                  </ChatMessageCard>
                </div>
              ))}
            </div>
            <ChatComposer
              key={`${selfUid}:${inbox.selected.uid}`}
              className="private-compose"
              value={inbox.draft}
              onChange={inbox.setDraft}
              label="私信内容"
              placeholder="发送私信…"
              maxLength={PRIVATE_TEXT_LIMIT}
              busy={inbox.sending}
              submitLabel="发送私信"
              onSubmit={() => {
                stick.current = true
                return inbox.send()
              }}
              renderTools={(insertText) => (
                <>
                  <EmojiPicker
                    api={api}
                    accountKey={selfUid}
                    scope="private"
                    recipient={inbox.selected!.nickname}
                    triggerLabel="表情包"
                    triggerIcon={<Sticker size={16} />}
                    disabled={inbox.sending}
                    onSticker={inbox.sendSticker}
                    onInsert={insertText}
                  />
                  <MediaComposer
                    accountKey={selfUid}
                    target={{ kind: 'private', uid: inbox.selected!.uid }}
                    label={inbox.selected!.nickname}
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
        <Overlay title="选择私信收件人" onClose={() => setShowContacts(false)}>
          <form
            className="recipient-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (/^[1-9]\d{0,23}$/.test(newUid) && newUid !== selfUid) {
                inbox.select({
                  uid: newUid,
                  nickname: `用户 ${newUid}`,
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
              aria-label="收件人网易云 ID"
              placeholder="或输入网易云用户 ID"
              value={newUid}
              onChange={(e) => setNewUid(e.target.value.trim())}
            />
            <button
              className="secondary"
              disabled={!/^[1-9]\d{0,23}$/.test(newUid) || newUid === selfUid}
            >
              打开会话
            </button>
          </form>
          <p className="muted">我关注的人</p>
          {inbox.contactsError && (
            <p role="alert" className="private-error">
              {inbox.contactsError}
            </p>
          )}
          <div className="contacts-picker">
            {inbox.contacts.map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  inbox.select(c)
                  setShowContacts(false)
                }}
              >
                <span>{c.nickname}</span>
                <small>{c.uid}</small>
              </button>
            ))}
            <div ref={contactPages} className="pagination-sentinel" aria-hidden="true" />
          </div>
          {inbox.contactsBusy && <p className="loading">正在读取联系人…</p>}
        </Overlay>
      )}
      {confirmInvite && (
        <Overlay title={`邀请 ${confirmInvite.name} 一起听`} onClose={() => setConfirmInvite(null)}>
          <p>将通过网易云私信发送以下多人房间链接：</p>
          <pre className="invite-preview-text">
            {inviteText(confirmInvite.room.roomId, selfUid)}
          </pre>
          <div className="row-actions">
            <button className="secondary" onClick={() => setConfirmInvite(null)}>
              取消
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
              确认发送邀请
            </button>
          </div>
        </Overlay>
      )}
      {switchInvite && (
        <Overlay title="切换一起听房间？" onClose={() => setSwitchInvite(null)}>
          <p>将先离开当前房间，再加入这条邀请对应的官方多人房间。</p>
          <div className="row-actions">
            <button className="secondary" onClick={() => setSwitchInvite(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                await onJoin(switchInvite)
                setSwitchInvite(null)
              }}
            >
              确认切换房间
            </button>
          </div>
        </Overlay>
      )}
    </section>
  )
}

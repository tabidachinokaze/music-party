import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Headphones,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  Users,
} from 'lucide-react'
import type { MultiInvitation, Room } from '../../shared/types'
import { PRIVATE_TEXT_LIMIT, inviteText } from '../../shared/private-messages'
import type { usePrivateMessages } from './usePrivateMessages'
import type { ApiCall } from './music-data'
import { Overlay } from './player/Overlay'

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
}: {
  inbox: Inbox
  account: any
  room: Room | null
  api: ApiCall
  busy: boolean
  onJoin(invite: MultiInvitation): Promise<void>
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
    historyAnchor = useRef<{ height: number; top: number } | null>(null)
  useEffect(() => {
    stick.current = true
    setConfirmInvite(null)
    setSwitchInvite(null)
  }, [inbox.selected?.uid, account?.userId])
  useLayoutEffect(() => {
    const box = log.current
    if (!box) return
    const anchor = historyAnchor.current
    if (anchor) {
      box.scrollTop = anchor.top + box.scrollHeight - anchor.height
      historyAnchor.current = null
    } else if (stick.current) box.scrollTop = box.scrollHeight
  }, [inbox.messages])
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
    if (log.current)
      historyAnchor.current = { height: log.current.scrollHeight, top: log.current.scrollTop }
    await inbox.loadHistory()
    requestAnimationFrame(() => {
      historyAnchor.current = null
    })
  }
  function join(invite: MultiInvitation) {
    if (room && room.roomId !== invite.roomId) setSwitchInvite(invite)
    else onJoin(invite)
  }
  if (!account)
    return (
      <div className="empty">
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
    <section className="private-layout">
      <aside className="conversation-pane">
        <div className="conversation-toolbar">
          <strong>
            私信<span className="conversation-total">{inbox.conversations.length}</span>
          </strong>
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
              {c.avatar ? (
                <img src={c.avatar} alt="" />
              ) : (
                <span className="avatar">
                  <Users size={18} />
                </span>
              )}
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
          {inbox.conversationMore && (
            <button
              className="text-btn load-more"
              disabled={inbox.conversationBusy}
              onClick={inbox.loadConversations}
            >
              更多会话
            </button>
          )}
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
                <small>网易云私信</small>
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
                if (box) stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 70
              }}
            >
              {inbox.historyMore && (
                <button
                  className="text-btn chat-older"
                  disabled={inbox.historyBusy}
                  onClick={older}
                >
                  加载更早私信
                </button>
              )}
              {inbox.historyBusy && !inbox.messages.length && (
                <p className="loading">正在读取私信…</p>
              )}
              {!inbox.historyBusy && !inbox.historyError && !inbox.messages.length && (
                <p className="chat-empty">还没有聊天记录</p>
              )}
              {inbox.messages.map((message, index) => (
                <div key={message.id} className="private-message-item">
                  {(index === 0 ||
                    new Date(inbox.messages[index - 1].time).toDateString() !==
                      new Date(message.time).toDateString()) && (
                    <div className="message-date">{dateLabel(message.time)}</div>
                  )}
                  <div className={`chat-message ${message.senderId === selfUid ? 'mine' : ''}`}>
                    <div className="chat-author">
                      <span>{message.senderId === selfUid ? '我' : inbox.selected?.nickname}</span>
                      <time>
                        {new Date(message.time).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    <div className="chat-bubble">{message.text}</div>
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
                  </div>
                </div>
              ))}
            </div>
            <form
              className="private-compose"
              onSubmit={(e) => {
                e.preventDefault()
                stick.current = true
                inbox.send()
              }}
            >
              <textarea
                aria-label="私信内容"
                placeholder={`发送给 ${inbox.selected.nickname}`}
                value={inbox.draft}
                maxLength={PRIVATE_TEXT_LIMIT}
                onChange={(e) => inbox.setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault()
                    stick.current = true
                    inbox.send()
                  }
                }}
              />
              <div>
                <small>
                  {inbox.draft.length}/{PRIVATE_TEXT_LIMIT} · Shift+Enter 换行
                </small>
                <button className="primary" disabled={inbox.sending || !inbox.draft.trim()}>
                  <Send size={15} />
                  {inbox.sending ? '发送中…' : '发送私信'}
                </button>
              </div>
            </form>
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
          </div>
          {inbox.contactsBusy && <p className="loading">正在读取联系人…</p>}
          {inbox.contactsMore && (
            <button
              className="text-btn load-more"
              disabled={inbox.contactsBusy}
              onClick={() => inbox.loadContacts(true)}
            >
              更多联系人
            </button>
          )}
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

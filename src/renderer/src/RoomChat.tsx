import { useEffect, useLayoutEffect, useRef } from 'react'
import { MessageCircle, RefreshCw, Sticker, X } from 'lucide-react'
import type { Member, Room, Song } from '../../shared/types'
import { MessageContent } from './MessageContent'
import { ChatMessageCard, RoomActivityCard } from './ChatMessageCard'
import { EmojiPicker } from './EmojiPicker'
import { MediaComposer } from './MediaComposer'
import { CHAT_MAX_LENGTH } from '../../shared/chat'
import type { useRoomChat } from './useRoomChat'
import { useDismissable } from './player/useDismissable'
import { usePresence } from './player/usePresence'
import { useScrollPagination } from './useScrollPagination'
import { ChatComposer } from './ChatComposer'
import { captureHistoryAnchor, restoreHistoryAnchor, type HistoryAnchor } from './history-scroll'

export function RoomChat({
  chat,
  room,
  uid,
  onlineCount,
  members,
  onSong,
  onAlbum,
  onAudition,
  onMediaPlay,
}: {
  chat: ReturnType<typeof useRoomChat>
  room: Room | null
  uid: string
  onlineCount: number | null
  members: Member[]
  onSong(song: Song): void
  onAlbum(id: string, title: string): void
  onAudition(song: Song): void
  onMediaPlay(): void
}) {
  const list = useRef<HTMLDivElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const presence = usePresence(chat.visible)
  useDismissable(drawer, () => chat.setVisible(false), chat.visible, '[data-popup-toggle="chat"]')
  const nearBottom = useRef(true)
  const historyAnchor = useRef<HistoryAnchor | null>(null)
  const composer = useRef<{ insertText(text: string): void }>(null)
  const viewerNickname = members.find((member) => member.uid === uid)?.nickname || ''
  const historyPages = useScrollPagination({
    enabled: chat.visible && Boolean(room),
    loading: chat.loading,
    hasMore: chat.more,
    blocked: Boolean(chat.error),
    scope: `${uid}:${room?.roomId}`,
    contentKey: chat.messages.length,
    direction: 'top',
    autoFill: false,
    onLoad: older,
  })
  useEffect(() => {
    nearBottom.current = true
    historyAnchor.current = null
  }, [uid, room?.roomId])
  useEffect(() => {
    if (!chat.visible) return
    const previous = document.activeElement as HTMLElement | null
    drawer.current?.querySelector<HTMLButtonElement>('[aria-label="关闭聊天"]')?.focus()
    const key = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.isComposing &&
        !event.defaultPrevented &&
        !document.querySelector('[aria-modal="true"], :popover-open')
      ) {
        event.preventDefault()
        chat.setVisible(false)
      }
    }
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('keydown', key)
      if (previous?.isConnected && previous.getClientRects().length) previous.focus()
    }
  }, [chat.visible])
  useLayoutEffect(() => {
    const box = list.current
    if (!box) return
    const anchor = historyAnchor.current
    if (anchor) {
      restoreHistoryAnchor(box, anchor)
      historyAnchor.current = null
    } else if (nearBottom.current) box.scrollTop = box.scrollHeight
  }, [chat.messages, chat.visible])
  async function older() {
    const anchor = list.current ? captureHistoryAnchor(list.current) : null
    historyAnchor.current = anchor
    await chat.loadOlder()
    requestAnimationFrame(() => {
      if (historyAnchor.current === anchor) historyAnchor.current = null
    })
  }
  return (
    <aside
      hidden={!presence.mounted}
      ref={drawer}
      className="chat-drawer"
      aria-label="官方房间聊天"
      data-closing={presence.closing}
      aria-hidden={presence.closing}
      inert={presence.closing}
    >
      <div className="chat-heading">
        <MessageCircle size={19} />
        <div>
          <strong>房间聊天</strong>
          <small>{onlineCount === null ? '官方多人一起听' : `${onlineCount} 人一起听`}</small>
        </div>
        <button
          className="icon-btn"
          aria-label="刷新聊天"
          disabled={!room || chat.loading}
          onClick={chat.refresh}
        >
          <RefreshCw size={16} />
        </button>
        <button className="icon-btn" aria-label="关闭聊天" onClick={() => chat.setVisible(false)}>
          <X size={18} />
        </button>
      </div>
      {!room ? (
        <div className="chat-empty">加入官方多人房间后，与听友聊天</div>
      ) : (
        <>
          <div className="chat-status" role="status">
            {chat.error ||
              (chat.loading
                ? '正在读取聊天记录…'
                : chat.lastUpdate
                  ? `更新于 ${chat.lastUpdate}`
                  : '正在连接聊天')}
          </div>
          <div
            className="chat-messages"
            role="log"
            aria-label="聊天消息"
            aria-live="polite"
            ref={list}
            onScroll={() => {
              const box = list.current
              if (box) nearBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 70
            }}
          >
            <div ref={historyPages} className="pagination-sentinel" aria-hidden="true" />
            {!chat.loading && !chat.messages.length && (
              <div className="chat-empty">还没有消息，聊聊正在听的歌吧</div>
            )}
            {chat.messages.map((message) => {
              const activity = !message.emoji && message.kind !== 'text' && message.kind !== 'image'
              const delivery = message.delivery && (
                <small
                  className={
                    message.delivery === 'failed' || message.delivery === 'uncertain'
                      ? 'chat-failed'
                      : ''
                  }
                >
                  {message.error ||
                    {
                      sending: '发送中…',
                      submitted: '已提交，等待房间回显',
                      failed: '发送失败',
                      uncertain: '结果未确认',
                    }[message.delivery]}
                </small>
              )
              return activity ? (
                <RoomActivityCard
                  key={message.id}
                  id={message.id}
                  message={message}
                  onAuthor={
                    message.uid !== '0'
                      ? () => composer.current?.insertText(`@${message.nickname} `)
                      : undefined
                  }
                >
                  {delivery}
                </RoomActivityCard>
              ) : (
                <ChatMessageCard
                  key={message.id}
                  id={message.id}
                  mine={message.uid === uid}
                  author={message.nickname}
                  avatar={message.avatar || members.find((m) => m.uid === message.uid)?.avatar}
                  time={message.time}
                  onAuthor={() => composer.current?.insertText(`@${message.nickname} `)}
                  mentioned={
                    Boolean(viewerNickname) && message.text.includes(`@${viewerNickname} `)
                  }
                >
                  <MessageContent
                    api={chat.api}
                    accountKey={uid}
                    text={message.text}
                    attachments={message.attachments}
                    richText={message.richText}
                    room
                    roomKey={room.roomId}
                    onSong={onSong}
                    onAlbum={onAlbum}
                    onAudition={onAudition}
                    onMediaPlay={onMediaPlay}
                  />
                  {delivery}
                </ChatMessageCard>
              )
            })}
          </div>
          <ChatComposer
            composerRef={composer}
            key={`${uid}:${room.roomId}`}
            className="chat-compose"
            value={chat.draft}
            onChange={chat.setDraft}
            label="聊天内容"
            placeholder="聊聊这首歌，输入 @ 提及成员…"
            maxLength={CHAT_MAX_LENGTH}
            busy={chat.sending}
            disabled={!room.chatRoomId}
            members={members}
            notice={!room.chatRoomId ? '正在等待官方聊天室信息，可刷新房间成员后重试。' : undefined}
            onSubmit={() => {
              nearBottom.current = true
              return chat.send()
            }}
            renderTools={(insertText) => (
              <>
                <EmojiPicker
                  api={chat.api}
                  accountKey={uid}
                  scope="room"
                  recipient="当前一起听房间"
                  triggerLabel="表情包"
                  triggerIcon={<Sticker size={16} />}
                  disabled={chat.sending || !room.chatRoomId}
                  onInsert={insertText}
                  stickers={chat.messages.flatMap((message) =>
                    message.emoji ? [message.emoji] : [],
                  )}
                  onSticker={(emoji) => {
                    nearBottom.current = true
                    chat.send(emoji)
                  }}
                />
                <MediaComposer
                  accountKey={uid}
                  target={{ kind: 'room', roomId: room.roomId }}
                  label="当前一起听房间"
                  disabled={chat.sending || !room.chatRoomId}
                  onSent={chat.acceptMedia}
                  onMediaPlay={onMediaPlay}
                />
              </>
            )}
          />
        </>
      )}
    </aside>
  )
}

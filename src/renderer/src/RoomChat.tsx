import { PanelHeader } from './windows/Surface'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { CircleArrowDown, ThumbsUp, RefreshCw, Sticker } from 'lucide-react'
import type { Member, Room, Song } from '../../shared/types'
import { MessageContent } from './MessageContent'
import { ChatMessageCard, RoomActivityCard } from './ChatMessageCard'
import { EmojiPicker } from './EmojiPicker'
import { MediaComposer } from './MediaComposer'
import { CHAT_MAX_LENGTH } from '../../shared/chat'
import type { useRoomChat } from './useRoomChat'
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
  onLike,
  likeDisabled,
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
  onLike(): void
  likeDisabled: boolean
  onMediaPlay(): void
}) {
  const list = useRef<HTMLDivElement>(null)
  const [showLatest, setShowLatest] = useState(false)
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
    setShowLatest(false)
    historyAnchor.current = null
  }, [uid, room?.roomId])
  useLayoutEffect(() => {
    const box = list.current
    if (!box) return
    const anchor = historyAnchor.current
    if (anchor) {
      restoreHistoryAnchor(box, anchor)
      historyAnchor.current = null
    } else if (nearBottom.current) box.scrollTop = box.scrollHeight
  }, [chat.messages, chat.visible])
  useLayoutEffect(() => {
    const box = list.current
    if (!box || !chat.visible) return
    const observer = new ResizeObserver(() => {
      if (nearBottom.current && box.clientHeight) box.scrollTop = box.scrollHeight
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [chat.visible, room?.roomId])
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
      hidden={!chat.visible}
      className="chat-drawer"
      aria-label="官方房间聊天"
      data-closing={!chat.visible}
      aria-hidden={!chat.visible}
      inert={!chat.visible}
    >
      <PanelHeader>
        <div className="panel-inline-actions">
          <small>{onlineCount === null ? '一起听' : onlineCount + ' 人一起听'}</small>
          <button
            className="icon-btn"
            aria-label="刷新聊天"
            disabled={!room || chat.loading}
            onClick={chat.refresh}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </PanelHeader>
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
              if (box?.clientHeight) {
                nearBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 30
                setShowLatest(!nearBottom.current)
              }
            }}
          >
            <div ref={historyPages} className="pagination-sentinel" aria-hidden="true" />
            {!chat.loading && !chat.messages.length && (
              <div className="chat-empty">还没有聊天消息</div>
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
          {showLatest && (
            <button
              className="back-to-latest"
              aria-label="回到最新消息"
              title="回到最新消息"
              onClick={() => {
                if (list.current) list.current.scrollTop = list.current.scrollHeight
                nearBottom.current = true
                setShowLatest(false)
              }}
            >
              <CircleArrowDown size={18} />
            </button>
          )}
          <ChatComposer
            leadingTool={
              <button
                type="button"
                className="icon-btn"
                aria-label="一起听点赞"
                title="为房间当前歌曲点赞"
                disabled={likeDisabled}
                onClick={onLike}
              >
                <ThumbsUp size={16} />
              </button>
            }
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

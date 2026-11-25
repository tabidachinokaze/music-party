import { ui } from '../../shared/ui-language'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { ArrowDown, Sticker } from 'lucide-react'
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
  members,
  onSong,
  onAlbum,
  onAudition,
  onMediaPlay,
}: {
  chat: ReturnType<typeof useRoomChat>
  room: Room | null
  uid: string
  members: Member[]
  onSong(song: Song): void
  onAlbum(id: string, title: string): void
  onAudition(song: Song): void
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
      aria-label={ui('官方房间聊天', 'Room chat')}
      data-closing={!chat.visible}
      aria-hidden={!chat.visible}
      inert={!chat.visible}
    >
      {!room ? (
        <div className="chat-empty">
          {ui(
            '加入官方多人房间后，与听友聊天',
            'Join a listening room to chat with other listeners',
          )}
        </div>
      ) : (
        <>
          <div className="chat-status" role="status" data-error={Boolean(chat.error)}>
            {chat.error ||
              (chat.loading
                ? ui('正在读取聊天记录…', 'Loading chat history…')
                : chat.lastUpdate
                  ? ui('更新于 {0}', 'Updated at {0}', chat.lastUpdate)
                  : ui('正在连接聊天', 'Connecting to chat'))}
          </div>
          <div className="chat-history-frame">
            <div
              data-list-viewport=""
              className="chat-messages"
              role="log"
              aria-label={ui('聊天消息', 'Chat messages')}
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
                <div className="chat-empty">{ui('还没有聊天消息', 'No messages yet')}</div>
              )}
              {chat.messages.map((message) => {
                const activity =
                  !message.emoji && message.kind !== 'text' && message.kind !== 'image'
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
                        sending: ui('发送中…', 'Sending…'),
                        submitted: ui(
                          '已提交，等待房间回显',
                          'Sent. Waiting for the room to confirm.',
                        ),
                        failed: ui('发送失败', 'Send failed'),
                        uncertain: ui('结果未确认', 'Delivery unconfirmed'),
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
                      text={
                        message.previewOnlyText
                          ? ''
                          : message.fallbackTextEn
                            ? ui(message.text, message.fallbackTextEn)
                            : message.text
                      }
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
                aria-label={ui('回到最新消息', 'Jump to latest')}
                title={ui('回到最新消息', 'Jump to latest')}
                onClick={() => {
                  if (list.current) list.current.scrollTop = list.current.scrollHeight
                  nearBottom.current = true
                  setShowLatest(false)
                }}
              >
                <ArrowDown size={18} />
              </button>
            )}
          </div>
          <ChatComposer
            composerRef={composer}
            key={`${uid}:${room.roomId}`}
            className="chat-compose"
            value={chat.draft}
            onChange={chat.setDraft}
            label={ui('聊天内容', 'Chat message')}
            placeholder={ui(
              '聊聊这首歌，输入 @ 提及成员…',
              'Talk about this song, or type @ to mention someone…',
            )}
            maxLength={CHAT_MAX_LENGTH}
            busy={chat.sending}
            disabled={!room.chatRoomId}
            members={members}
            notice={
              !room.chatRoomId
                ? ui(
                    '正在等待官方聊天室信息，连接后将自动更新。',
                    'Waiting for the chat room to connect.',
                  )
                : undefined
            }
            onSubmit={() => {
              nearBottom.current = true
              return chat.send()
            }}
            renderTools={() => (
              <>
                <EmojiPicker
                  api={chat.api}
                  accountKey={uid}
                  scope="room"
                  recipient={ui('当前一起听房间', 'Current listening room')}
                  triggerLabel={ui('表情包', 'Stickers')}
                  triggerIcon={<Sticker size={16} />}
                  disabled={chat.sending || !room.chatRoomId}
                  onSticker={(emoji) => {
                    nearBottom.current = true
                    chat.send(emoji)
                  }}
                />
                <MediaComposer
                  accountKey={uid}
                  target={{ kind: 'room', roomId: room.roomId }}
                  label={ui('当前一起听房间', 'Current listening room')}
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

import { useEffect, useLayoutEffect, useRef } from 'react'
import { MessageCircle, RefreshCw, Send, X } from 'lucide-react'
import type { Room, Song } from '../../shared/types'
import { MessageContent } from './MessageContent'
import { EmojiPicker } from './EmojiPicker'
import { MediaComposer } from './MediaComposer'
import { CHAT_MAX_LENGTH } from '../../shared/chat'
import type { useRoomChat } from './useRoomChat'
import { useDismissable } from './player/useDismissable'
import { usePresence } from './player/usePresence'

export function RoomChat({
  chat,
  room,
  uid,
  onlineCount,
  onSong,
  onMediaPlay,
}: {
  chat: ReturnType<typeof useRoomChat>
  room: Room | null
  uid: string
  onlineCount: number | null
  onSong(song: Song): void
  onMediaPlay(): void
}) {
  const list = useRef<HTMLDivElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const presence = usePresence(chat.visible)
  useDismissable(drawer, () => chat.setVisible(false), chat.visible, '[data-popup-toggle="chat"]')
  const nearBottom = useRef(true)
  const historyAnchor = useRef<{ height: number; top: number } | null>(null)
  useEffect(() => {
    if (!chat.visible) return
    const previous = document.activeElement as HTMLElement | null
    drawer.current?.querySelector<HTMLButtonElement>('[aria-label="关闭聊天"]')?.focus()
    const key = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.isComposing &&
        !event.defaultPrevented &&
        !document.querySelector('[aria-modal="true"]')
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
      box.scrollTop = anchor.top + box.scrollHeight - anchor.height
      historyAnchor.current = null
    } else if (nearBottom.current) box.scrollTop = box.scrollHeight
  }, [chat.messages, chat.visible])
  async function older() {
    if (list.current)
      historyAnchor.current = { height: list.current.scrollHeight, top: list.current.scrollTop }
    await chat.loadOlder()
    requestAnimationFrame(() => {
      historyAnchor.current = null
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
            {chat.more && (
              <button className="text-btn chat-older" disabled={chat.loading} onClick={older}>
                加载更早消息
              </button>
            )}
            {!chat.loading && !chat.messages.length && (
              <div className="chat-empty">还没有消息，聊聊正在听的歌吧</div>
            )}
            {chat.messages.map((message) => (
              <div
                key={message.id}
                className={`chat-message ${message.uid === uid ? 'mine' : ''} ${message.kind === 'notice' ? 'chat-notice' : ''}`}
              >
                <div className="chat-author">
                  {message.avatar && <img src={message.avatar} alt="" />}
                  <span>{message.uid === uid ? '我' : message.nickname}</span>
                  <time>
                    {new Date(message.time).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
                <MessageContent
                  text={message.text}
                  attachments={message.attachments}
                  richText={message.richText}
                  room
                  onSong={onSong}
                  onMediaPlay={onMediaPlay}
                />
                {message.delivery && (
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
                )}
              </div>
            ))}
          </div>
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault()
              nearBottom.current = true
              chat.send()
            }}
          >
            {!room.chatRoomId && <p>正在等待官方聊天室信息，可刷新房间成员后重试。</p>}
            <div className="compose-tools">
              <MediaComposer
                target={{ kind: 'room', roomId: room.roomId }}
                label="当前一起听房间"
                disabled={chat.sending || !room.chatRoomId}
                onSent={chat.acceptMedia}
                onMediaPlay={onMediaPlay}
              />
              <EmojiPicker
                disabled={chat.sending || !room.chatRoomId}
                onInsert={(value) =>
                  chat.setDraft((draft) =>
                    draft.length + value.length <= CHAT_MAX_LENGTH ? draft + value : draft,
                  )
                }
                stickers={chat.messages.flatMap((message) =>
                  message.emoji ? [message.emoji] : [],
                )}
                onSticker={(emoji) => {
                  nearBottom.current = true
                  chat.send(emoji)
                }}
              />
            </div>
            <textarea
              aria-label="聊天内容"
              placeholder="聊聊这首歌…"
              value={chat.draft}
              maxLength={CHAT_MAX_LENGTH}
              disabled={!room.chatRoomId}
              onChange={(e) => chat.setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault()
                  nearBottom.current = true
                  chat.send()
                }
              }}
            />
            <div>
              <small>
                {chat.draft.length}/{CHAT_MAX_LENGTH} · Shift+Enter 换行
              </small>
              <button
                className="primary"
                type="submit"
                disabled={!room.chatRoomId || chat.sending || !chat.draft.trim()}
              >
                <Send size={15} />
                {chat.sending ? '发送中' : '发送'}
              </button>
            </div>
          </form>
        </>
      )}
    </aside>
  )
}

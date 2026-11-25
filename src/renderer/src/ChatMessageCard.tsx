import { ui, getUiLanguage } from '../../shared/ui-language'
import type { ReactNode } from 'react'
import { UserAvatar } from './design/UserAvatar'
import { ArrowUpToLine, Heart, Info, LogOut, Music2, ThumbsUp, UserPlus } from 'lucide-react'
import type { ChatMessage } from '../../shared/types'
import { roomActivityPresentation } from '../../shared/room-activity-presentation'

const activityIcons = {
  'user-plus': UserPlus,
  'music-2': Music2,
  'arrow-up-to-line': ArrowUpToLine,
  'thumbs-up': ThumbsUp,
  heart: Heart,
  'log-out': LogOut,
  info: Info,
}

export function MessageTime({ time }: { time: number }) {
  const date = new Date(time)
  if (!Number.isFinite(date.getTime())) return <time>{ui('时间未知', 'Unknown time')}</time>
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString(getUiLanguage())}>
      {date.toLocaleTimeString(getUiLanguage(), { hour: '2-digit', minute: '2-digit' })}
    </time>
  )
}

export function ChatMessageCard({
  mine,
  id,
  author,
  avatar,
  time,
  children,
  onAuthor,
  mentioned = false,
}: {
  mine: boolean
  id?: string
  author: string
  avatar?: string
  time: number
  children: ReactNode
  onAuthor?(): void
  mentioned?: boolean
}) {
  return (
    <article
      data-message-id={id}
      className={`chat-message ${mine ? 'mine' : ''} ${mentioned ? 'chat-mentioned' : ''}`}
    >
      <UserAvatar name={author} src={avatar} className="chat-message-avatar" />
      <div className="chat-message-body">
        <div className="chat-author">
          <span>
            {onAuthor ? (
              <button
                type="button"
                className="chat-author-name"
                aria-label={ui('提及 {0}', 'Mention {0}', author)}
                onClick={onAuthor}
              >
                {author}
              </button>
            ) : (
              author
            )}
          </span>
          <MessageTime time={time} />
          {mentioned && (
            <small className="chat-mention-badge">{ui('提到了你', 'Mentioned you')}</small>
          )}
        </div>
        {children}
      </div>
    </article>
  )
}

export function RoomActivityCard({
  message,
  id,
  children,
  onAuthor,
}: {
  message: ChatMessage
  id?: string
  children?: ReactNode
  onAuthor?(): void
}) {
  const activity = roomActivityPresentation({
    ...message,
    nickname: message.uid === '0' && message.nickname === '听友' ? '' : message.nickname,
  })
  const Icon = activityIcons[activity.icon]
  return (
    <article className="chat-activity" data-activity={activity.type} data-message-id={id}>
      <span className="chat-activity-icon" aria-hidden="true">
        <Icon size={13} />
      </span>
      <div className="chat-activity-body">
        <p className="chat-activity-text">
          {activity.parts.map((part, index) =>
            part.kind === 'actor' && onAuthor ? (
              <button
                type="button"
                key={index}
                className="chat-activity-actor chat-author-name"
                onClick={onAuthor}
                aria-label={ui('提及 {0}', 'Mention {0}', message.nickname)}
              >
                {part.text}
              </button>
            ) : (
              <span
                key={index}
                className={part.kind === 'text' ? undefined : `chat-activity-${part.kind}`}
              >
                {part.text}
              </span>
            ),
          )}
        </p>
        <div className="chat-activity-heading">
          <span>{activity.label}</span>
          <MessageTime time={message.time} />
        </div>
        {children}
      </div>
    </article>
  )
}

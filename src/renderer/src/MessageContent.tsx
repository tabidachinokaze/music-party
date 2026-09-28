import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, ImageOff, Music2, Play, Plus } from 'lucide-react'
import type { MessageAttachment, MessageTextPart, Song } from '../../shared/types'
import { Overlay } from './player/Overlay'

function Attachment({
  item,
  room,
  onSong,
  onMediaPlay,
}: {
  item: MessageAttachment
  room: boolean
  onSong(song: Song): void
  onMediaPlay(): void
}) {
  const [failed, setFailed] = useState(false)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const audio = useRef<HTMLAudioElement>(null),
    video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const players = [audio.current, video.current]
    return () => players.forEach((player) => player?.pause())
  }, [item.url])
  const playableSong = item.resourceType === 'song' && /^\d+$/.test(item.resourceId || '')
  const open = () => {
    if (playableSong)
      onSong({
        id: item.resourceId!,
        name: item.title,
        artist: item.subtitle || '',
        cover: item.cover || '',
        album: '',
        duration: 0,
      })
    else if (item.actionUrl)
      window.together.openMessageLink(item.actionUrl).catch((error) => setError(error.message))
  }
  if (item.kind === 'image')
    return (
      <>
        {item.url && !failed ? (
          <button
            type="button"
            className="message-image"
            aria-label={`查看图片：${item.title}`}
            onClick={() => setPreview(true)}
          >
            <img
              src={item.url}
              alt={item.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
            />
          </button>
        ) : (
          <div className="message-media-missing">
            <ImageOff size={18} />
            {item.title} · 图片暂不可用
          </div>
        )}
        {preview && (
          <Overlay title="图片预览" wide onClose={() => setPreview(false)}>
            <img
              className="message-image-preview"
              src={item.url}
              alt={item.title}
              referrerPolicy="no-referrer"
            />
          </Overlay>
        )}
      </>
    )
  if (item.kind === 'audio' || item.kind === 'video')
    return (
      <div className="message-media">
        <small>{item.title}</small>
        {!item.url || failed ? (
          <p>媒体暂不可用</p>
        ) : item.kind === 'audio' ? (
          <audio
            ref={audio}
            aria-label={item.title}
            controls
            preload="none"
            src={item.url}
            onPlay={onMediaPlay}
            onError={() => setFailed(true)}
          />
        ) : (
          <video
            ref={video}
            aria-label={item.title}
            controls
            preload="none"
            src={item.url}
            poster={item.cover}
            onPlay={onMediaPlay}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    )
  return (
    <div className="message-resource-wrap">
      <button
        type="button"
        className="message-resource"
        onClick={open}
        disabled={!playableSong && !item.actionUrl}
        aria-label={`${playableSong ? (room ? '推送' : '播放') : '打开资源'} ${item.title}`}
      >
        {item.cover && !failed ? (
          <img
            src={item.cover}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="message-resource-icon">
            {item.kind === 'file' ? <FileText size={24} /> : <Music2 size={24} />}
          </span>
        )}
        <span>
          <strong>{item.title}</strong>
          <small>{item.subtitle || (item.kind === 'file' ? '文件' : '网易云分享')}</small>
        </span>
        {playableSong ? (
          room ? (
            <Plus size={17} />
          ) : (
            <Play size={17} />
          )
        ) : item.actionUrl ? (
          <ExternalLink size={15} />
        ) : null}
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
export function MessageContent({
  text,
  attachments,
  richText,
  room,
  onSong,
  onMediaPlay,
}: {
  text: string
  attachments?: MessageAttachment[]
  richText?: MessageTextPart[]
  room: boolean
  onSong(song: Song): void
  onMediaPlay(): void
}) {
  const [error, setError] = useState('')
  return (
    <>
      <div className="chat-bubble">
        {richText?.length
          ? richText.map((part, index) =>
              part.url ? (
                <button
                  key={index}
                  className="message-text-link"
                  onClick={() =>
                    window.together
                      .openMessageLink(part.url!)
                      .catch((error) => setError(error.message))
                  }
                >
                  {part.text}
                </button>
              ) : part.emphasized ? (
                <strong key={index}>{part.text}</strong>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )
          : text}
      </div>
      {attachments?.map((item, index) => (
        <Attachment
          key={`${index}:${item.url || item.resourceId || item.title}`}
          item={item}
          room={room}
          onSong={onSong}
          onMediaPlay={onMediaPlay}
        />
      ))}
      {error && <small role="alert">{error}</small>}
    </>
  )
}

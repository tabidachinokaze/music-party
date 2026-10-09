import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Disc3, ExternalLink, FileText, Headphones, ImageOff, Music2, Play } from 'lucide-react'
import type { MessageAttachment, MessageTextPart, Song } from '../../shared/types'
import type { ApiCall } from './music-data'
import { messageDisplayText } from '../../shared/message-content'
import { attachmentMusicResource, messageMusicResource } from '../../shared/message-resource'
import { messageStickerSource } from '../../shared/sticker-source'
import { isStickerSaved, rememberSticker, stickerLibrary, stickersChanged } from './sticker-cache'
import { Overlay } from './player/Overlay'

const resourceLabels: Record<string, string> = {
  song: '单曲',
  album: '专辑',
  playlist: '歌单',
  artist: '歌手',
  mv: 'MV',
}

function imageMenuPosition(bounds: DOMRect) {
  const below = bounds.bottom + 48 <= window.innerHeight - 12
  return {
    left: Math.max(12, Math.min(bounds.left, window.innerWidth - 256)),
    top: Math.max(12, below ? bounds.bottom + 8 : bounds.top - 48),
  }
}

function Attachment({
  item,
  room,
  onSong,
  onAlbum,
  onMediaPlay,
  api,
  accountKey,
}: {
  item: MessageAttachment
  room: boolean
  onSong(song: Song): void
  onAlbum(id: string, title: string): void
  onMediaPlay(): void
  api?: ApiCall
  accountKey?: string
}) {
  const [failed, setFailed] = useState(false)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const [dimensions, setDimensions] = useState({ width: item.width, height: item.height })
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null)
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false)
  const source = messageStickerSource(item, dimensions.width, dimensions.height)
  const menuAnchor = useRef<HTMLElement | null>(null)
  const current = useRef(accountKey)
  current.current = accountKey
  useEffect(() => {
    setMenu(null)
    setPreview(false)
    setSaved(false)
    setSaving(false)
    setFailed(false)
    setDimensions({ width: item.width, height: item.height })
    setError('')
  }, [item.url, accountKey])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', close)
    const reposition = () => {
      const bounds = menuAnchor.current?.getBoundingClientRect()
      if (!bounds || bounds.bottom <= 0 || bounds.top >= window.innerHeight) {
        close()
        return
      }
      const next = imageMenuPosition(bounds)
      setMenu((previous) =>
        previous && (previous.left !== next.left || previous.top !== next.top) ? next : previous,
      )
    }
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [menu])
  async function saveSticker() {
    if (!source || !accountKey || !api || saving) return
    const account = accountKey
    stickerLibrary(account, room ? 'room' : 'private')
    if (isStickerSaved(account, source)) {
      setSaved(true)
      setMenu(null)
      return
    }
    setSaving(true)
    setError('')
    try {
      if ('emojiId' in source) {
        await api('stickerCollect', { emojiId: source.emojiId, emojiGroupId: source.emojiGroupId })
        if (current.current !== account) return
        rememberSticker(account, source)
      } else {
        const reply = await window.together.saveStickerImage({
          requestId: crypto.randomUUID(),
          image: source,
        })
        if (current.current !== account) return
        if (!reply.ok || !reply.receipt?.emoji)
          throw new Error(reply.error || '表情保存未确认，请刷新列表')
        rememberSticker(account, source, reply.receipt.emoji)
      }
      stickersChanged(account)
      setSaved(true)
      setMenu(null)
    } catch (error: any) {
      if (current.current === account) setError(error.message || '添加表情失败')
    } finally {
      if (current.current === account) setSaving(false)
    }
  }
  const audio = useRef<HTMLAudioElement>(null),
    video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const players = [audio.current, video.current]
    return () => players.forEach((player) => player?.pause())
  }, [item.url])
  const target = attachmentMusicResource(item)
  const playableSong = target?.type === 'song'
  const internalAlbum = target?.type === 'album'
  const open = () => {
    if (playableSong)
      onSong({
        id: target.id,
        name: item.title,
        artist: item.subtitle || '',
        cover: item.cover || '',
        album: '',
        duration: 0,
      })
    else if (internalAlbum) onAlbum(target.id, item.title)
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
            onContextMenu={(event) => {
              if (!source || !api || !accountKey) return
              event.preventDefault()
              stickerLibrary(accountKey, room ? 'room' : 'private')
              setSaved(isStickerSaved(accountKey, source))
              menuAnchor.current = event.currentTarget
              setMenu(imageMenuPosition(event.currentTarget.getBoundingClientRect()))
            }}
          >
            <img
              src={item.url}
              alt={item.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              onLoad={(event) =>
                setDimensions({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setFailed(true)}
            />
          </button>
        ) : (
          <div className="message-media-missing">
            <ImageOff size={18} />
            {item.title} · 图片暂不可用
          </div>
        )}
        {menu &&
          createPortal(
            <div
              role="menu"
              className="sticker-context-menu"
              style={{ position: 'fixed', left: menu.left, top: menu.top, zIndex: 10000 }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={saving || saved}
                onClick={saveSticker}
              >
                {saved ? '已添加到我的表情包' : saving ? '正在添加…' : '添加到我的表情包'}
              </button>
            </div>,
            document.body,
          )}
        {error && <small role="alert">{error}</small>}
        {preview && (
          <Overlay title="图片预览" wide onClose={() => setPreview(false)}>
            <img
              className="message-image-preview"
              src={item.url}
              alt={item.title}
              referrerPolicy="no-referrer"
            />
            {source && api && accountKey && (
              <button
                className="secondary"
                type="button"
                disabled={saving || saved}
                onClick={saveSticker}
              >
                {saved ? '已添加到我的表情包' : saving ? '正在添加…' : '添加到我的表情包'}
              </button>
            )}
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
        disabled={!playableSong && !internalAlbum && !item.actionUrl}
        aria-label={`${playableSong ? (room ? '试听或推歌' : '播放') : internalAlbum ? '查看专辑' : '打开资源'} ${item.title}`}
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
        <span className="message-resource-copy">
          <span className="message-resource-kind">
            {resourceLabels[item.resourceType || ''] || (item.kind === 'file' ? '文件' : '分享')}
          </span>
          <strong>{item.title}</strong>
          <small>{item.subtitle || (item.kind === 'file' ? '文件' : '网易云分享')}</small>
        </span>
        {playableSong ? (
          room ? (
            <Headphones size={17} />
          ) : (
            <Play size={17} />
          )
        ) : internalAlbum ? (
          <Disc3 size={17} />
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
  onAlbum,
  onAudition,
  onMediaPlay,
  api,
  accountKey,
  roomKey,
}: {
  text: string
  attachments?: MessageAttachment[]
  richText?: MessageTextPart[]
  room: boolean
  onSong(song: Song): void
  onAlbum(id: string, title: string): void
  onAudition(song: Song): void
  onMediaPlay(): void
  api?: ApiCall
  accountKey?: string
  roomKey?: string
}) {
  const [error, setError] = useState('')
  const [songChoice, setSongChoice] = useState<Song | null>(null)
  useEffect(() => setSongChoice(null), [accountKey, roomKey, room])
  function activateSong(song: Song) {
    if (room) setSongChoice(song)
    else onSong(song)
  }
  function openTextLink(url: string, title: string) {
    const resource = messageMusicResource(url)
    if (resource?.type === 'album') onAlbum(resource.id, title)
    else if (resource?.type === 'song')
      activateSong({ id: resource.id, name: title, artist: '', album: '', cover: '', duration: 0 })
    else window.together.openMessageLink(url).catch((error) => setError(error.message))
  }
  const shareCard =
    !!attachments?.length &&
    attachments.every((item) => item.kind === 'resource' || item.kind === 'file')
  const caption = messageDisplayText(text, attachments)
  const displayText =
    shareCard &&
    attachments?.some(
      (item) =>
        caption === item.title ||
        caption ===
          `[分享${item.resourceType === 'song' ? '歌曲' : resourceLabels[item.resourceType || '']}] ${item.title}`,
    )
      ? ''
      : caption
  return (
    <div className={`message-content ${shareCard ? 'message-share-card' : ''}`}>
      {(displayText || richText?.length) && (
        <div className="chat-bubble">
          {richText?.length
            ? richText.map((part, index) =>
                part.url ? (
                  <button
                    key={index}
                    className="message-text-link"
                    onClick={() => openTextLink(part.url!, part.text)}
                  >
                    {part.text}
                  </button>
                ) : part.emphasized ? (
                  <strong key={index}>{part.text}</strong>
                ) : (
                  <span key={index}>{part.text}</span>
                ),
              )
            : displayText}
        </div>
      )}
      {attachments?.map((item, index) => (
        <Attachment
          key={`${index}:${item.url || item.resourceId || item.title}`}
          item={item}
          room={room}
          onSong={activateSong}
          onAlbum={onAlbum}
          onMediaPlay={onMediaPlay}
          api={api}
          accountKey={accountKey}
        />
      ))}
      {error && <small role="alert">{error}</small>}
      {songChoice && (
        <Overlay title="歌曲操作" onClose={() => setSongChoice(null)}>
          <p className="overlay-intro">
            {songChoice.name}
            {songChoice.artist ? ` · ${songChoice.artist}` : ''}
          </p>
          <p className="overlay-intro">试听仅在本机播放，房间继续一起听。</p>
          <div className="row-actions">
            <button
              className="secondary"
              onClick={() => {
                setSongChoice(null)
                onAudition(songChoice)
              }}
            >
              试听
            </button>
            <button
              className="primary"
              onClick={() => {
                setSongChoice(null)
                onSong(songChoice)
              }}
            >
              推歌
            </button>
          </div>
        </Overlay>
      )}
    </div>
  )
}

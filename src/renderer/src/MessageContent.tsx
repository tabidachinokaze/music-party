import { ui } from '../../shared/ui-language'
import { useSurfaceActive } from './windows/Surface'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Disc3,
  ExternalLink,
  FileText,
  Headphones,
  ImageOff,
  ListPlus,
  Music2,
  Play,
} from 'lucide-react'
import type { MessageAttachment, MessageTextPart, Song } from '../../shared/types'
import type { ApiCall } from './music-data'
import { messageDisplayText } from '../../shared/message-content'
import { attachmentMusicResource, messageMusicResource } from '../../shared/message-resource'
import { messageStickerSource } from '../../shared/sticker-source'
import { isStickerSaved, rememberSticker, stickerLibrary, stickersChanged } from './sticker-cache'
import { Overlay } from './player/Overlay'

function resourceLabels(): Record<string, string> {
  return {
    song: ui('单曲', 'Song'),
    album: ui('专辑', 'Album'),
    playlist: ui('歌单', 'Playlist'),
    artist: ui('歌手', 'Artist'),
    mv: 'MV',
  }
}

function imageMenuPosition(bounds: DOMRect, window: Window) {
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
  onRecommend,
  onAudition,
  onAlbum,
  onMediaPlay,
  api,
  accountKey,
}: {
  item: MessageAttachment
  room: boolean
  onRecommend(song: Song): void
  onAudition(song: Song): void
  onSong(song: Song): void
  onAlbum(id: string, title: string): void
  onMediaPlay(): void
  api?: ApiCall
  accountKey?: string
}) {
  const title = item.fallbackTitleEn ? ui(item.title, item.fallbackTitleEn) : item.title
  const subtitle = item.fallbackSubtitleEn
    ? ui(item.subtitle || '', item.fallbackSubtitleEn)
    : item.subtitle
  const active = useSurfaceActive()
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
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      close()
      menuAnchor.current?.focus({ preventScroll: true })
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', close)
    const reposition = () => {
      const bounds = menuAnchor.current?.getBoundingClientRect()
      if (!bounds || bounds.bottom <= 0 || bounds.top >= window.innerHeight) {
        close()
        return
      }
      const next = imageMenuPosition(bounds, window)
      setMenu((previous) =>
        previous && (previous.left !== next.left || previous.top !== next.top) ? next : previous,
      )
    }
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', key, true)
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
          throw new Error(
            reply.error ||
              ui('表情保存未确认，请刷新列表', 'Sticker save unconfirmed. Refresh the list.'),
          )
        rememberSticker(account, source, reply.receipt.emoji)
      }
      stickersChanged(account)
      setSaved(true)
      setMenu(null)
    } catch (error: any) {
      if (current.current === account)
        setError(error.message || ui('添加表情失败', 'Couldn’t add the sticker'))
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
  useEffect(() => {
    if (active) return
    audio.current?.pause()
    video.current?.pause()
    setMenu(null)
    setPreview(false)
  }, [active])
  const target = attachmentMusicResource(item)
  const playableSong =
    target?.type === 'song'
      ? {
          id: target.id,
          name: title,
          artist: subtitle || '',
          cover: item.cover || '',
          album: '',
          duration: 0,
        }
      : null
  const internalAlbum = target?.type === 'album'
  const open = () => {
    if (playableSong) onSong(playableSong)
    else if (internalAlbum) onAlbum(target.id, title)
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
            aria-label={ui('查看图片：{0}', 'View image: {0}', title)}
            onClick={() => setPreview(true)}
            onContextMenu={(event) => {
              if (!source || !api || !accountKey) return
              event.preventDefault()
              stickerLibrary(accountKey, room ? 'room' : 'private')
              setSaved(isStickerSaved(accountKey, source))
              menuAnchor.current = event.currentTarget
              setMenu(imageMenuPosition(event.currentTarget.getBoundingClientRect(), window))
            }}
          >
            <img
              src={item.url}
              alt={title}
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
            {ui('{0} · 图片暂不可用', '{0} · Image unavailable', title)}
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
                {saved
                  ? ui('已添加到我的表情包', 'Added to my stickers')
                  : saving
                    ? ui('正在添加…', 'Adding…')
                    : ui('添加到我的表情包', 'Add to my stickers')}
              </button>
            </div>,
            document.body,
          )}
        {error && <small role="alert">{error}</small>}
        {preview && (
          <Overlay title={ui('图片预览', 'Image preview')} wide onClose={() => setPreview(false)}>
            <img
              className="message-image-preview"
              src={item.url}
              alt={title}
              referrerPolicy="no-referrer"
            />
            {source && api && accountKey && (
              <button
                className="secondary"
                type="button"
                disabled={saving || saved}
                onClick={saveSticker}
              >
                {saved
                  ? ui('已添加到我的表情包', 'Added to my stickers')
                  : saving
                    ? ui('正在添加…', 'Adding…')
                    : ui('添加到我的表情包', 'Add to my stickers')}
              </button>
            )}
          </Overlay>
        )}
      </>
    )
  if (item.kind === 'audio' || item.kind === 'video')
    return (
      <div className="message-media">
        <small>{title}</small>
        {!item.url || failed ? (
          <p>{ui('媒体暂不可用', 'Media unavailable')}</p>
        ) : item.kind === 'audio' ? (
          <audio
            ref={audio}
            aria-label={title}
            controls
            preload="none"
            src={item.url}
            onPlay={onMediaPlay}
            onError={() => setFailed(true)}
          />
        ) : (
          <video
            ref={video}
            aria-label={title}
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
        aria-label={`${playableSong ? (room ? ui('试听或推歌', 'Preview or recommend') : ui('播放', 'Play')) : internalAlbum ? ui('查看专辑', 'View album') : ui('打开资源', 'Open shared item')} ${title}`}
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
            {resourceLabels()[item.resourceType || ''] ||
              (item.kind === 'file' ? ui('文件', 'File') : ui('分享', 'Shared item'))}
          </span>
          <strong>{title}</strong>
          <small>
            {subtitle ||
              (item.kind === 'file'
                ? ui('文件', 'File')
                : ui('网易云分享', 'Shared on NetEase Cloud Music'))}
          </small>
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
      {room && playableSong && (
        <div className="message-track-actions">
          <button type="button" onClick={() => onAudition(playableSong)}>
            <Headphones size={13} /> {ui('本机试听', 'Preview locally')}
          </button>
          <button type="button" onClick={() => onRecommend(playableSong)}>
            <ListPlus size={13} /> {ui('推荐到房间', 'Recommend to room')}
          </button>
        </div>
      )}
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
  children,
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
  children?: ReactNode
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
  const parts =
    richText?.length && messageDisplayText(richText.map((part) => part.text).join(''), attachments)
      ? richText
      : undefined
  return (
    <div
      className={`message-content chat-bubble ${shareCard ? 'message-share-card' : ''}`}
      data-short={caption.length <= 16 && !attachments?.length && !children}
    >
      {(caption || parts) && (
        <div className="message-caption">
          {parts
            ? parts.map((part, index) =>
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
            : caption}
        </div>
      )}
      {attachments?.map((item, index) => (
        <Attachment
          key={`${index}:${item.url || item.resourceId || item.title}`}
          item={item}
          room={room}
          onSong={activateSong}
          onRecommend={onSong}
          onAudition={onAudition}
          onAlbum={onAlbum}
          onMediaPlay={onMediaPlay}
          api={api}
          accountKey={accountKey}
        />
      ))}
      {children}
      {error && <small role="alert">{error}</small>}
      {songChoice && (
        <Overlay title={ui('歌曲操作', 'Song actions')} onClose={() => setSongChoice(null)}>
          <p className="overlay-intro">
            {songChoice.name}
            {songChoice.artist ? ` · ${songChoice.artist}` : ''}
          </p>
          <p className="overlay-intro">
            {ui(
              '试听仅在本机播放，房间继续一起听。',
              'Play a preview on this device while the room keeps listening.',
            )}
          </p>
          <div className="row-actions">
            <button
              className="secondary"
              onClick={() => {
                setSongChoice(null)
                onAudition(songChoice)
              }}
            >
              {ui('试听', 'Preview')}
            </button>
            <button
              className="primary"
              onClick={() => {
                setSongChoice(null)
                onSong(songChoice)
              }}
            >
              {ui('推歌', 'Recommend')}
            </button>
          </div>
        </Overlay>
      )}
    </div>
  )
}

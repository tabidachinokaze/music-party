import { t } from '../../shared/ui-language'
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
    song: t('messageContent.song'),
    album: t('common.album'),
    playlist: t('messageContent.playlist'),
    artist: t('common.artist'),
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
  const title = item.fallbackTitle ? t(item.fallbackTitle) : item.title
  const subtitle = item.fallbackSubtitle ? t(item.fallbackSubtitle) : item.subtitle
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
          throw new Error(reply.error || t('messageContent.stickerSaveUnconfirmedRefreshTheList'))
        rememberSticker(account, source, reply.receipt.emoji)
      }
      stickersChanged(account)
      setSaved(true)
      setMenu(null)
    } catch (error: any) {
      if (current.current === account)
        setError(error.message || t('messageContent.couldntAddTheSticker'))
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
            aria-label={t('messageContent.viewImage', { title })}
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
            {t('messageContent.imageUnavailable', { title })}
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
                  ? t('common.addedToMyStickers')
                  : saving
                    ? t('common.adding')
                    : t('common.addToMyStickers')}
              </button>
            </div>,
            document.body,
          )}
        {error && <small role="alert">{error}</small>}
        {preview && (
          <Overlay title={t('messageContent.imagePreview')} wide onClose={() => setPreview(false)}>
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
                  ? t('common.addedToMyStickers')
                  : saving
                    ? t('common.adding')
                    : t('common.addToMyStickers')}
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
          <p>{t('messageContent.mediaUnavailable')}</p>
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
        aria-label={`${playableSong ? (room ? t('messageContent.previewOrRecommend') : t('common.play')) : internalAlbum ? t('messageContent.viewAlbum') : t('messageContent.openSharedItem')} ${title}`}
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
              (item.kind === 'file' ? t('common.file') : t('messageContent.sharedItem'))}
          </span>
          <strong>{title}</strong>
          <small>
            {subtitle ||
              (item.kind === 'file'
                ? t('common.file')
                : t('messageContent.sharedOnNeteaseCloudMusic'))}
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
            <Headphones size={13} /> {t('messageContent.previewLocally')}
          </button>
          <button type="button" onClick={() => onRecommend(playableSong)}>
            <ListPlus size={13} /> {t('messageContent.recommendToRoom')}
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
        <Overlay title={t('messageContent.songActions')} onClose={() => setSongChoice(null)}>
          <p className="overlay-intro">
            {songChoice.name}
            {songChoice.artist ? ` · ${songChoice.artist}` : ''}
          </p>
          <p className="overlay-intro">{t('messageContent.playAPreviewOnThisDeviceWhileThe')}</p>
          <div className="row-actions">
            <button
              className="secondary"
              onClick={() => {
                setSongChoice(null)
                onAudition(songChoice)
              }}
            >
              {t('common.preview')}
            </button>
            <button
              className="primary"
              onClick={() => {
                setSongChoice(null)
                onSong(songChoice)
              }}
            >
              {t('messageContent.recommend')}
            </button>
          </div>
        </Overlay>
      )}
    </div>
  )
}

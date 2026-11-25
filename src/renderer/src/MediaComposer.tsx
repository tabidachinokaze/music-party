import { ui } from '../../shared/ui-language'
import { useSurfaceActive } from './windows/Surface'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ImagePlus, Mic, Paperclip, Square, Video } from 'lucide-react'
import {
  MEDIA_LIMITS,
  type MediaFile,
  type MediaKind,
  type MediaProgress,
  type MediaReceipt,
  type MediaTarget,
} from '../../shared/media'
import { ComposerPanel } from './ComposerPanel'
import { clipboardImage } from './clipboard-image'
import { imageFormat } from '../../shared/image-format'
import { startRecording } from './recording'
import { mediaDrafts, type MediaDraftEntry } from './media-drafts'
import { rememberSticker, stickersChanged } from './sticker-cache'
type Draft = MediaDraftEntry & { url: string }
async function inspect(file: File, kind: MediaKind): Promise<MediaFile> {
  if (file.size > MEDIA_LIMITS[kind])
    throw new Error(
      ui(
        '文件不能超过 {0} MB',
        'The file must be {0} MB or smaller',
        MEDIA_LIMITS[kind] / 1024 / 1024,
      ),
    )
  const data = new Uint8Array(await file.arrayBuffer()),
    value: MediaFile = {
      data,
      kind,
      name: file.name,
      mime: file.type || 'application/octet-stream',
    }
  if (kind === 'image') {
    const format = imageFormat(data)
    if (!format)
      throw new Error(
        ui('请选择 PNG、JPEG、GIF 或 WebP 图片', 'Choose a PNG, JPEG, GIF, or WebP image'),
      )
    value.mime = format.mime
    if (!file.name || !/\.[a-z0-9]+$/i.test(file.name)) value.name = `clipboard.${format.extension}`
  }
  const url = URL.createObjectURL(new Blob([data], { type: value.mime }))
  try {
    if (kind === 'image') {
      const img = new Image()
      img.src = url
      await img.decode()
      value.width = img.naturalWidth
      value.height = img.naturalHeight
    } else if (kind === 'video') {
      if (file.type !== 'video/mp4') throw new Error(ui('请选择 MP4 视频', 'Choose an MP4 video'))
      const video = document.createElement('video')
      video.preload = 'auto'
      video.muted = true
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup()
            reject(new Error(ui('读取视频超时', 'Video loading timed out')))
          }, 15000)
          const cleanup = () => {
            clearTimeout(timer)
            video.onloadeddata = null
            video.onerror = null
          }
          video.onloadeddata = () => {
            cleanup()
            resolve()
          }
          video.onerror = () => {
            cleanup()
            reject(
              new Error(
                ui(
                  '无法读取此视频，请使用可播放的 MP4 文件',
                  'Couldn’t read this video. Choose a playable MP4 file.',
                ),
              ),
            )
          }
          video.src = url
        })
        value.width = video.videoWidth
        value.height = video.videoHeight
        value.duration = Math.round(video.duration * 1000)
        const canvas = document.createElement('canvas')
        canvas.width = Math.min(512, video.videoWidth)
        canvas.height = Math.max(
          1,
          Math.round((canvas.width * video.videoHeight) / video.videoWidth),
        )
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
        const cover = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.8),
        )
        if (cover) value.cover = new Uint8Array(await cover.arrayBuffer())
      } finally {
        video.removeAttribute('src')
        video.load()
      }
    }
    return value
  } finally {
    URL.revokeObjectURL(url)
  }
}
export function MediaComposer({
  target,
  label,
  disabled,
  onSent,
  onMediaPlay,
  accountKey,
}: {
  target: MediaTarget
  label: string
  disabled?: boolean
  onSent(receipt: MediaReceipt, target: MediaTarget): void
  onMediaPlay(): void
  accountKey?: string
}) {
  const active = useSurfaceActive()
  const input = useRef<HTMLInputElement>(null),
    kind = useRef<MediaKind>('image')
  const trigger = useRef<HTMLButtonElement>(null)
  const previewElement = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null),
    [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<MediaProgress | null>(null),
    [uncertain, setUncertain] = useState(false),
    [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0)
  const recorder = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null),
    preparingRecord = useRef(false),
    request = useRef(''),
    epoch = useRef(0),
    selection = useRef(0)
  const selected = useRef({ target, label, onSent })
  selected.current = { target, label, onSent }
  const scope = JSON.stringify([accountKey, target])
  const persisted = useSyncExternalStore(
    mediaDrafts.subscribe,
    () => mediaDrafts.get(accountKey, target),
    () => null,
  )
  const savingSticker = target.kind === 'sticker'
  useEffect(() => {
    const players = [
      ...(previewElement.current?.querySelectorAll<HTMLMediaElement>('audio,video') || []),
    ]
    return () => players.forEach((player) => player.pause())
  }, [open, draft])
  useEffect(
    () =>
      window.together.onMediaProgress((event) => {
        const current = mediaDrafts.get(accountKey, target)
        if (current?.requestId === event.requestId)
          mediaDrafts.update(accountKey, target, current.id, { progress: event }, event.requestId)
      }),
    [scope],
  )
  useEffect(() => {
    epoch.current++
    selection.current++
    setOpen(false)
    setDraft(null)
    setError('')
    setRecording(false)
    setBusy(false)
    setProgress(null)
    return () => {
      epoch.current++
      selection.current++
      recorder.current?.cancel()
      recorder.current = null
      preparingRecord.current = false
      if (request.current) {
        const pending = mediaDrafts.get(accountKey, target)
        if (pending?.requestId === request.current)
          mediaDrafts.update(
            accountKey,
            target,
            pending.id,
            {
              uncertain: true,
              error: ui('附件操作尚未确认，正在等待结果', 'Waiting for attachment confirmation'),
            },
            request.current,
          )
        window.together.cancelMedia(request.current).catch(() => {})
      }
      request.current = ''
    }
  }, [scope])
  useEffect(() => {
    if (!persisted) {
      setDraft(null)
      return
    }
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(persisted.file.data)], { type: persisted.file.mime }),
    )
    setDraft({ ...persisted, url })
    return () => URL.revokeObjectURL(url)
  }, [scope, persisted?.id])
  useEffect(() => {
    setError(persisted?.error || '')
    setUncertain(persisted?.uncertain || false)
    setBusy(!!persisted?.requestId)
    setProgress(persisted?.progress || null)
  }, [persisted])
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])
  useEffect(() => {
    const stop = () => {
      if (!recorder.current && !preparingRecord.current) return
      selection.current++
      preparingRecord.current = false
      recorder.current?.cancel()
      recorder.current = null
      setRecording(false)
      setBusy(false)
      setError(ui('录音已取消', 'Recording canceled'))
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') stop()
    }
    const cleanup = window.together.onLifecycle((state) => {
      if (state === 'suspend') stop()
    })
    document.addEventListener('visibilitychange', visibility)
    return () => {
      cleanup()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  useEffect(() => {
    if (recording && seconds >= 60) finishRecording()
  }, [seconds, recording])
  function stage(file: MediaFile, captured = selected.current) {
    if (
      !mediaDrafts.remember(accountKey, {
        id: crypto.randomUUID(),
        file,
        target: captured.target,
        label: captured.label,
        error: '',
        uncertain: false,
        requestId: '',
        progress: null,
      })
    ) {
      setError(
        ui(
          '附件草稿暂时无法保留，请稍后重试或更换附件',
          'Couldn’t save the attachment draft. Try again or choose a different file.',
        ),
      )
      setOpen(true)
      return
    }
    setProgress(null)
    setError('')
    setUncertain(false)
    setOpen(true)
  }
  async function prepare(file: File, mediaKind: MediaKind) {
    if (request.current || disabled || recording || preparingRecord.current) return
    const run = ++selection.current,
      captured = selected.current
    setError('')
    setProgress(null)
    setBusy(true)
    try {
      const result = await inspect(file, mediaKind)
      if (run === selection.current) stage(result, captured)
    } catch (error: any) {
      if (run === selection.current) {
        setError(error.message)
        setOpen(true)
      }
    } finally {
      if (run === selection.current) setBusy(false)
    }
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const form = input.current?.closest('form')
      if (
        savingSticker ||
        disabled ||
        busy ||
        recording ||
        !form ||
        !form.getClientRects().length ||
        !(event.target && 'nodeType' in event.target) ||
        !form.contains(event.target as Node) ||
        form.closest('[inert], [hidden]') ||
        document.querySelector('.modal-backdrop')
      )
        return
      const file = clipboardImage(event.clipboardData)
      if (!file) return
      event.preventDefault()
      void prepare(file, 'image')
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  }, [scope, disabled, busy, recording, savingSticker])
  function pick(value: MediaKind) {
    kind.current = value
    if (input.current) {
      input.current.accept =
        value === 'image'
          ? 'image/png,image/jpeg,image/gif,image/webp'
          : value === 'video'
            ? 'video/mp4'
            : '*/*'
      input.current.click()
    }
  }
  async function record() {
    if (preparingRecord.current || recorder.current || request.current) return
    preparingRecord.current = true
    onMediaPlay()
    setError('')
    const run = ++selection.current,
      captured = selected.current
    setOpen(true)
    setBusy(true)
    try {
      const rec = await startRecording()
      if (run !== selection.current) {
        rec.cancel()
        return
      }
      recorder.current = rec
      setSeconds(0)
      setRecording(true)
      selected.current = { ...selected.current, target: captured.target, label: captured.label }
    } catch (error: any) {
      if (run === selection.current)
        setError(
          error.name === 'NotAllowedError'
            ? ui(
                '麦克风权限未开启，请在系统设置中允许后重试',
                'Allow microphone access in system settings and try again.',
              )
            : error.message,
        )
    } finally {
      if (run === selection.current) {
        setBusy(false)
        preparingRecord.current = false
      }
    }
  }
  function finishRecording() {
    const result = recorder.current?.finish()
    recorder.current = null
    setRecording(false)
    if (!result) return
    if (result.duration < 300) {
      setError(ui('录音太短，请重新录制', 'Recording too short. Record again.'))
      return
    }
    stage({
      kind: 'voice',
      name: ui('录音-{0}.wav', 'Recording-{0}.wav', Date.now()),
      mime: 'audio/wav',
      data: result.data,
      duration: result.duration,
    })
  }
  useEffect(() => {
    if (!active) close()
  }, [active])
  function close() {
    preparingRecord.current = false
    if (!request.current && !mediaDrafts.get(accountKey, target)?.requestId) setBusy(false)
    selection.current++
    recorder.current?.cancel()
    recorder.current = null
    setRecording(false)
    setOpen(false)
  }
  async function send() {
    if (!draft || busy || request.current) return
    const run = epoch.current,
      chosen = draft,
      account = accountKey
    const requestId = crypto.randomUUID()
    if (!mediaDrafts.begin(account, chosen.target, chosen.id, requestId)) return
    request.current = requestId
    setBusy(true)
    setError('')
    setUncertain(false)
    setProgress({ requestId, phase: 'uploading', percent: 0 })
    try {
      const reply = await window.together.sendMedia({
        requestId,
        target: chosen.target,
        file: chosen.file,
      })
      if (!reply.ok || !reply.receipt) {
        mediaDrafts.update(
          account,
          chosen.target,
          chosen.id,
          {
            requestId: '',
            error: reply.error || ui('附件发送失败', 'Couldn’t send the attachment'),
            uncertain: reply.deliveryUnknown === true,
            progress: null,
          },
          requestId,
        )
        return
      }
      const accepted = mediaDrafts.remove(account, chosen.target, chosen.id, requestId)
      if (
        accepted &&
        chosen.target.kind === 'sticker' &&
        reply.receipt.emoji &&
        reply.receipt.senderUid === account
      ) {
        rememberSticker(account, reply.receipt.emoji)
        stickersChanged(account)
      }
      if (!accepted || run !== epoch.current) return
      selected.current.onSent(reply.receipt, chosen.target)
      setOpen(false)
      setProgress(null)
    } catch (error: any) {
      const message = error.message || ui('附件操作未确认', 'Attachment unconfirmed')
      mediaDrafts.update(
        account,
        chosen.target,
        chosen.id,
        {
          requestId: '',
          error: message,
          uncertain: true,
          progress: null,
        },
        requestId,
      )
      if (run === epoch.current) setError(message)
    } finally {
      if (run === epoch.current) {
        setBusy(false)
      }
      if (request.current === requestId) request.current = ''
    }
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        className="attachment-input"
        aria-label={ui('选择聊天附件', 'Choose an attachment')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void prepare(file, kind.current)
        }}
      />
      <button
        ref={trigger}
        type="button"
        className={savingSticker ? 'icon-btn sticker-upload' : 'icon-btn'}
        aria-label={
          savingSticker
            ? ui('上传自定义表情', 'Upload custom sticker')
            : ui('发送图片或表情包', 'Send an image or sticker')
        }
        title={
          savingSticker
            ? ui('上传到网易云自定义表情', 'Upload to NetEase custom stickers')
            : ui('图片 / GIF 表情包', 'Image / GIF sticker')
        }
        disabled={disabled || busy || recording}
        onClick={() => pick('image')}
      >
        <ImagePlus size={18} />
        {savingSticker && <span>{ui('上传表情', 'Upload sticker')}</span>}
      </button>
      {target.kind === 'private' && (
        <>
          <button
            type="button"
            className="icon-btn"
            aria-label={ui('录制语音', 'Record voice message')}
            disabled={disabled || busy || recording}
            onClick={record}
          >
            <Mic size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={ui('发送视频', 'Send video')}
            disabled={disabled || busy || recording}
            onClick={() => pick('video')}
          >
            <Video size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={ui('发送本地文件', 'Send file')}
            disabled={disabled || busy || recording}
            onClick={() => pick('file')}
          >
            <Paperclip size={18} />
          </button>
        </>
      )}
      {!open && (draft || busy || error) && (
        <button
          type="button"
          className="text-btn attachment-status"
          title={ui('查看附件详情', 'View attachment details')}
          onClick={() => setOpen(true)}
        >
          {busy
            ? ui('附件上传中…', 'Uploading attachment…')
            : draft
              ? savingSticker
                ? ui('待上传表情', 'Sticker ready to upload')
                : ui('待发送附件', 'Attachment ready to send')
              : ui('附件提示', 'Attachment status')}
        </button>
      )}
      {open && active && (
        <ComposerPanel
          title={
            recording
              ? ui('录制语音', 'Record voice message')
              : savingSticker
                ? ui('上传自定义表情', 'Upload custom sticker')
                : ui('发送附件', 'Send attachment')
          }
          onClose={close}
          anchor={trigger.current}
          actions={
            recording ? (
              <>
                <button className="primary" onClick={finishRecording}>
                  <Square size={14} />
                  {ui('停止录音并预览', 'Stop and preview')}
                </button>
                <button className="text-btn" onClick={close}>
                  {ui('取消录音', 'Cancel recording')}
                </button>
              </>
            ) : (
              draft && (
                <>
                  {busy && progress?.phase === 'uploading' ? (
                    <button
                      className="secondary"
                      onClick={() => {
                        const current = mediaDrafts.get(accountKey, target)
                        if (current?.requestId)
                          window.together.cancelMedia(current.requestId).catch(() => {})
                      }}
                    >
                      {ui('取消上传', 'Cancel upload')}
                    </button>
                  ) : (
                    <button className="secondary" onClick={close}>
                      {savingSticker
                        ? ui('稍后上传', 'Upload later')
                        : ui('稍后发送', 'Send later')}
                    </button>
                  )}
                  {!busy && (
                    <button
                      className="text-btn"
                      onClick={() => {
                        mediaDrafts.remove(accountKey, target, draft.id)
                        setOpen(false)
                      }}
                    >
                      {ui('移除附件', 'Remove attachment')}
                    </button>
                  )}
                  <button className="primary" disabled={busy} onClick={send}>
                    {savingSticker
                      ? uncertain
                        ? ui('已确认未保存，重新上传', 'I checked it wasn’t saved. Upload again.')
                        : error
                          ? ui('重试上传表情', 'Retry sticker upload')
                          : ui('确认上传表情', 'Upload sticker')
                      : uncertain
                        ? ui('已确认未收到，重新发送', 'I checked it wasn’t received. Send again.')
                        : error
                          ? ui('重试发送附件', 'Retry sending attachment')
                          : ui('确认发送附件', 'Send attachment')}
                  </button>
                </>
              )
            )
          }
        >
          <p className="overlay-intro">
            {savingSticker
              ? ui('保存到网易云账号的自定义表情包', 'Save to your NetEase custom stickers')
              : ui('发送给：', 'Send to: ') + (draft?.label || label)}
          </p>
          {recording ? (
            <div className="recording-panel">
              <span className="recording-dot" />
              <strong>{ui('{0} / 60 秒', '{0} / 60 s', seconds)}</strong>
            </div>
          ) : draft ? (
            <>
              <div className="attachment-preview" ref={previewElement}>
                {draft.file.kind === 'image' ? (
                  <img src={draft.url} alt={ui('待发送图片', 'Image to send')} />
                ) : draft.file.kind === 'voice' ? (
                  <audio
                    controls
                    onPlay={onMediaPlay}
                    src={draft.url}
                    aria-label={ui('录音预览', 'Recording preview')}
                  />
                ) : draft.file.kind === 'video' ? (
                  <video
                    controls
                    onPlay={onMediaPlay}
                    preload="metadata"
                    src={draft.url}
                    aria-label={ui('视频预览', 'Video preview')}
                  />
                ) : (
                  <Paperclip size={30} />
                )}
                <strong>{draft.file.name}</strong>
                <small>{(draft.file.data.byteLength / 1024 / 1024).toFixed(2)} MB</small>
              </div>
              {draft.file.kind === 'file' && (
                <p className="attachment-note">
                  {ui(
                    '文件将上传至网易云存储，并通过私信发送下载链接。',
                    'The file will be uploaded to NetEase storage and a download link sent by direct message.',
                  )}
                </p>
              )}
              {progress && (
                <div className="attachment-progress">
                  <progress max={100} value={progress.percent} />
                  <span>
                    {progress.phase === 'sending'
                      ? savingSticker
                        ? ui('正在保存表情…', 'Saving sticker…')
                        : ui('正在发送…', 'Sending…')
                      : ui('正在上传 {0}%', 'Uploading {0}%', progress.percent)}
                  </span>
                </div>
              )}
            </>
          ) : busy ? (
            <p>{ui('正在准备麦克风或附件…', 'Preparing microphone or attachment…')}</p>
          ) : null}
          {error && (
            <p className="private-error" role="alert">
              {error}
              {uncertain
                ? savingSticker
                  ? ui(
                      '；请先刷新自定义表情，确认未保存后再试。',
                      '. Refresh your custom stickers and check before uploading again.',
                    )
                  : ui(
                      '；请先刷新会话，确认对方未收到后再重发。',
                      '. Refresh the conversation and check before sending again.',
                    )
                : ''}
            </p>
          )}
        </ComposerPanel>
      )}
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Mic, Paperclip, Square, Video } from 'lucide-react'
import {
  MEDIA_LIMITS,
  type MediaFile,
  type MediaKind,
  type MediaProgress,
  type MediaReceipt,
  type MediaTarget,
} from '../../shared/media'
import { Overlay } from './player/Overlay'
import { startRecording } from './recording'
type Draft = { file: MediaFile; url: string; target: MediaTarget; label: string }
async function inspect(file: File, kind: MediaKind): Promise<MediaFile> {
  if (file.size > MEDIA_LIMITS[kind])
    throw new Error(`文件不能超过 ${MEDIA_LIMITS[kind] / 1024 / 1024} MB`)
  const data = new Uint8Array(await file.arrayBuffer()),
    value: MediaFile = {
      data,
      kind,
      name: file.name,
      mime: file.type || 'application/octet-stream',
    }
  const url = URL.createObjectURL(file)
  try {
    if (kind === 'image') {
      const img = new Image()
      img.src = url
      await img.decode()
      value.width = img.naturalWidth
      value.height = img.naturalHeight
    } else if (kind === 'video') {
      if (file.type !== 'video/mp4') throw new Error('请选择 MP4 视频')
      const video = document.createElement('video')
      video.preload = 'auto'
      video.muted = true
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup()
            reject(new Error('读取视频超时'))
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
            reject(new Error('无法读取此视频，请使用可播放的 MP4 文件'))
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
}: {
  target: MediaTarget
  label: string
  disabled?: boolean
  onSent(receipt: MediaReceipt, target: MediaTarget): void
  onMediaPlay(): void
}) {
  const input = useRef<HTMLInputElement>(null),
    kind = useRef<MediaKind>('image')
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
  const scope = JSON.stringify(target)
  useEffect(() => {
    const players = [
      ...(previewElement.current?.querySelectorAll<HTMLMediaElement>('audio,video') || []),
    ]
    return () => players.forEach((player) => player.pause())
  }, [open, draft])
  useEffect(
    () =>
      window.together.onMediaProgress((event) => {
        if (event.requestId === request.current) setProgress(event)
      }),
    [],
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
      if (request.current) window.together.cancelMedia(request.current).catch(() => {})
      request.current = ''
    }
  }, [scope])
  useEffect(
    () => () => {
      if (draft) URL.revokeObjectURL(draft.url)
    },
    [draft],
  )
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
      setError('录音已取消')
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
    setDraft({
      file,
      url: URL.createObjectURL(new Blob([new Uint8Array(file.data)], { type: file.mime })),
      target: captured.target,
      label: captured.label,
    })
    setProgress(null)
    setError('')
    setUncertain(false)
    setOpen(true)
  }
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
    setDraft(null)
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
            ? '麦克风权限未开启，请在系统设置中允许后重试'
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
      setError('录音太短，请重新录制')
      return
    }
    stage({
      kind: 'voice',
      name: `录音-${Date.now()}.wav`,
      mime: 'audio/wav',
      data: result.data,
      duration: result.duration,
    })
  }
  function close() {
    preparingRecord.current = false
    if (!request.current) setBusy(false)
    selection.current++
    recorder.current?.cancel()
    recorder.current = null
    setRecording(false)
    setOpen(false)
  }
  async function send() {
    if (!draft || busy || request.current) return
    const run = epoch.current,
      chosen = draft
    const requestId = crypto.randomUUID()
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
      if (run !== epoch.current) return
      if (!reply.ok || !reply.receipt) {
        setUncertain(reply.deliveryUnknown === true)
        throw new Error(reply.error || '附件发送失败')
      }
      selected.current.onSent(reply.receipt, chosen.target)
      setDraft(null)
      setOpen(false)
      setProgress(null)
    } catch (error: any) {
      if (run === epoch.current) setError(error.message)
    } finally {
      if (run === epoch.current) {
        setBusy(false)
        request.current = ''
      }
    }
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        className="attachment-input"
        aria-label="选择聊天附件"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (request.current) return
          const run = ++selection.current,
            captured = selected.current
          setError('')
          setDraft(null)
          setProgress(null)
          setUncertain(false)
          setBusy(true)
          try {
            const result = await inspect(file, kind.current)
            if (run === selection.current) stage(result, captured)
          } catch (error: any) {
            if (run === selection.current) {
              setError(error.message)
              setOpen(true)
            }
          } finally {
            if (run === selection.current) setBusy(false)
          }
        }}
      />
      <button
        type="button"
        className="icon-btn"
        aria-label="发送图片或表情包"
        title="图片 / GIF 表情包"
        disabled={disabled || busy || recording}
        onClick={() => pick('image')}
      >
        <ImagePlus size={18} />
      </button>
      {target.kind === 'private' && (
        <>
          <button
            type="button"
            className="icon-btn"
            aria-label="录制语音"
            disabled={disabled || busy || recording}
            onClick={record}
          >
            <Mic size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="发送视频"
            disabled={disabled || busy || recording}
            onClick={() => pick('video')}
          >
            <Video size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="发送本地文件"
            disabled={disabled || busy || recording}
            onClick={() => pick('file')}
          >
            <Paperclip size={18} />
          </button>
        </>
      )}
      {!open && (draft || busy || error) && (
        <button type="button" className="text-btn attachment-status" onClick={() => setOpen(true)}>
          {busy ? '附件上传中…' : draft ? '待发送附件' : '附件提示'}
        </button>
      )}
      {open && (
        <Overlay title={recording ? '录制语音' : '发送附件'} onClose={close}>
          <p className="overlay-intro">发送给：{draft?.label || label}</p>
          {recording ? (
            <div className="recording-panel">
              <span className="recording-dot" />
              <strong>{seconds} / 60 秒</strong>
              <button className="primary" onClick={finishRecording}>
                <Square size={14} />
                停止录音并预览
              </button>
              <button className="text-btn" onClick={close}>
                取消录音
              </button>
            </div>
          ) : draft ? (
            <>
              <div className="attachment-preview" ref={previewElement}>
                {draft.file.kind === 'image' ? (
                  <img src={draft.url} alt="待发送图片" />
                ) : draft.file.kind === 'voice' ? (
                  <audio controls onPlay={onMediaPlay} src={draft.url} aria-label="录音预览" />
                ) : draft.file.kind === 'video' ? (
                  <video
                    controls
                    onPlay={onMediaPlay}
                    preload="metadata"
                    src={draft.url}
                    aria-label="视频预览"
                  />
                ) : (
                  <Paperclip size={30} />
                )}
                <strong>{draft.file.name}</strong>
                <small>{(draft.file.data.byteLength / 1024 / 1024).toFixed(2)} MB</small>
              </div>
              {draft.file.kind === 'file' && (
                <p className="attachment-note">文件将上传至网易云存储，并通过私信发送下载链接。</p>
              )}
              {progress && (
                <div className="attachment-progress">
                  <progress max={100} value={progress.percent} />
                  <span>
                    {progress.phase === 'sending' ? '正在发送…' : `正在上传 ${progress.percent}%`}
                  </span>
                </div>
              )}
              <div className="row-actions">
                {busy && progress?.phase === 'uploading' ? (
                  <button
                    className="secondary"
                    onClick={() => window.together.cancelMedia(request.current)}
                  >
                    取消上传
                  </button>
                ) : (
                  <button className="secondary" onClick={close}>
                    稍后发送
                  </button>
                )}
                <button className="primary" disabled={busy} onClick={send}>
                  {uncertain ? '已确认未收到，重新发送' : error ? '重试发送附件' : '确认发送附件'}
                </button>
              </div>
            </>
          ) : busy ? (
            <p>正在准备麦克风或附件…</p>
          ) : null}
          {error && (
            <p className="private-error" role="alert">
              {error}
              {uncertain ? '；请先刷新会话，确认对方未收到后再重发。' : ''}
            </p>
          )}
        </Overlay>
      )}
    </>
  )
}

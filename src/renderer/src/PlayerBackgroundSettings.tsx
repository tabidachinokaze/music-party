import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Image, LoaderCircle, Music2, Play, RotateCcw, Search } from 'lucide-react'
import type { Song } from '../../shared/types'
import { DEFAULT_PREFERENCES } from '../../shared/desktop'
import type { useDesktop } from './useDesktop'
import { Overlay } from './player/Overlay'
import { PlayerBackground, type PlayerBackgroundValues } from './PlayerBackground'
import { importPlayerBackground } from './background-import'

const clamp = (value: number) => Math.max(0, Math.min(100, value))
export function PlayerBackgroundSettings({
  desktop,
  song,
  onClose,
}: {
  desktop: ReturnType<typeof useDesktop>
  song: Song | null
  onClose(): void
}) {
  const [draft, setDraft] = useState<PlayerBackgroundValues>({
    ...desktop.info!.preferences.playerBackground,
  })
  const [failure, setFailure] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [saving, setSaving] = useState(false)
  const generation = useRef(0)
  const saveLock = useRef(false)
  const drag = useRef<{
    pointer: number
    x: number
    y: number
    positionX: number
    positionY: number
    overflowX: number
    overflowY: number
  } | null>(null)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  async function choose(file: File | undefined) {
    if (!file) return
    const run = ++generation.current
    setFailure('')
    setPreparing(true)
    try {
      const prepared = await importPlayerBackground(file)
      if (run === generation.current)
        setDraft((previous) => ({ ...previous, image: prepared.image, x: 50, y: 50 }))
    } catch (error: any) {
      if (run === generation.current) setFailure(error.message || '图片读取失败，请重新选择')
    } finally {
      if (run === generation.current) setPreparing(false)
    }
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!draft.image || preparing || saving || event.button !== 0) return
    const image = event.currentTarget.querySelector<HTMLImageElement>(
      '.player-background-layer img',
    )
    if (!image?.naturalWidth || !image.naturalHeight) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const scale =
      Math.max(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight) *
      (draft.zoom / 100)
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      positionX: draft.x,
      positionY: draft.y,
      overflowX: image.naturalWidth * scale - bounds.width,
      overflowY: image.naturalHeight * scale - bounds.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.pointer !== event.pointerId) return
    setDraft((previous) => ({
      ...previous,
      x:
        start.overflowX > 1
          ? clamp(start.positionX - ((event.clientX - start.x) / start.overflowX) * 100)
          : previous.x,
      y:
        start.overflowY > 1
          ? clamp(start.positionY - ((event.clientY - start.y) / start.overflowY) * 100)
          : previous.y,
    }))
  }
  async function save() {
    if (preparing || saveLock.current) return
    saveLock.current = true
    const run = generation.current
    setSaving(true)
    setFailure('')
    const success = await desktop.update({ playerBackground: { ...draft } })
    if (run !== generation.current) return
    if (success) onClose()
    else {
      setFailure('背景未保存，请重试。')
      setSaving(false)
      saveLock.current = false
    }
  }
  const busy = preparing || saving
  function slider(
    key: 'zoom' | 'opacity' | 'blur' | 'x' | 'y',
    label: string,
    min: number,
    max: number,
    unit = '%',
  ) {
    const value = key === 'opacity' ? 100 - draft.opacity : draft[key]
    return (
      <label className="background-setting-slider">
        <span>{label}</span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={busy || !draft.image}
          onChange={(event) => {
            const next = Number(event.target.value)
            setDraft((previous) => ({ ...previous, [key]: key === 'opacity' ? 100 - next : next }))
          }}
        />
        <output>
          {Math.round(value)}
          {unit}
        </output>
      </label>
    )
  }
  return (
    <Overlay title="自定义播放器背景" wide onClose={onClose}>
      <div className="player-background-editor">
        <div
          className={`background-preview ${draft.image ? 'has-image' : ''}`}
          role="group"
          aria-label="背景位置预览"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <PlayerBackground background={draft} />
          <div className="background-preview-app">
            <aside className="background-preview-sidebar">
              <strong>Music Party</strong>
              <span>正在播放</span>
              <span>我的歌单</span>
              <span>私信</span>
            </aside>
            <div className="background-preview-workspace">
              <div className="background-preview-header">
                <span>正在播放</span>
                <Search size={11} />
              </div>
              <div className="background-preview-main">
                <div className="background-preview-copy">
                  <div className="background-preview-cover">
                    {song?.cover ? <img src={song.cover} alt="" /> : <Music2 size={24} />}
                  </div>
                  <strong>{song?.name || 'Music Party'}</strong>
                  <span>{song?.artist || '让音乐陪伴此刻'}</span>
                </div>
                <div className="background-preview-lyrics">
                  <span>歌词</span>
                  <strong>让音乐陪伴此刻</strong>
                  <span>清晰的文字与控件</span>
                </div>
              </div>
            </div>
            <div className="background-preview-footer">
              <span>{song?.name || 'Music Party'}</span>
              <Play size={12} />
            </div>
          </div>
        </div>
        <p className="background-preview-hint">
          {draft.image
            ? '拖动预览图片调整位置，保存后应用到整个播放器。'
            : '默认使用播放器主题背景。'}
        </p>
        <label className={`background-image-picker secondary ${busy ? 'disabled' : ''}`}>
          {preparing ? <LoaderCircle size={16} className="spin" /> : <Image size={16} />}
          {preparing ? '正在读取图片…' : draft.image ? '更换图片' : '选择本地图片'}
          <input
            aria-label="选择播放器背景图片"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void choose(file)
            }}
          />
        </label>
        {failure && (
          <div className="alert error" role="alert">
            {desktop.error || failure}
          </div>
        )}
        <div className="background-setting-controls">
          {slider('zoom', '背景缩放', 100, 300)}
          {slider('opacity', '背景透明度', 0, 100)}
          {slider('blur', '背景模糊', 0, 30, ' px')}
          {slider('x', '背景水平位置', 0, 100)}
          {slider('y', '背景垂直位置', 0, 100)}
        </div>
        <div className="background-editor-reset">
          <button
            className="text-btn"
            disabled={busy || !draft.image}
            onClick={() => setDraft((previous) => ({ ...previous, x: 50, y: 50 }))}
          >
            <RotateCcw size={14} />
            重置位置
          </button>
          <button
            className="text-btn"
            disabled={busy}
            onClick={() => {
              setDraft({ ...DEFAULT_PREFERENCES.playerBackground })
              setFailure('')
            }}
          >
            恢复默认背景
          </button>
        </div>
        <div className="background-editor-actions">
          <button className="secondary" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {saving && <LoaderCircle size={15} className="spin" />}
            {saving ? '正在保存…' : '保存背景'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

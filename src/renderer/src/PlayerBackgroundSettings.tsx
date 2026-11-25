import { ui } from '../../shared/ui-language'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react'
import { Crosshair, Disc3, Image, LoaderCircle, RotateCcw } from 'lucide-react'
import type { Song } from '../../shared/types'
import { DEFAULT_PREFERENCES } from '../../shared/desktop'
import type { useDesktop } from './useDesktop'
import { Overlay } from './player/Overlay'
import { PlayerBackground, type PlayerBackgroundValues } from './PlayerBackground'
import { importPlayerBackground } from './background-import'

const clamp = (value: number) => Math.max(0, Math.min(100, value))
const crops = [
  { label: ['当前窗口', 'Current window'], width: 0, height: 0 },
  { label: ['竖屏', 'Portrait'], width: 321, height: 682 },
  { label: ['中窗 740', 'Medium 740'], width: 740, height: 590 },
  { label: ['中窗 900', 'Medium 900'], width: 900, height: 722 },
  { label: ['宽窗', 'Wide'], width: 1159, height: 750 },
] as const

export function PlayerBackgroundSettings({
  desktop,
  song,
  onClose,
  onPreview,
}: {
  desktop: ReturnType<typeof useDesktop>
  song?: Song | null
  onClose(): void
  onPreview(values: PlayerBackgroundValues | null): void
}) {
  const [draft, setDraft] = useState<PlayerBackgroundValues>({
    ...desktop.info!.preferences.playerBackground,
  })
  // Interface fills are owned by Settings. A desktop preference update can
  // arrive while a wallpaper draft is open; preview and save the current fills.
  const { layoutTransparency, componentTransparency, popupTransparency } =
    desktop.info!.preferences.playerBackground
  const previewSkin = useMemo(
    () => ({ ...draft, layoutTransparency, componentTransparency, popupTransparency }),
    [draft, layoutTransparency, componentTransparency, popupTransparency],
  )
  const [crop, setCrop] = useState<(typeof crops)[number]>(crops[0])
  useLayoutEffect(() => {
    onPreview(previewSkin)
  }, [previewSkin, onPreview])
  useLayoutEffect(() => () => onPreview(null), [onPreview])
  const [showFocal, setShowFocal] = useState(false)
  const [failure, setFailure] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [saving, setSaving] = useState(false)
  const preview = useRef<HTMLDivElement>(null)
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
      if (run === generation.current)
        setFailure(
          error.message ||
            ui('图片读取失败，请重新选择', 'Could not read the image. Choose another file.'),
        )
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
    const success = await desktop.update({ playerBackground: previewSkin })
    if (run !== generation.current) return
    if (success) onClose()
    else {
      setFailure(ui('背景未保存，请重试。', 'Could not save the background. Try again.'))
      setSaving(false)
      saveLock.current = false
    }
  }
  const busy = preparing || saving
  const canAdjust = !!draft.image && !busy
  useEffect(() => {
    const node = preview.current
    if (!node || !canAdjust) return
    // A native non-passive listener keeps a wheel gesture over the image in the crop editor.
    function zoom(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || !event.deltaY) return
      event.preventDefault()
      const step = event.deltaY > 0 ? -5 : 5
      setDraft((previous) => ({
        ...previous,
        zoom: Math.min(300, Math.max(100, previous.zoom + step)),
      }))
    }
    node.addEventListener('wheel', zoom, { passive: false })
    return () => node.removeEventListener('wheel', zoom)
  }, [canAdjust])
  function slider(
    key: 'opacity' | 'blur' | 'zoom' | 'x' | 'y',
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
          aria-valuetext={Math.round(value) + unit}
          disabled={!canAdjust}
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
    <Overlay
      title={ui('自定义播放器背景', 'Customize player background')}
      wide
      dismissible={!saving}
      onClose={onClose}
    >
      <div className="player-background-editor">
        <div data-list-viewport="" className="background-editor-scroll">
          <div
            className="background-crops"
            role="group"
            aria-label={ui('预览画幅', 'Preview size')}
          >
            {crops.map((item) => (
              <button
                type="button"
                key={item.width}
                aria-pressed={item === crop}
                onClick={() => setCrop(item)}
              >
                {ui(item.label[0], item.label[1])}
              </button>
            ))}
            <button
              type="button"
              className="focal-toggle"
              aria-label={ui('显示焦点', 'Show focal point')}
              aria-pressed={showFocal}
              disabled={!draft.image}
              onClick={() => setShowFocal(!showFocal)}
              title={
                showFocal ? ui('隐藏焦点', 'Hide focal point') : ui('显示焦点', 'Show focal point')
              }
            >
              <Crosshair size={15} />
            </button>
          </div>
          <div className="background-editor-stage">
            <div
              className={`background-preview ${draft.image ? 'has-image' : ''}`}
              ref={preview}
              style={
                crop.width
                  ? ({
                      '--window-ratio': crop.width / crop.height,
                      '--skin-preview-width': `${crop.width}px`,
                    } as CSSProperties)
                  : undefined
              }
              role="group"
              aria-label={ui('背景位置预览', 'Background position preview')}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <PlayerBackground background={previewSkin} />
              {!draft.image && <Image aria-hidden="true" size={28} />}
              {draft.image && showFocal && (
                <span
                  className="background-focus"
                  style={{ left: draft.x + '%', top: draft.y + '%' }}
                  aria-hidden="true"
                >
                  <Crosshair size={16} />
                </span>
              )}
              {song && (
                <div className="background-preview-track" aria-hidden="true">
                  {song.cover ? <img alt="" src={song.cover} /> : <Disc3 size={16} />}
                  <span>
                    <strong>{song.name}</strong>
                    <small>{song.artist}</small>
                  </span>
                </div>
              )}
            </div>
          </div>
          <p className="background-preview-hint">
            {draft.image
              ? ui(
                  '焦点 ({0}%, {1}%) · 缩放 {2}% · 拖动调整焦点，滚轮缩放。',
                  'Focus ({0}%, {1}%) · Zoom {2}% · Drag to reposition. Scroll to zoom.',
                  Math.round(draft.x),
                  Math.round(draft.y),
                  draft.zoom,
                )
              : ui('默认使用播放器主题背景。', 'The player currently uses the theme background.')}
          </p>
          <div className="background-image-sources">
            <label
              title={
                draft.image
                  ? ui('更换图片', 'Change image')
                  : ui('选择本地图片', 'Choose local image')
              }
              className={`background-image-picker secondary ${busy ? 'disabled' : ''}`}
            >
              {preparing ? <LoaderCircle size={16} className="spin" /> : <Image size={16} />}
              {preparing
                ? ui('正在读取图片…', 'Reading image…')
                : draft.image
                  ? ui('更换图片', 'Change image')
                  : ui('选择本地图片', 'Choose local image')}
              <input
                aria-label={ui('选择播放器背景图片', 'Choose player background image')}
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
          </div>
          {failure && (
            <div className="alert error" role="alert">
              {desktop.error || failure}
            </div>
          )}
          <div className="background-setting-controls">
            {slider('opacity', ui('图片透明度', 'Image transparency'), 0, 100)}
            {slider('zoom', ui('背景缩放', 'Zoom'), 100, 300)}
            {slider('blur', ui('背景模糊', 'Blur'), 0, 30, ' px')}
            {slider('x', ui('背景水平位置', 'Horizontal position'), 0, 100)}
            {slider('y', ui('背景垂直位置', 'Vertical position'), 0, 100)}
          </div>
          <div className="background-editor-reset">
            <button
              className="text-btn"
              disabled={busy || !draft.image}
              onClick={() => setDraft((previous) => ({ ...previous, x: 50, y: 50 }))}
            >
              <RotateCcw size={14} />
              {ui('重置位置', 'Reset position')}
            </button>
            <button
              className="text-btn"
              disabled={busy}
              onClick={() => {
                setDraft((previous) => ({
                  ...DEFAULT_PREFERENCES.playerBackground,
                  layoutTransparency: previous.layoutTransparency,
                  componentTransparency: previous.componentTransparency,
                  popupTransparency: previous.popupTransparency,
                }))
                setFailure('')
              }}
            >
              {ui('恢复默认背景', 'Restore theme background')}
            </button>
          </div>
        </div>
        <div className="background-editor-actions">
          <button className="secondary" disabled={saving} onClick={onClose}>
            {ui('取消', 'Cancel')}
          </button>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {saving && <LoaderCircle size={15} className="spin" />}
            {saving ? ui('正在保存…', 'Saving…') : ui('保存背景', 'Save background')}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

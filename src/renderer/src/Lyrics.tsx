import { useEffect, useRef, useState } from 'react'
import { AlignLeft, LocateFixed } from 'lucide-react'
import { parseLyrics, type ApiCall, type LyricLine } from './music-data'
export function Lyrics({
  api,
  songId,
  position,
  seekable = false,
  onSeek,
  heading = false,
}: {
  api: ApiCall
  songId?: string
  position: number
  heading?: boolean
  seekable?: boolean
  onSeek?(position: number): void
}) {
  const [lines, setLines] = useState<LyricLine[]>([])
  const [translations, setTranslations] = useState(new Map<number, string>())
  const [message, setMessage] = useState('播放一首歌，让歌词在这里流动')
  const [follow, setFollow] = useState(true)
  const container = useRef<HTMLDivElement>(null)
  const [showTranslation, setShowTranslation] = useState(true)
  useEffect(() => {
    let active = true
    setLines([])
    setTranslations(new Map())
    setFollow(true)
    if (!songId) {
      setMessage('播放一首歌，让歌词在这里流动')
      return
    }
    setMessage('正在加载歌词…')
    api('lyrics', { id: songId })
      .then((body) => {
        if (!active) return
        const next = parseLyrics(body.lrc?.lyric || '')
        setLines(next)
        setTranslations(new Map(parseLyrics(body.tlyric?.lyric || '').map((l) => [l.time, l.text])))
        setMessage(next.length ? '' : body.nolyric ? '纯音乐，请欣赏' : '这首歌暂时没有歌词')
      })
      .catch(() => {
        if (active) setMessage('歌词暂时无法加载')
      })
    return () => {
      active = false
    }
  }, [songId])
  let activeIndex = -1
  for (let i = 0; i < lines.length && lines[i].time <= position; i++) activeIndex = i
  useEffect(() => {
    const box = container.current
    if (!box || !follow || !lines.length) return
    const center = (smooth: boolean) => {
      const line = box.querySelector<HTMLElement>('.lyric-active')
      const top = line
        ? box.scrollTop +
          line.getBoundingClientRect().top -
          box.getBoundingClientRect().top -
          (box.clientHeight - line.clientHeight) / 2
        : 0
      box.scrollTo({
        top,
        behavior:
          smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'smooth'
            : 'instant',
      })
    }
    center(true)
    let height = box.clientHeight,
      width = box.clientWidth
    const observer = new ResizeObserver(() => {
      if (box.clientHeight === height && box.clientWidth === width) return
      height = box.clientHeight
      width = box.clientWidth
      center(false)
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [activeIndex, follow, lines, showTranslation])
  return (
    <div className="lyrics-surface">
      {(heading || translations.size > 0) && (
        <div className="lyrics-toolbar">
          {heading && <h2>歌词</h2>}
          {translations.size > 0 && (
            <button
              className="translation-switch"
              type="button"
              aria-label="显示歌词翻译"
              aria-pressed={showTranslation}
              onClick={() => setShowTranslation((value) => !value)}
            >
              译
            </button>
          )}
        </div>
      )}
      <div
        className={`lyrics ${lines.length ? '' : 'lyrics-empty'}`}
        aria-label="当前歌曲歌词"
        ref={container}
        onWheel={() => setFollow(false)}
        onTouchMove={() => setFollow(false)}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key))
            setFollow(false)
        }}
      >
        {message ? (
          <div className="lyric-placeholder">
            <AlignLeft size={27} />
            <p>{message}</p>
          </div>
        ) : (
          <div className="lyric-lines">
            {lines.map((line, i) =>
              seekable && onSeek ? (
                <button
                  key={`${line.time}-${i}`}
                  aria-current={i === activeIndex ? 'true' : undefined}
                  className={`lyric-line ${i === activeIndex ? 'lyric-active' : ''}`}
                  aria-label={`跳转歌词：${line.text}`}
                  onClick={() => {
                    onSeek(line.time)
                    setFollow(true)
                  }}
                >
                  {line.text}
                  {showTranslation && translations.get(line.time) && (
                    <small className="lyric-translation">{translations.get(line.time)}</small>
                  )}
                </button>
              ) : (
                <p
                  key={`${line.time}-${i}`}
                  aria-current={i === activeIndex ? 'true' : undefined}
                  className={`lyric-line ${i === activeIndex ? 'lyric-active' : ''}`}
                >
                  {line.text}
                  {showTranslation && translations.get(line.time) && (
                    <small className="lyric-translation">{translations.get(line.time)}</small>
                  )}
                </p>
              ),
            )}
          </div>
        )}
      </div>
      {!follow && lines.length > 0 && (
        <button className="lyric-follow" onClick={() => setFollow(true)}>
          <LocateFixed size={14} />
          回到当前歌词
        </button>
      )}
    </div>
  )
}

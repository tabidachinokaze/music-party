import { useEffect, useRef, useState } from 'react'
import { AlignLeft, LocateFixed } from 'lucide-react'
import { parseLyrics, type ApiCall, type LyricLine } from './music-data'
export function Lyrics({
  api,
  songId,
  position,
  seekable = false,
  onSeek,
}: {
  api: ApiCall
  songId?: string
  position: number
  seekable?: boolean
  onSeek?(position: number): void
}) {
  const [lines, setLines] = useState<LyricLine[]>([])
  const [message, setMessage] = useState('播放一首歌，让歌词在这里流动')
  const [follow, setFollow] = useState(true)
  const container = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    let active = true
    setLines([])
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
    const box = container.current,
      line = activeRef.current
    if (!box || !line || !follow) return
    const top =
      box.scrollTop +
      line.getBoundingClientRect().top -
      box.getBoundingClientRect().top -
      box.clientHeight / 2 +
      line.clientHeight / 2
    box.scrollTo({
      top: Math.max(0, top),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    })
  }, [activeIndex, follow, lines])
  return (
    <div className="lyrics-surface">
      <div
        className={`lyrics ${lines.length ? '' : 'lyrics-empty'}`}
        aria-label="当前歌曲歌词"
        ref={container}
        onWheel={() => setFollow(false)}
        onTouchStart={() => setFollow(false)}
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
                  ref={(node) => {
                    if (i === activeIndex) activeRef.current = node
                  }}
                  className={`lyric-line ${i === activeIndex ? 'lyric-active' : ''}`}
                  aria-label={`跳转歌词：${line.text}`}
                  onClick={() => {
                    onSeek(line.time)
                    setFollow(true)
                  }}
                >
                  {line.text}
                </button>
              ) : (
                <p
                  key={`${line.time}-${i}`}
                  ref={(node) => {
                    if (i === activeIndex) activeRef.current = node
                  }}
                  className={`lyric-line ${i === activeIndex ? 'lyric-active' : ''}`}
                >
                  {line.text}
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

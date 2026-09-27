import { useEffect, useRef, useState } from 'react'
import { parseLyrics, type ApiCall, type LyricLine } from './music-data'
export function Lyrics({
  api,
  songId,
  position,
}: {
  api: ApiCall
  songId?: string
  position: number
}) {
  const [lines, setLines] = useState<LyricLine[]>([])
  const [message, setMessage] = useState('选择一首歌开始播放')
  const activeRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    let active = true
    setLines([])
    if (!songId) {
      setMessage('选择一首歌开始播放')
      return
    }
    setMessage('正在加载歌词…')
    api('lyrics', { id: songId })
      .then((body) => {
        if (!active) return
        const next = parseLyrics(body.lrc?.lyric || '')
        setLines(next)
        setMessage(next.length ? '' : body.nolyric ? '纯音乐，请欣赏' : '暂无歌词')
      })
      .catch((e) => {
        if (active) setMessage(e.message || '歌词暂不可用')
      })
    return () => {
      active = false
    }
  }, [songId])
  let activeIndex = -1
  for (let i = 0; i < lines.length && lines[i].time <= position; i++) activeIndex = i
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex])
  return (
    <div className="lyrics" aria-label="当前歌曲歌词">
      {message ? (
        <p className="muted">{message}</p>
      ) : (
        lines.map((line, i) => (
          <p
            key={`${line.time}-${i}`}
            ref={i === activeIndex ? activeRef : undefined}
            className={i === activeIndex ? 'lyric-active' : ''}
          >
            {line.text}
          </p>
        ))
      )}
    </div>
  )
}

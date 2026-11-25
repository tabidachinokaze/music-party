import { getUiLanguage, t } from '../../shared/ui-language'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { AudioLines, Languages, LoaderCircle, LocateFixed, RotateCcw } from 'lucide-react'
import { parseLyrics, type ApiCall, type LyricLine } from './music-data'

const lyricMessages = () => ({
  idle: t('lyrics.playATrackToSeeItsLyrics'),
  loading: t('lyrics.loadingLyrics'),
  instrumental: t('common.instrumental'),
  missing: t('common.lyricsAreUnavailableForThisTrack'),
  failed: t('lyrics.couldNotLoadLyrics'),
  ready: '',
})

type LyricStatus = keyof ReturnType<typeof lyricMessages>
interface LyricContent {
  songId?: string
  status: LyricStatus
  lines: LyricLine[]
  translations: Map<number, string>
}
const empty: LyricContent = { status: 'idle', lines: [], translations: new Map() }

export function useTrackLyrics(api: ApiCall, songId?: string) {
  const [content, setContent] = useState(empty)
  const [attempt, setAttempt] = useState(0)
  const [showTranslation, setShowTranslation] = useState(true)
  const request = useEffectEvent((id: string) => api('lyrics', { id }))
  useEffect(() => {
    if (!songId) return
    let active = true
    setContent({ ...empty, songId, status: 'loading' })
    request(songId)
      .then((body) => {
        if (!active) return
        const lines = parseLyrics(body.lrc?.lyric || '')
        setContent({
          songId,
          lines,
          status: lines.length ? 'ready' : body.nolyric ? 'instrumental' : 'missing',
          translations: new Map(
            parseLyrics(body.tlyric?.lyric || '').map((line) => [line.time, line.text]),
          ),
        })
      })
      .catch(() => {
        if (active) setContent({ ...empty, songId, status: 'failed' })
      })
    return () => {
      active = false
    }
  }, [songId, attempt])
  const value = !songId
    ? empty
    : content.songId === songId
      ? content
      : { ...empty, songId, status: 'loading' as const }
  return {
    ...value,
    showTranslation,
    toggleTranslation: () => setShowTranslation((value) => !value),
    retry: () => setAttempt((n) => n + 1),
  }
}

export function Lyrics({
  content: { lines, translations, status, songId, retry, showTranslation, toggleTranslation },
  activeIndex,
  seekable = false,
  onSeek,
  onRead,
}: {
  content: ReturnType<typeof useTrackLyrics>
  activeIndex: number
  seekable?: boolean
  onSeek?(position: number): void
  onRead(): void
}) {
  const [follow, setFollow] = useState(true)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => setFollow(true), [songId])
  function readManually() {
    onRead()
    setFollow(false)
  }
  const message = lyricMessages()[status]
  const lastLine = useRef<{ songId?: string; index: number } | null>(null)
  useLayoutEffect(() => {
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
    const previous = lastLine.current
    center(previous !== null && previous.songId === songId && activeIndex === previous.index + 1)
    lastLine.current = { songId, index: activeIndex }
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
  }, [activeIndex, follow, lines, showTranslation, songId])
  return (
    <div className="lyrics-surface">
      {translations.size > 0 && (
        <div className="lyrics-toolbar">
          <button
            className="translation-switch"
            type="button"
            aria-label={t('common.showLyricTranslation')}
            title={
              showTranslation ? t('common.hideLyricTranslation') : t('common.showLyricTranslation')
            }
            aria-pressed={showTranslation}
            onClick={() => {
              onRead()
              toggleTranslation()
            }}
          >
            {getUiLanguage() !== 'zh-CN' ? <Languages size={14} aria-hidden="true" /> : '译'}
          </button>
        </div>
      )}
      <div
        className={`lyrics ${lines.length ? '' : 'lyrics-empty'}`}
        aria-label={t('lyrics.currentTrackLyrics')}
        ref={container}
        onWheel={readManually}
        onTouchMove={readManually}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key))
            readManually()
        }}
      >
        {message ? (
          <div className="lyric-placeholder">
            {status === 'loading' ? (
              <LoaderCircle size={23} className="lyrics-loading-icon" />
            ) : (
              <AudioLines size={25} />
            )}

            <p role="status">{message}</p>
            {status === 'failed' && (
              <button className="text-btn" onClick={retry}>
                <RotateCcw size={13} /> {t('lyrics.retryLoadingLyrics')}
              </button>
            )}
          </div>
        ) : (
          <div className="lyric-lines">
            {lines.map((line, i) =>
              seekable && onSeek ? (
                <button
                  key={`${line.time}-${i}`}
                  aria-current={i === activeIndex ? 'true' : undefined}
                  className={`lyric-line ${i === activeIndex ? 'lyric-active' : ''}`}
                  aria-label={t('lyrics.seekToLyric', { text: line.text })}
                  onClick={() => {
                    onRead()
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
          {t('lyrics.backToCurrentLine')}
        </button>
      )}
    </div>
  )
}

import { ui } from '../../shared/ui-language'
import { useCallback, useEffectEvent, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LocateFixed } from 'lucide-react'
import { IconButton } from './design/Primitives'

export function PlayingSongLocator({
  loadedIdCount,
  canLoadTarget,
  loading,
  error,
  loadMore,
}: {
  loadedIdCount: number
  canLoadTarget: boolean
  loading: boolean
  error: string
  loadMore(): Promise<void>
}) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState(true)
  const [seeking, setSeeking] = useState(false)
  const attach = useCallback((node: HTMLSpanElement | null) => {
    setViewport(node?.closest<HTMLElement>('.panel-content') ?? null)
  }, [])
  const nextPage = useEffectEvent(loadMore)

  useLayoutEffect(() => {
    if (!viewport) return
    const rows = [...viewport.querySelectorAll<HTMLElement>('.song-row[aria-current="true"]')]
    const rowIsVisible = () => {
      const { top, bottom } = viewport.getBoundingClientRect()
      return rows.some((row) => {
        const rect = row.getBoundingClientRect()
        return rect.top < bottom && rect.bottom > top
      })
    }
    const update = () => setVisible(rowIsVisible())
    update()
    const observer = new IntersectionObserver(update, { root: viewport, threshold: [0, 0.001] })
    rows.forEach((row) => observer.observe(row))
    if (seeking) {
      if (rows.length) {
        if (!rowIsVisible())
          rows[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
        update()
        setSeeking(false)
      } else if (!canLoadTarget || error) {
        setSeeking(false)
      } else if (!loading) {
        void nextPage()
      }
    }
    return () => observer.disconnect()
  }, [viewport, loadedIdCount, canLoadTarget, loading, error, seeking])

  const panel = viewport?.closest('.surface-page')
  return (
    <>
      <span ref={attach} hidden />
      {!visible &&
        panel &&
        createPortal(
          <IconButton
            className="locate-playing-song"
            label={ui('定位正在播放的歌曲', 'Locate current track')}
            aria-busy={seeking}
            onClick={() => {
              if (seeking) return
              if (error && canLoadTarget) void loadMore()
              setSeeking(true)
            }}
          >
            <LocateFixed size={18} />
          </IconButton>,
          panel,
        )}
    </>
  )
}

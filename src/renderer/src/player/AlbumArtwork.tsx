import { ui } from '../../../shared/ui-language'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate } from 'animejs'
import { Disc3 } from 'lucide-react'
import type { Song } from '../../../shared/types'

export function AlbumArtwork({ song, className }: { song: Song | null; className: string }) {
  const [broken, setBroken] = useState('')
  const artwork = song?.cover && song.cover !== broken ? song.cover : ''
  const lastArtwork = useRef(artwork)
  const [outgoing, setOutgoing] = useState<string | null>(null)
  const previousLayer = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const before = lastArtwork.current
    lastArtwork.current = artwork
    if (before !== artwork)
      setOutgoing(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : before)
  }, [artwork])
  useEffect(() => {
    if (outgoing === null || !previousLayer.current) return
    const animation = animate(previousLayer.current, {
      opacity: [1, 0],
      duration: 220,
      ease: 'outQuad',
      onComplete: () => setOutgoing(null),
    })
    return () => {
      animation.revert()
    }
  }, [outgoing])
  const placeholder = (
    <div
      className="record-placeholder"
      role="img"
      aria-label={ui('唱片封面占位图', 'Record cover placeholder')}
    >
      <Disc3 aria-hidden="true" />
      {className === 'sleeve' && <small>{ui('暂无封面', 'No cover')}</small>}
    </div>
  )
  return (
    <div className={className}>
      {song && artwork ? (
        <img
          src={artwork}
          referrerPolicy="no-referrer"
          alt={song.name + ui(' 专辑封面', ' album cover')}
          draggable={false}
          onError={() => setBroken(artwork)}
        />
      ) : (
        placeholder
      )}
      {outgoing !== null && (
        <div className="previous-cover" aria-hidden="true" ref={previousLayer}>
          {outgoing ? (
            <img alt="" draggable={false} src={outgoing} referrerPolicy="no-referrer" />
          ) : (
            placeholder
          )}
        </div>
      )}
    </div>
  )
}

import type { CSSProperties } from 'react'
import type { Preferences } from '../../shared/desktop'
import './player-background.css'

export type PlayerBackgroundValues = Preferences['playerBackground']

/** Use the same cropped image and contrast scrim in the app and editor preview. */
export function PlayerBackground({ background }: { background: PlayerBackgroundValues }) {
  if (!background.image) return null
  const style: CSSProperties = {
    width: `${background.zoom}%`,
    height: `${background.zoom}%`,
    left: `${((100 - background.zoom) * background.x) / 100}%`,
    top: `${((100 - background.zoom) * background.y) / 100}%`,
    objectPosition: `${background.x}% ${background.y}%`,
    opacity: background.opacity / 100,
    filter: `blur(${background.blur}px)`,
  }
  return (
    <div className="player-background-layer" aria-hidden="true">
      <img src={background.image} style={style} alt="" draggable={false} />
    </div>
  )
}

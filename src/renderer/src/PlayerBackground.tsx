import { useLayoutEffect, type CSSProperties } from 'react'
import type { Preferences } from '../../shared/desktop'

export type PlayerBackgroundValues = Preferences['playerBackground']

/** Dialogs and popovers share the skin even when they portal outside the window shell. */
export function usePlayerBackgroundSurfaces(background?: PlayerBackgroundValues) {
  const layout = background?.layoutTransparency
  const component = background?.componentTransparency
  const popup = background?.popupTransparency
  useLayoutEffect(() => {
    const root = document.documentElement
    if (layout !== undefined)
      root.style.setProperty('--skin-layout-alpha', String(1 - layout / 100))
    if (component !== undefined)
      root.style.setProperty('--skin-component-alpha', String(1 - component / 100))
    if (popup !== undefined) root.style.setProperty('--skin-popup-alpha', String(1 - popup / 100))
    return () => {
      for (const key of ['layout-alpha', 'component-alpha', 'popup-alpha'])
        root.style.removeProperty('--skin-' + key)
    }
  }, [layout, component, popup])
}

/** Cropping and the normalized focal point are identical in the window and all preview frames. */
export function PlayerBackground({ background }: { background: PlayerBackgroundValues }) {
  if (!background.image) return null
  const style: CSSProperties = {
    width: `${background.zoom}%`,
    height: `${background.zoom}%`,
    left: `${((100 - background.zoom) * background.x) / 100}%`,
    top: `${((100 - background.zoom) * background.y) / 100}%`,
    objectPosition: `${background.x}% ${background.y}%`,
    opacity: background.opacity / 100,
    filter: `blur(calc(${background.blur}px * var(--skin-blur-scale, 1)))`,
  }
  return (
    <div className="player-background-layer" aria-hidden="true">
      <img src={background.image} style={style} alt="" draggable={false} />
    </div>
  )
}

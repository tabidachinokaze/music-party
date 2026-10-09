import { useEffect, useRef } from 'react'
import { volumeAfterWheel } from './volume-wheel'

export function useVolumeWheel<T extends HTMLElement = HTMLInputElement>(
  volume: number,
  onChange: (volume: number) => void,
) {
  const target = useRef<T>(null)
  const latest = useRef({ volume, onChange })
  latest.current = { volume, onChange }
  useEffect(() => {
    const element = target.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      const next = volumeAfterWheel(latest.current.volume, event.deltaY)
      if (next === null) return
      // A native nonpassive listener also prevents page scrolling at the limits.
      event.preventDefault()
      if (next === latest.current.volume) return
      latest.current.volume = next
      latest.current.onChange(next)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])
  return target
}

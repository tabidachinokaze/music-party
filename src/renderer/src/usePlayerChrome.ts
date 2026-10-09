import { useEffect, useState } from 'react'

/** Expanded-player controls share one idle state, including chat and private bubbles. */
export function usePlayerChrome(enabled: boolean, heldOpen: boolean) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    setVisible(true)
    if (!enabled || heldOpen) return
    let timer: ReturnType<typeof setTimeout>
    function interactiveFocus() {
      const active = document.activeElement as HTMLElement | null
      return (
        !!active?.closest('input,textarea,select,[contenteditable="true"],[aria-modal="true"]') ||
        !!document.querySelector(
          ':popover-open, .private-bubbles:hover, .player-bar:hover, .listening-topline button:hover',
        )
      )
    }
    function schedule() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (interactiveFocus()) schedule()
        else setVisible(false)
      }, 3000)
    }
    const show = () => {
      setVisible(true)
      schedule()
    }
    document.addEventListener('pointermove', show, { passive: true })
    document.addEventListener('pointerdown', show, { passive: true })
    document.addEventListener('keydown', show)
    document.addEventListener('focusin', show)
    schedule()
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointermove', show)
      document.removeEventListener('pointerdown', show)
      document.removeEventListener('keydown', show)
      document.removeEventListener('focusin', show)
    }
  }, [enabled, heldOpen])
  return !enabled || heldOpen || visible
}

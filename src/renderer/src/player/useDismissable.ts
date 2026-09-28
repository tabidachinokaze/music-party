import { useEffect, useEffectEvent, type RefObject } from 'react'

export function useDismissable(
  root: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled: boolean,
  trigger: string,
) {
  const dismiss = useEffectEvent(onClose)
  useEffect(() => {
    if (!enabled) return
    const pointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target || root.current?.contains(target) || target.closest(trigger)) return
      if (
        [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some(
          (modal) => modal.getClientRects().length,
        )
      )
        return
      dismiss()
    }
    document.addEventListener('pointerdown', pointer)
    return () => document.removeEventListener('pointerdown', pointer)
  }, [enabled, root, trigger])
}

import { useEffect, useState } from 'react'

export function usePresence(open: boolean) {
  const [present, setPresent] = useState(open)
  useEffect(() => {
    if (open) {
      setPresent(true)
      return
    }
    const timer = setTimeout(
      () => setPresent(false),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160,
    )
    return () => clearTimeout(timer)
  }, [open])
  return { mounted: open || present, closing: !open }
}

import { createPortal } from 'react-dom'
import { createContext, useContext, type ReactNode } from 'react'
export const SurfaceActive = createContext(true)
export function useSurfaceActive() {
  return useContext(SurfaceActive)
}

export const PanelHeaderTarget = createContext<HTMLElement | null>(null)
export function PanelHeader({ children }: { children: ReactNode }) {
  const target = useContext(PanelHeaderTarget)
  return target ? createPortal(children, target) : null
}
export const InlineDialog = createContext(false)

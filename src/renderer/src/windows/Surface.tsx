import { createPortal } from 'react-dom'
import { createContext, useContext, type ReactNode } from 'react'
export const SurfaceDocument = createContext<Document | null>(null)
export function useSurfaceDocument() {
  return useContext(SurfaceDocument) ?? document
}

export const PanelHeaderTarget = createContext<HTMLElement | null>(null)
export function PanelHeader({ children }: { children: ReactNode }) {
  const target = useContext(PanelHeaderTarget)
  return target ? createPortal(children, target) : null
}
export const InlineDialog = createContext(false)

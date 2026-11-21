export type Side = 'left' | 'right' | 'top' | 'bottom'
export type Box = { x: number; y: number; width: number; height: number }
export type Dock = { side: Side; offset: number }
export type Placement = { bounds: Box; dock: Dock | null }

const sizes = {
  windows: [280, 480],
  lyrics: [380, 520],
  controls: [320, 330],
  library: [480, 590],
  search: [480, 580],
  queue: [360, 520],
  room: [420, 570],
  chat: [380, 560],
  private: [480, 580],
  settings: [460, 580],
  diagnostics: [480, 490],
  login: [330, 400],
  add: [340, 400],
  confirm: [320, 209],
  feedback: [320, 152],
  members: [360, 490],
  match: [420, 560],
} as const
export type DetailId = `detail-${'album' | 'playlist' | 'artist'}-${string}`
export type PanelId = keyof typeof sizes | DetailId
export type PrivateMode = 'notice' | 'reply' | 'full'
export interface PanelStatus {
  visible: boolean
  dock: Side | null
  candidate: Side | null
}
export type PanelAction =
  | { type: 'show'; privateMode?: PrivateMode; passive?: boolean; noticeRows?: number }
  | { type: 'hide' | 'dock' | 'detach' }
  | { type: 'drag-start' | 'drag-move' | 'drag-end'; x: number; y: number }

export function isPanelId(value: unknown): value is PanelId {
  return (
    typeof value === 'string' &&
    (Object.hasOwn(sizes, value) || /^detail-(album|playlist|artist)-\d{1,22}$/.test(value))
  )
}
export function panelSize(id: PanelId, mode?: PrivateMode, noticeRows = 1) {
  if (id === 'private' && mode === 'notice')
    return {
      width: 300,
      height: 104 + 48 * (Math.max(1, Math.min(3, Math.trunc(noticeRows) || 1)) - 1),
    }
  if (id === 'private' && mode === 'reply') return { width: 350, height: 420 }
  const [width, height] = sizes[id as keyof typeof sizes] || [480, 560]
  return { width, height }
}
export function fits(box: Box, area: Box) {
  return (
    box.x >= area.x &&
    box.y >= area.y &&
    box.x + box.width <= area.x + area.width &&
    box.y + box.height <= area.y + area.height
  )
}
function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
export function fitBox(box: Box, area: Box): Box {
  const width = Math.min(area.width, box.width),
    height = Math.min(area.height, box.height)
  return {
    width,
    height,
    x: Math.round(Math.max(area.x, Math.min(box.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(box.y, area.y + area.height - height))),
  }
}
const vertical = (side: Side) => side === 'left' || side === 'right'
export function dockBounds(main: Box, size: Pick<Box, 'width' | 'height'>, dock: Dock): Box {
  const { side, offset } = dock
  const x =
    side === 'left'
      ? main.x - size.width - 8
      : side === 'right'
        ? main.x + main.width + 8
        : main.x + offset
  const y =
    side === 'top'
      ? main.y - size.height - 8
      : side === 'bottom'
        ? main.y + main.height + 8
        : main.y + offset
  return { ...size, x, y }
}
export function dockAt(main: Box, box: Box, side: Side): Dock {
  return { side, offset: vertical(side) ? box.y - main.y : box.x - main.x }
}
export function edgeDistance(main: Box, box: Box, side: Side) {
  return side === 'left'
    ? main.x - box.x - box.width
    : side === 'right'
      ? box.x - main.x - main.width
      : side === 'top'
        ? main.y - box.y - box.height
        : box.y - main.y - main.height
}
export function snapDock(main: Box, box: Box, occupied: Box[]): Dock | null {
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const overlap = vertical(side)
      ? Math.min(main.y + main.height, box.y + box.height) - Math.max(main.y, box.y)
      : Math.min(main.x + main.width, box.x + box.width) - Math.max(main.x, box.x)
    const dock = dockAt(main, box, side)
    if (
      overlap >= 40 &&
      Math.abs(edgeDistance(main, box, side)) <= 16 &&
      !occupied.some((other) => overlaps(dockBounds(main, box, dock), other))
    )
      return dock
  }
  return null
}
export function placePanel(
  id: PanelId,
  main: Box,
  size: Pick<Box, 'width' | 'height'>,
  areas: Box[],
  occupied: Box[],
): Placement {
  const left = ['lyrics', 'library', 'search'].includes(id) || id.startsWith('detail-')
  const sides: Side[] = left
    ? ['left', 'right', 'bottom', 'top']
    : ['right', 'left', 'bottom', 'top']
  for (const side of sides) {
    const along = vertical(side)
    const offsets = [
      0,
      ...occupied.map((b) => (along ? b.y + b.height - main.y + 8 : b.x + b.width - main.x + 8)),
    ]
    for (const offset of offsets) {
      if (offset > (along ? main.height : main.width) - 40) continue
      const dock = { side, offset },
        bounds = dockBounds(main, size, dock)
      if (areas.some((a) => fits(bounds, a)) && !occupied.some((b) => overlaps(b, bounds)))
        return { bounds, dock }
    }
  }
  for (const a of areas) {
    for (const x of [a.x, a.x + a.width - size.width]) {
      const bounds = fitBox({ ...size, x, y: a.y }, a)
      if (!overlaps(bounds, main) && !occupied.some((b) => overlaps(b, bounds)))
        return { bounds, dock: null }
    }
  }
  return {
    bounds: fitBox({ ...main, ...size, x: main.x + 32, y: main.y + 32 }, areas[0]),
    dock: null,
  }
}
export function readablePlacement(value: unknown): value is Placement {
  const p = value as Placement | undefined
  if (
    !p?.bounds ||
    !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(p.bounds[k as keyof Box]))
  )
    return false
  return (
    p.bounds.width >= 160 &&
    p.bounds.height >= 80 &&
    (p.dock === null ||
      (!!p.dock &&
        ['left', 'right', 'top', 'bottom'].includes(p.dock.side) &&
        Number.isFinite(p.dock.offset)))
  )
}

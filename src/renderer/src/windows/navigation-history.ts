import { ui } from '../../../shared/ui-language'
import type { PanelId } from '../../../shared/panels'
import type { Conversation, Member } from '../../../shared/types'

export const settingsLabels = {
  get appearance() {
    return ui('外观', 'Appearance')
  },
  get playback() {
    return ui('播放与桌面', 'Playback & desktop')
  },
  get account() {
    return ui('账号', 'Account')
  },
  get updates() {
    return ui('更新与帮助', 'Updates & help')
  },
} as const
export type SettingsSection = keyof typeof settingsLabels
export type Detail =
  | { panel: 'settings'; section: SettingsSection }
  | { panel: 'private'; peer: Conversation }
  | { panel: 'members'; roomId: string; member: Member }
export type Step = PanelId | Detail
export type Path = Step[]
export type History = { paths: Path[]; index: number }
export const panelOf = (step: Step) => (typeof step === 'string' ? step : step.panel)
export function stepKey(step: Step): string {
  if (typeof step === 'string') return step
  switch (step.panel) {
    case 'settings':
      return 'settings:' + step.section
    case 'private':
      return 'private:' + step.peer.uid
    case 'members':
      return 'members:' + step.roomId + ':' + step.member.uid
  }
}
const librarySections: PanelId[] = ['liked', 'albums', 'created', 'recent']
export const initial: Path = ['library']
export function rootPath(id: PanelId): Path | undefined {
  if (librarySections.includes(id)) return ['library', id]
  if (['library', 'search', 'settings', 'private'].includes(id)) return [id]
}
export function toPanel(path: Path, id: PanelId): Path {
  const root = rootPath(id)
  if (root) return root
  const index = path.indexOf(id)
  return index < 0 ? [...path, id] : path.slice(0, index + 1)
}
function samePath(a: Path, b: Path) {
  return a.length === b.length && a.every((step, i) => stepKey(step) === stepKey(b[i]))
}
export function visit(history: History, path: Path): History {
  if (samePath(history.paths[history.index], path)) return history
  const paths = [...history.paths.slice(0, history.index + 1), path]
  return { paths, index: paths.length - 1 }
}
export function begin(path: Path): History {
  let history: History = { paths: [initial], index: 0 }
  for (let i = 1; i <= path.length; i++) history = visit(history, path.slice(0, i))
  return history
}
export function visitDetail(history: History, detail: Detail): History {
  const current = history.paths[history.index]
  const parent = toPanel(current, detail.panel)
  // A direct link to a conversation still has an inbox one step behind it.
  if (!current.includes(detail.panel)) history = visit(history, parent)
  return visit(history, [...parent, detail])
}
export function closePanel(history: History, id: PanelId): History {
  const current = history.paths[history.index]
  const index = current.indexOf(id)
  if (index < 0) return history
  const parent = index ? current.slice(0, index) : initial
  for (let i = history.index - 1; i >= 0; i--) {
    if (samePath(history.paths[i], parent)) return { ...history, index: i }
  }
  return visit(history, parent)
}
export function filterHistory(history: History, keep: (step: Step) => boolean): History {
  let next = begin(initial)
  let index = 0
  history.paths.forEach((path, i) => {
    const remaining = path.filter(keep)
    next = visit(next, remaining.length ? remaining : initial)
    if (i === history.index) index = next.index
  })
  return { ...next, index }
}

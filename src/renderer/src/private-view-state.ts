import type { HistoryAnchor } from './history-scroll'

const positions = new Map<string, { latest: boolean; anchor: HistoryAnchor }>()
let account = ''
export function privateViewAccount(uid: string) {
  if (account === uid) return
  account = uid
  positions.clear()
}
export function savePrivateView(key: string, latest: boolean, anchor: HistoryAnchor) {
  positions.delete(key)
  positions.set(key, { latest, anchor })
  while (positions.size > 40) positions.delete(positions.keys().next().value!)
}
export function privateViewPosition(key: string) {
  return positions.get(key)
}

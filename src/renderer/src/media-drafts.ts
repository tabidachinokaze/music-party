import type { MediaFile, MediaProgress, MediaTarget } from '../../shared/media'

export interface MediaDraftEntry {
  id: string
  file: MediaFile
  target: MediaTarget
  label: string
  error: string
  uncertain: boolean
  requestId: string
  progress: MediaProgress | null
}

type CachedDraft = { entry: MediaDraftEntry; bytes: number }
const targetKey = (target: MediaTarget) =>
  target.kind === 'private'
    ? `private:${target.uid}`
    : target.kind === 'room'
      ? `room:${target.roomId}`
      : 'sticker'

/** Runtime-only files; component-owned preview URLs never enter the cache. */
export class MediaDraftStore {
  private account: string | null = null
  private drafts = new Map<string, CachedDraft>()
  private listeners = new Set<() => void>()
  constructor(
    private maxEntries = 16,
    private maxBytes = 256 * 1024 * 1024,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private emit() {
    for (const listener of this.listeners) listener()
  }
  activateAccount(account: string | null) {
    if (this.account === account) return
    this.account = account
    this.drafts.clear()
    this.emit()
  }
  get(account: string | undefined, target: MediaTarget): MediaDraftEntry | null {
    if (!account || account !== this.account) return null
    return this.drafts.get(targetKey(target))?.entry || null
  }
  remember(account: string | undefined, entry: MediaDraftEntry) {
    if (!account || account !== this.account) return false
    const bytes = entry.file.data.byteLength + (entry.file.cover?.byteLength || 0)
    if (bytes > this.maxBytes) return false
    const key = targetKey(entry.target)
    if (this.drafts.get(key)?.entry.requestId) return false
    const next = new Map(this.drafts)
    next.delete(key)
    next.set(key, { entry, bytes })
    let total = [...next.values()].reduce((sum, draft) => sum + draft.bytes, 0)
    for (const [candidate, draft] of next) {
      if (next.size <= this.maxEntries && total <= this.maxBytes) break
      if (candidate === key || draft.entry.requestId) continue
      total -= draft.bytes
      next.delete(candidate)
    }
    if (next.size > this.maxEntries || total > this.maxBytes) return false
    this.drafts = next
    this.emit()
    return true
  }
  update(
    account: string | undefined,
    target: MediaTarget,
    id: string,
    patch: Partial<Pick<MediaDraftEntry, 'error' | 'uncertain' | 'requestId' | 'progress'>>,
    requestId?: string,
  ) {
    const previous = this.get(account, target)
    if (!previous || previous.id !== id || (requestId && previous.requestId !== requestId))
      return false
    if (
      Object.entries(patch).every(
        ([key, value]) => previous[key as keyof MediaDraftEntry] === value,
      )
    )
      return true
    const cached = this.drafts.get(targetKey(target))!
    cached.entry = { ...previous, ...patch }
    this.emit()
    return true
  }
  begin(account: string | undefined, target: MediaTarget, id: string, requestId: string) {
    const entry = this.get(account, target)
    if (!entry || entry.id !== id || entry.requestId) return false
    return this.update(account, target, id, {
      requestId,
      progress: { requestId, phase: 'uploading', percent: 0 },
      error: '',
      uncertain: false,
    })
  }
  remove(account: string | undefined, target: MediaTarget, id: string, requestId?: string) {
    const entry = this.get(account, target)
    if (
      !entry ||
      entry.id !== id ||
      (requestId ? entry.requestId !== requestId : !!entry.requestId)
    )
      return false
    this.drafts.delete(targetKey(target))
    this.emit()
    return true
  }
}

export const mediaDrafts = new MediaDraftStore()

import type { ChatEmoji } from '../../shared/types'
import {
  parseStickerGroups,
  stickerKey,
  type SavedSticker,
  type StickerGroup,
} from '../../shared/stickers'
import { stickerSourceKeys, type StickerSource } from '../../shared/sticker-source'
import type { ApiCall } from './music-data'

type Page = {
  items: Map<string, SavedSticker>
  cursor: string
  more: boolean
  loaded: boolean
  unavailable: number
  pending: Promise<void> | null
  dirty: boolean
  scroll: number
  anchors: { key: string; offset: number }[]
}
export class StickerLibrary {
  groups: StickerGroup[] = []
  selected = ''
  error = ''
  groupsLoaded = false
  groupsPending: Promise<void> | null = null
  private pages = new Map<string, Page>()
  private removed = new Map<string, number>()
  private revision = 0
  private invalidation = 0
  private listeners = new Set<() => void>()
  constructor(
    readonly account: string,
    readonly scope: 'room' | 'private',
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  notify() {
    for (const listener of this.listeners) listener()
  }
  page(id = this.selected): Page {
    let page = this.pages.get(id)
    if (!page) {
      page = {
        items: new Map(),
        cursor: '',
        more: true,
        loaded: false,
        unavailable: 0,
        pending: null,
        dirty: false,
        scroll: 0,
        anchors: [],
      }
      this.pages.set(id, page)
    }
    return page
  }
  get loading() {
    return !!this.groupsPending || !!this.pages.get(this.selected)?.pending
  }
  async ensure(api: ApiCall, refresh = false) {
    this.error = ''
    try {
      if (!this.groupsLoaded || refresh) {
        if (!this.groupsPending) {
          this.groupsPending = (async () => {
            const groups = parseStickerGroups(await api('stickerGroups', { scope: this.scope }))
            this.groups = groups
            this.groupsLoaded = true
            if (!groups.some((item) => item.id === this.selected))
              this.selected = groups[0]?.id || ''
          })().finally(() => {
            this.groupsPending = null
            this.notify()
          })
          this.notify()
        }
        await this.groupsPending
      }
      if (this.selected) {
        const page = this.page()
        if (page.pending) await page.pending
        if (!page.loaded || page.dirty || refresh) await this.load(api, true)
      }
    } catch (error: any) {
      this.error = error.message || '读取自定义表情失败'
      this.notify()
    }
  }
  async load(api: ApiCall, refresh = false) {
    const id = this.selected
    if (!id) return
    const page = this.page(id)
    if (page.pending) return page.pending
    if (!refresh && page.loaded && !page.more) return
    const atRevision = this.revision,
      invalidation = this.invalidation,
      old = new Set(page.items.keys()),
      prefix = refresh && page.loaded
    const operation = (async () => {
      const incoming = new Map<string, SavedSticker>(),
        seen = new Set<string>()
      let cursor = refresh ? '' : page.cursor,
        more = false,
        reachedKnown = false,
        unavailable = 0
      do {
        seen.add(cursor)
        const result = await api('stickerPage', { groupId: id, ...(cursor ? { cursor } : {}) })
        if (!Array.isArray(result.data?.emojis)) throw new Error('表情列表响应异常，请重试')
        more = result.data.page?.more === true
        const next = result.data.page?.cursor
        if (more && (typeof next !== 'string' || !next || seen.has(next)))
          throw new Error('表情分页没有继续前进，请重试')
        unavailable += Number(result.data.unavailable) || 0
        for (const item of result.data.emojis as SavedSticker[]) {
          if ((this.removed.get(item.emojiId) ?? -1) > atRevision) continue
          const key = stickerKey(item)
          incoming.set(key, item)
          if (old.has(key) && page.items.has(key)) reachedKnown = true
        }
        cursor = typeof next === 'string' ? next : ''
      } while (prefix && old.size > 0 && more && !reachedKnown)
      for (const [key, item] of incoming)
        if ((this.removed.get(item.emojiId) ?? -1) > atRevision) incoming.delete(key)
      if (prefix)
        page.items = new Map([
          ...incoming,
          ...[...page.items].filter(([key]) => !incoming.has(key)),
        ])
      else for (const [key, item] of incoming) page.items.set(key, item)
      if (!prefix || !reachedKnown) {
        page.more = more
        page.cursor = cursor
      }
      page.unavailable = refresh ? unavailable : page.unavailable + unavailable
      page.loaded = true
      page.dirty = this.invalidation !== invalidation
    })()
    page.pending = operation
    this.notify()
    try {
      await operation
    } catch (error: any) {
      this.error = error.message || '读取自定义表情失败'
    } finally {
      page.pending = null
      this.notify()
    }
  }
  invalidate() {
    this.revision++
    this.invalidation++
    for (const page of this.pages.values()) page.dirty = true
    this.notify()
  }
  remove(ids: readonly string[]) {
    this.revision++
    const deleted = new Set(ids)
    for (const id of ids) this.removed.set(id, this.revision)
    for (const page of this.pages.values())
      for (const [key, item] of page.items) if (deleted.has(item.emojiId)) page.items.delete(key)
    this.notify()
  }
}
let activeAccount = ''
const libraries = new Map<string, StickerLibrary>()
const saved = new Map<string, string>()
export function stickerLibrary(account: string, scope: 'room' | 'private') {
  if (activeAccount !== account) {
    activeAccount = account
    libraries.clear()
    saved.clear()
  }
  let library = libraries.get(scope)
  if (!library) {
    library = new StickerLibrary(account, scope)
    libraries.set(scope, library)
  }
  return library
}
export function isStickerSaved(account: string, source: StickerSource) {
  return account === activeAccount && stickerSourceKeys(source).some((key) => saved.has(key))
}
export function rememberSticker(account: string, source: StickerSource, result?: ChatEmoji) {
  if (account !== activeAccount) return
  const id = result?.emojiId || ('emojiId' in source ? source.emojiId : '')
  for (const key of [...stickerSourceKeys(source), ...(result ? stickerSourceKeys(result) : [])])
    saved.set(key, id)
}
export function stickersChanged(account: string, removedIds?: readonly string[]) {
  if (account !== activeAccount) return
  if (removedIds) {
    const removed = new Set(removedIds)
    for (const [key, id] of saved) if (removed.has(id)) saved.delete(key)
  }
  for (const library of libraries.values())
    removedIds ? library.remove(removedIds) : library.invalidate()
}

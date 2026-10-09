import { useEffect, useRef, useState } from 'react'
import type { ApiCall } from './music-data'
import { rememberSticker, stickerLibrary } from './sticker-cache'

export function useCloudStickers(
  api: ApiCall,
  accountKey: string,
  scope: 'room' | 'private',
  visible: boolean,
) {
  const library = stickerLibrary(accountKey, scope),
    latest = useRef(api)
  const [revision, render] = useState(0)
  latest.current = api
  useEffect(() => library.subscribe(() => render((value) => value + 1)), [library])
  useEffect(() => {
    if (
      visible &&
      accountKey &&
      !library.error &&
      !library.loading &&
      (!library.groupsLoaded || library.page().dirty || !library.page().loaded)
    )
      void library.ensure(latest.current)
  }, [library, visible, accountKey, revision])
  const page = library.page()
  for (const item of page.items.values()) rememberSticker(accountKey, item)
  return {
    groups: library.groups,
    groupId: library.selected,
    cursor: page.cursor,
    items: [...page.items.values()],
    loading: library.loading,
    error: library.error,
    complete: page.loaded && !page.more,
    unavailable: page.unavailable,
    scroll: page.scroll,
    anchors: page.anchors,
    saveScroll: (top: number, anchors?: { key: string; offset: number }[]) => {
      page.scroll = top
      if (anchors) page.anchors = anchors
    },
    loadMore: () => library.load(latest.current),
    retry: () => {
      library.error = ''
      library.notify()
      return library.groupsLoaded && page.loaded && !page.dirty
        ? library.load(latest.current)
        : library.ensure(latest.current)
    },
    select: (id: string) => {
      if (!library.groups.some((group) => group.id === id)) return
      library.selected = id
      library.notify()
      void library.ensure(latest.current)
    },
    refresh: () => {
      void library.ensure(latest.current, true)
    },
  }
}

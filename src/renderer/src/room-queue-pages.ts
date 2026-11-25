// SPDX-License-Identifier: AGPL-3.0-only
// Pagination adapted from folium-mod-music-party/src/client/member-recommendations.ts
// at b01525f. See THIRD_PARTY_NOTICES.md.
import { parseRoomQueue } from '../../shared/playback-queue'
import type { RoomQueueEntry } from '../../shared/types'
import { t } from '../../shared/ui-language'
import type { ApiCall } from './music-data'

export type RoomQueueMethod = 'multiQueue' | 'multiPlayed'

/** A cursor and its rows belong to one room, list, and refresh. */
export class RoomQueuePages {
  readonly rows = new Map<string, RoomQueueEntry>()
  complete = false
  private cursor = ''
  private cursors = new Set([''])
  private loading?: Promise<void>

  next(api: ApiCall, roomId: string, method: RoomQueueMethod) {
    if (this.complete) return Promise.resolve()
    return (this.loading ??= this.read(api, roomId, method).finally(() => {
      this.loading = undefined
    }))
  }

  private async read(api: ApiCall, roomId: string, method: RoomQueueMethod) {
    const page = parseRoomQueue(
      await api(method, { roomId, ...(this.cursor ? { cursor: this.cursor } : {}) }),
    )
    if (page.more) {
      if (!page.cursor || this.cursors.has(page.cursor) || this.cursors.size >= 1000)
        throw new Error(t('roomQueuePages.theListStoppedLoadingRefreshAndTryAgain'))
      this.cursors.add(page.cursor)
      this.cursor = page.cursor
    }
    for (const entry of page.entries) this.rows.set(entry.songBizId, entry)
    this.complete = !page.more
  }
}

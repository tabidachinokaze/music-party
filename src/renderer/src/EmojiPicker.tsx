import { t } from '../../shared/ui-language'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Cloud, Ellipsis, LoaderCircle, RefreshCw, Smile } from 'lucide-react'
import type { ApiCall } from './music-data'
import { useCloudStickers } from './useCloudStickers'
import { useScrollPagination } from './useScrollPagination'
import { MediaComposer } from './MediaComposer'
import { stickersChanged } from './sticker-cache'
import { stickerKey } from '../../shared/stickers'
import type { ChatEmoji } from '../../shared/types'
import { ComposerPanel } from './ComposerPanel'
import { recentStickers } from './recent-stickers'
export function EmojiPicker({
  onSticker,
  disabled,
  api,
  accountKey,
  scope,
  recipient,
  triggerLabel = t('emojiPicker.chooseASticker'),
  triggerIcon,
}: {
  onSticker?(value: ChatEmoji): void
  disabled?: boolean
  api: ApiCall
  accountKey: string
  scope: 'room' | 'private'
  recipient: string
  triggerLabel?: string
  triggerIcon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'cloud' | 'recent'>('cloud')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false),
    [selectedIds, setSelectedIds] = useState(new Set<string>()),
    [removing, setRemoving] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLDivElement>(null)
  const moreId = useId()
  const [narrowTools, setNarrowTools] = useState(false)
  useLayoutEffect(() => {
    const el = toolbar.current
    if (!el) return
    const measure = () => setNarrowTools(el.clientWidth < 300)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [open, tab])
  const cloud = useCloudStickers(api, accountKey, scope, open && tab === 'cloud')
  const stickerPages = useScrollPagination({
    enabled: open && tab === 'cloud' && !!accountKey && !editing && !removing,
    loading: cloud.loading,
    hasMore: !!cloud.groupId && !cloud.complete,
    blocked: !!cloud.error,
    scope: `${accountKey}:${scope}:${cloud.groupId}`,
    contentKey: `${cloud.items.length}:${cloud.cursor}`,
    onLoad: cloud.loadMore,
  })
  function captureScroll(node: HTMLDivElement) {
    const bounds = node.getBoundingClientRect()
    const anchors: { key: string; offset: number }[] = []
    for (const child of node.children) {
      const button = child as HTMLElement,
        rect = button.getBoundingClientRect()
      if (rect.bottom <= bounds.top) continue
      if (rect.top >= bounds.bottom && anchors.length) break
      if (button.dataset.stickerKey)
        anchors.push({ key: button.dataset.stickerKey, offset: rect.top - bounds.top })
    }
    cloud.saveScroll(node.scrollTop, anchors)
  }
  useLayoutEffect(() => {
    const node = grid.current
    if (!node) return
    node.scrollTop = cloud.scroll
    for (const anchor of cloud.anchors) {
      const button = [...node.children].find(
        (child) => (child as HTMLElement).dataset.stickerKey === anchor.key,
      )
      if (!button) continue
      node.scrollTop +=
        button.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.offset
      break
    }
    captureScroll(node)
  }, [open, tab, cloud.groupId, cloud.items])
  async function removeSelected() {
    if (!selectedIds.size || removing) return
    const ids = [...selectedIds]
    setRemoving(true)
    setNotice('')
    try {
      await api('stickerRemove', { emojiIds: ids })
      stickersChanged(accountKey, ids)
      setSelectedIds(new Set())
      setEditing(false)
      setNotice(t('emojiPicker.deletedStickers', { count: ids.length }))
    } catch (error: any) {
      setNotice(error.message || t('emojiPicker.couldntDeleteTryAgain'))
    } finally {
      setRemoving(false)
    }
  }
  const recent = open && tab === 'recent' ? recentStickers(accountKey) : []
  function closePicker() {
    setOpen(false)
    setEditing(false)
    setSelectedIds(new Set())
  }
  const management = (
    <>
      <button
        type="button"
        className="icon-btn"
        title={t('common.refreshCustomStickers')}
        aria-label={t('common.refreshCustomStickers')}
        disabled={cloud.loading || removing || editing}
        onClick={() => {
          more.current?.hidePopover()
          setNotice('')
          cloud.refresh()
        }}
      >
        <RefreshCw size={16} />
      </button>
      <button
        type="button"
        className="text-btn"
        disabled={removing || !cloud.items.length}
        onClick={() => {
          more.current?.hidePopover()
          setEditing(!editing)
          setSelectedIds(new Set())
        }}
      >
        {editing ? t('emojiPicker.done') : t('emojiPicker.manageStickers')}
      </button>
    </>
  )
  return (
    <>
      <button
        ref={trigger}
        className="icon-btn"
        type="button"
        aria-label={triggerLabel}
        title={triggerLabel}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? closePicker() : setOpen(true))}
      >
        {triggerIcon ?? <Smile size={19} />}
      </button>
      {open && (
        <ComposerPanel
          title={t('emojiPicker.stickers')}
          anchor={trigger.current}
          onClose={closePicker}
          picker
          tools={
            <>
              {scope === 'room' && (
                <div className="filter-tabs sticker-tabs">
                  <button
                    className={tab === 'cloud' ? 'selected' : ''}
                    onClick={() => setTab('cloud')}
                  >
                    <Cloud size={14} />
                    {t('common.customStickers')}
                  </button>
                  <button
                    className={tab === 'recent' ? 'selected' : ''}
                    onClick={() => setTab('recent')}
                  >
                    {t('emojiPicker.recent')}
                  </button>
                </div>
              )}
              {tab === 'cloud' && (
                <>
                  <div
                    className="cloud-sticker-toolbar"
                    data-compact={narrowTools || undefined}
                    ref={toolbar}
                  >
                    <span
                      className="cloud-sticker-count"
                      title={t('emojiPicker.sendTo', { recipient })}
                    >
                      <span>{t('emojiPicker.stickerCount', { count: cloud.items.length })}</span>
                      <span className="cloud-sticker-progress">
                        {!!cloud.items.length && cloud.loading && (
                          <span
                            role="status"
                            aria-label={t('common.loadingMoreStickers')}
                            title={t('common.loadingMoreStickers')}
                          >
                            <LoaderCircle size={14} className="spin" />
                          </span>
                        )}
                        {!!cloud.items.length && cloud.error && (
                          <button
                            className="icon-btn"
                            type="button"
                            onClick={cloud.retry}
                            title={t('common.errorRetry', { error: cloud.error })}
                            aria-label={t('common.retry')}
                          >
                            <RefreshCw size={14} />
                            <span role="alert">{cloud.error}</span>
                          </button>
                        )}
                      </span>
                    </span>
                    <MediaComposer
                      target={{ kind: 'sticker' }}
                      accountKey={accountKey}
                      label={t('emojiPicker.neteaseCustomStickers')}
                      disabled={!accountKey || disabled}
                      onMediaPlay={() => {}}
                      onSent={(receipt) => {
                        if (receipt.senderUid === accountKey) {
                          setNotice(t('emojiPicker.addedToYourNeteaseCustomStickers'))
                        }
                      }}
                    />
                    {narrowTools ? (
                      <>
                        <button
                          type="button"
                          className="icon-btn sticker-more-trigger"
                          aria-label={t('emojiPicker.moreStickerActions')}
                          popoverTarget={moreId}
                        >
                          <Ellipsis size={16} />
                        </button>
                        <div
                          ref={more}
                          id={moreId}
                          popover="auto"
                          className="sticker-management-menu"
                        >
                          {management}
                        </div>
                      </>
                    ) : (
                      management
                    )}
                  </div>
                  {cloud.groups.length > 1 && (
                    <select
                      className="sticker-group-select"
                      aria-label={t('emojiPicker.stickerGroups')}
                      value={cloud.groupId}
                      disabled={cloud.loading || removing || editing}
                      onChange={(event) => cloud.select(event.target.value)}
                    >
                      <div
                        className="sticker-group-options"
                        data-list-viewport=""
                        onMouseDownCapture={(event) => {
                          // Dragging the scrollbar should leave keyboard navigation on the option.
                          if ((event.target as Element).closest('.os-scrollbar'))
                            event.preventDefault()
                        }}
                      >
                        {cloud.groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </div>
                    </select>
                  )}
                </>
              )}
            </>
          }
          contentProps={{
            className: tab === 'cloud' ? 'sticker-grid cloud-sticker-grid' : 'sticker-grid',
            ref: tab === 'cloud' ? grid : undefined,
            onScroll: tab === 'cloud' ? (event) => captureScroll(event.currentTarget) : undefined,
          }}
          status={
            tab === 'cloud' &&
            notice && (
              <p className="sticker-notice" role="status">
                {notice}
              </p>
            )
          }
          actions={
            tab === 'cloud' &&
            editing && (
              <button
                type="button"
                className="primary"
                disabled={removing || !selectedIds.size}
                onClick={removeSelected}
              >
                {removing
                  ? t('emojiPicker.deleting')
                  : t('emojiPicker.deleteSelected', { count: selectedIds.size })}
              </button>
            )
          }
        >
          {tab === 'cloud' && (
            <>
              {!cloud.items.length && cloud.loading && (
                <div className="cloud-sticker-loading" role="status">
                  <LoaderCircle size={15} className="spin" /> {t('emojiPicker.loadingStickers')}
                </div>
              )}
              {!cloud.items.length && cloud.error && (
                <p className="private-error" role="alert">
                  {cloud.error}
                  <button type="button" className="text-btn" onClick={cloud.retry}>
                    {t('common.retry')}
                  </button>
                </p>
              )}
              {cloud.items.map((item) => (
                <button
                  type="button"
                  key={stickerKey(item)}
                  data-sticker-key={stickerKey(item)}
                  title={!editing && item.restricted ? item.restriction : undefined}
                  aria-label={t(
                    editing ? 'emojiPicker.selectForDeletion' : 'emojiPicker.sendCustomSticker',
                    { name: item.emojiName },
                  )}
                  aria-pressed={editing ? selectedIds.has(item.emojiId) : undefined}
                  disabled={
                    removing ||
                    (editing ? item.emojiId === '0' : disabled || item.restricted || !onSticker)
                  }
                  onClick={() => {
                    if (editing) {
                      const next = new Set(selectedIds)
                      next.has(item.emojiId) ? next.delete(item.emojiId) : next.add(item.emojiId)
                      setSelectedIds(next)
                      return
                    }
                    onSticker?.(item)
                    setOpen(false)
                  }}
                >
                  <img
                    src={item.emojiImgUrl}
                    alt={item.emojiName}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  {editing && (
                    <span className="sticker-selection" aria-hidden="true">
                      {selectedIds.has(item.emojiId) && <Check size={12} />}
                    </span>
                  )}
                  {item.restricted && <small>{t('emojiPicker.unavailable')}</small>}
                </button>
              ))}
              <div ref={stickerPages} className="pagination-sentinel" aria-hidden="true" />
              {accountKey && !cloud.loading && !cloud.error && !cloud.items.length && (
                <p className="chat-empty">
                  {cloud.groups.length
                    ? t('emojiPicker.noCustomStickersYetUploadAnImageTo')
                    : t('emojiPicker.noStickerGroupsFoundRefreshOrUploadAn')}
                </p>
              )}
              {!!cloud.unavailable && (
                <p className="muted">
                  {t('emojiPicker.unavailableStickers', { count: cloud.unavailable })}
                </p>
              )}
              {!accountKey && (
                <p className="chat-empty">{t('emojiPicker.signInToSyncCustomStickers')}</p>
              )}
            </>
          )}
          {tab === 'recent' && onSticker && (
            <>
              {recent.map((item) => (
                <button
                  type="button"
                  key={item.emojiId === '0' ? item.emojiImgUrl : item.emojiId}
                  aria-label={t('emojiPicker.sendSticker', { emojiName: item.emojiName })}
                  onClick={() => {
                    onSticker(item)
                    setOpen(false)
                  }}
                >
                  <img
                    src={item.emojiImgUrl}
                    alt={item.emojiName}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </button>
              ))}
              {!recent.length && (
                <p className="chat-empty">
                  {t('emojiPicker.stickersYouUseOrReceiveWillAppearHere')}
                </p>
              )}
            </>
          )}
        </ComposerPanel>
      )}
    </>
  )
}

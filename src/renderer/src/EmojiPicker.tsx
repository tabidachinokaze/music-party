import { ui } from '../../shared/ui-language'
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
  triggerLabel = ui('选择表情', 'Choose a sticker'),
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
      setNotice(ui('已删除 {0} 个表情', 'Deleted stickers: {0}', ids.length))
    } catch (error: any) {
      setNotice(error.message || ui('删除失败，请重试', 'Couldn’t delete. Try again.'))
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
        title={ui('刷新自定义表情', 'Refresh custom stickers')}
        aria-label={ui('刷新自定义表情', 'Refresh custom stickers')}
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
        {editing ? ui('取消整理', 'Done') : ui('整理表情', 'Manage stickers')}
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
          title={ui('表情', 'Stickers')}
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
                    {ui('自定义表情', 'Custom stickers')}
                  </button>
                  <button
                    className={tab === 'recent' ? 'selected' : ''}
                    onClick={() => setTab('recent')}
                  >
                    {ui('最近使用', 'Recent')}
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
                      title={ui('发送至{0}', 'Send to {0}', recipient)}
                    >
                      <span>{ui('{0} 个表情', 'Stickers: {0}', cloud.items.length)}</span>
                      <span className="cloud-sticker-progress">
                        {!!cloud.items.length && cloud.loading && (
                          <span
                            role="status"
                            aria-label={ui('正在读取更多表情…', 'Loading more stickers…')}
                            title={ui('正在读取更多表情…', 'Loading more stickers…')}
                          >
                            <LoaderCircle size={14} className="spin" />
                          </span>
                        )}
                        {!!cloud.items.length && cloud.error && (
                          <button
                            className="icon-btn"
                            type="button"
                            onClick={cloud.retry}
                            title={ui('{0} · 重试', '{0} · Retry', cloud.error)}
                            aria-label={ui('重试', 'Retry')}
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
                      label={ui('网易云自定义表情', 'NetEase custom stickers')}
                      disabled={!accountKey || disabled}
                      onMediaPlay={() => {}}
                      onSent={(receipt) => {
                        if (receipt.senderUid === accountKey) {
                          setNotice(
                            ui('已添加到网易云自定义表情', 'Added to your NetEase custom stickers'),
                          )
                        }
                      }}
                    />
                    {narrowTools ? (
                      <>
                        <button
                          type="button"
                          className="icon-btn sticker-more-trigger"
                          aria-label={ui('更多表情操作', 'More sticker actions')}
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
                      aria-label={ui('表情分组', 'Sticker groups')}
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
                  ? ui('正在删除…', 'Deleting…')
                  : ui('删除所选 ({0})', 'Delete selected ({0})', selectedIds.size)}
              </button>
            )
          }
        >
          {tab === 'cloud' && (
            <>
              {!cloud.items.length && cloud.loading && (
                <div className="cloud-sticker-loading" role="status">
                  <LoaderCircle size={15} className="spin" />{' '}
                  {ui('正在读取表情…', 'Loading stickers…')}
                </div>
              )}
              {!cloud.items.length && cloud.error && (
                <p className="private-error" role="alert">
                  {cloud.error}
                  <button type="button" className="text-btn" onClick={cloud.retry}>
                    {ui('重试', 'Retry')}
                  </button>
                </p>
              )}
              {cloud.items.map((item) => (
                <button
                  type="button"
                  key={stickerKey(item)}
                  data-sticker-key={stickerKey(item)}
                  title={!editing && item.restricted ? item.restriction : undefined}
                  aria-label={`${editing ? ui('选择删除', 'Select for deletion') : ui('发送自定义表情', 'Send custom sticker')} ${item.emojiName}`}
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
                  {item.restricted && <small>{ui('暂不可用', 'Unavailable')}</small>}
                </button>
              ))}
              <div ref={stickerPages} className="pagination-sentinel" aria-hidden="true" />
              {accountKey && !cloud.loading && !cloud.error && !cloud.items.length && (
                <p className="chat-empty">
                  {cloud.groups.length
                    ? ui(
                        '还没有自定义表情，上传一张喜欢的图片吧',
                        'No custom stickers yet. Upload an image to get started.',
                      )
                    : ui(
                        '暂未读取到自定义表情分组，可以刷新或上传图片。',
                        'No sticker groups found. Refresh or upload an image.',
                      )}
                </p>
              )}
              {!!cloud.unavailable && (
                <p className="muted">
                  {ui('有 {0} 个表情暂无法读取', 'Unavailable stickers: {0}', cloud.unavailable)}
                </p>
              )}
              {!accountKey && (
                <p className="chat-empty">
                  {ui('登录后同步自定义表情', 'Sign in to sync custom stickers')}
                </p>
              )}
            </>
          )}
          {tab === 'recent' && onSticker && (
            <>
              {recent.map((item) => (
                <button
                  type="button"
                  key={item.emojiId === '0' ? item.emojiImgUrl : item.emojiId}
                  aria-label={ui('发送表情 {0}', 'Send sticker {0}', item.emojiName)}
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
                  {ui(
                    '最近使用和收到的图片表情会显示在这里',
                    'Stickers you use or receive will appear here',
                  )}
                </p>
              )}
            </>
          )}
        </ComposerPanel>
      )}
    </>
  )
}

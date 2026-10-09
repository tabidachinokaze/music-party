import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Cloud, LoaderCircle, RefreshCw, Smile } from 'lucide-react'
import type { ApiCall } from './music-data'
import { useCloudStickers } from './useCloudStickers'
import { useScrollPagination } from './useScrollPagination'
import { MediaComposer } from './MediaComposer'
import { stickersChanged } from './sticker-cache'
import { stickerKey } from '../../shared/stickers'
import type { ChatEmoji } from '../../shared/types'
import { Overlay } from './player/Overlay'
const emojis = [
  '😀',
  '😄',
  '😁',
  '😂',
  '🥹',
  '😊',
  '😍',
  '🥰',
  '😘',
  '😎',
  '🥳',
  '🤩',
  '🤔',
  '🫡',
  '🥲',
  '😭',
  '😮',
  '😴',
  '🙃',
  '🤗',
  '👍',
  '👏',
  '🙌',
  '🤝',
  '🫶',
  '❤️',
  '💖',
  '💔',
  '🔥',
  '✨',
  '🎵',
  '🎶',
  '🎧',
  '🎤',
  '🎸',
  '🎹',
  '🥁',
  '🌙',
  '☀️',
  '🌈',
  '🌸',
  '🍀',
  '☕',
  '🍻',
  '🎉',
  '💯',
  '✅',
  '👀',
]
export function EmojiPicker({
  onInsert,
  stickers = [],
  onSticker,
  disabled,
  api,
  accountKey,
  scope,
  recipient,
  triggerLabel = '选择表情',
  triggerIcon,
  defaultTab = 'cloud',
}: {
  onInsert(value: string): void
  stickers?: ChatEmoji[]
  onSticker?(value: ChatEmoji): void
  disabled?: boolean
  api: ApiCall
  accountKey: string
  scope: 'room' | 'private'
  recipient: string
  triggerLabel?: string
  triggerIcon?: ReactNode
  defaultTab?: 'cloud' | 'basic' | 'recent'
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'cloud' | 'basic' | 'recent'>(defaultTab)
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false),
    [selectedIds, setSelectedIds] = useState(new Set<string>()),
    [removing, setRemoving] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
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
      setNotice(`已删除 ${ids.length} 个表情`)
    } catch (error: any) {
      setNotice(error.message || '删除失败，请重试')
    } finally {
      setRemoving(false)
    }
  }
  const recent = [...new Map(stickers.map((item) => [item.emojiImgUrl, item])).values()]
    .slice(-32)
    .reverse()
  return (
    <>
      <button
        ref={trigger}
        className="icon-btn"
        type="button"
        aria-label={triggerLabel}
        title={triggerLabel}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {triggerIcon ?? <Smile size={19} />}
      </button>
      {open && (
        <Overlay title="表情" sideAnchor={trigger.current} onClose={() => setOpen(false)}>
          <div className="filter-tabs sticker-tabs">
            <button className={tab === 'cloud' ? 'selected' : ''} onClick={() => setTab('cloud')}>
              <Cloud size={14} />
              自定义表情
            </button>
            <button className={tab === 'basic' ? 'selected' : ''} onClick={() => setTab('basic')}>
              常用表情
            </button>
            {scope === 'room' && (
              <button
                className={tab === 'recent' ? 'selected' : ''}
                onClick={() => setTab('recent')}
              >
                最近使用
              </button>
            )}
          </div>
          {tab === 'cloud' && (
            <>
              <div className="cloud-sticker-toolbar">
                <span>
                  {`${cloud.items.length} 个表情${cloud.complete ? '' : ' · 可继续加载'}`}
                </span>
                <MediaComposer
                  target={{ kind: 'sticker' }}
                  accountKey={accountKey}
                  label="网易云自定义表情"
                  disabled={!accountKey || disabled}
                  onMediaPlay={() => {}}
                  onSent={(receipt) => {
                    if (receipt.senderUid === accountKey) {
                      setNotice('已添加到网易云自定义表情')
                    }
                  }}
                />
                <button
                  className="icon-btn"
                  title="刷新自定义表情"
                  aria-label="刷新自定义表情"
                  disabled={cloud.loading || removing || editing}
                  onClick={() => {
                    setNotice('')
                    cloud.refresh()
                  }}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
              <div className="cloud-sticker-toolbar">
                <button
                  type="button"
                  className="text-btn"
                  disabled={removing || !cloud.items.length}
                  onClick={() => {
                    setEditing(!editing)
                    setSelectedIds(new Set())
                  }}
                >
                  {editing ? '取消整理' : '整理表情'}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="text-btn"
                    disabled={removing || !selectedIds.size}
                    onClick={removeSelected}
                  >
                    {removing ? '正在删除…' : `删除所选 (${selectedIds.size})`}
                  </button>
                )}
              </div>
              {cloud.groups.length > 1 && (
                <select
                  className="sticker-group-select"
                  aria-label="表情分组"
                  value={cloud.groupId}
                  disabled={cloud.loading || removing || editing}
                  onChange={(event) => cloud.select(event.target.value)}
                >
                  {cloud.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="overlay-intro">
                {accountKey ? `点击表情，发送至${recipient}` : '登录后同步网易云的自定义表情'}
              </p>
              {notice && (
                <p className="sticker-notice" role="status">
                  {notice}
                </p>
              )}
              {cloud.error && (
                <p className="private-error" role="alert">
                  {cloud.error}
                  <button className="text-btn" onClick={cloud.retry}>
                    重试
                  </button>
                </p>
              )}
              <div
                className="sticker-grid cloud-sticker-grid"
                ref={grid}
                onScroll={(event) => {
                  const node = event.currentTarget
                  captureScroll(node)
                }}
              >
                {cloud.items.map((item) => (
                  <button
                    type="button"
                    key={stickerKey(item)}
                    data-sticker-key={stickerKey(item)}
                    title={item.restricted ? item.restriction : item.emojiName}
                    aria-label={`${editing ? '选择删除' : '发送自定义表情'} ${item.emojiName}`}
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
                    {item.restricted && <small>暂不可用</small>}
                  </button>
                ))}
                <div ref={stickerPages} className="pagination-sentinel" aria-hidden="true" />
              </div>
              {cloud.loading && (
                <div className="cloud-sticker-loading" role="status">
                  <LoaderCircle size={15} className="spin" />
                  {cloud.items.length ? '正在读取更多表情…' : '正在读取表情…'}
                </div>
              )}
              {!cloud.loading && !cloud.error && !cloud.items.length && (
                <p className="chat-empty">
                  {cloud.groups.length
                    ? '还没有自定义表情，上传一张喜欢的图片吧'
                    : '暂未读取到自定义表情分组，可以刷新或上传图片。'}
                </p>
              )}
              {!!cloud.unavailable && (
                <p className="muted">有 {cloud.unavailable} 个表情暂无法读取</p>
              )}
            </>
          )}
          {tab === 'basic' && (
            <>
              <p className="overlay-intro">选择表情添加到输入框</p>
              <div className="emoji-grid">
                {emojis.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    aria-label={`插入表情 ${emoji}`}
                    onClick={() => {
                      onInsert(emoji)
                      setOpen(false)
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
          {tab === 'recent' && !!recent.length && onSticker && (
            <>
              <p className="overlay-intro">房间里使用过的图片与表情 · 点击发送</p>
              <div className="sticker-grid">
                {recent.map((item) => (
                  <button
                    type="button"
                    key={item.emojiImgUrl}
                    aria-label={`发送表情 ${item.emojiName}`}
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
              </div>
            </>
          )}
          {tab === 'recent' && !recent.length && (
            <p className="chat-empty">最近收到的图片和表情会显示在这里</p>
          )}
        </Overlay>
      )}
    </>
  )
}

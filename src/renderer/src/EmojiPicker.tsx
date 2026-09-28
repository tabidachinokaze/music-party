import { useState } from 'react'
import { Cloud, LoaderCircle, RefreshCw, Smile } from 'lucide-react'
import type { ApiCall } from './music-data'
import { useCloudStickers } from './useCloudStickers'
import { MediaComposer } from './MediaComposer'
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
}: {
  onInsert(value: string): void
  stickers?: ChatEmoji[]
  onSticker?(value: ChatEmoji): void
  disabled?: boolean
  api: ApiCall
  accountKey: string
  scope: 'room' | 'private'
  recipient: string
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'cloud' | 'basic' | 'recent'>('cloud')
  const [notice, setNotice] = useState('')
  const cloud = useCloudStickers(api, accountKey, scope, open && tab === 'cloud')
  const recent = [...new Map(stickers.map((item) => [item.emojiImgUrl, item])).values()]
    .slice(-32)
    .reverse()
  return (
    <>
      <button
        className="icon-btn"
        type="button"
        aria-label="选择表情"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Smile size={19} />
      </button>
      {open && (
        <Overlay title="表情" onClose={() => setOpen(false)}>
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
                  {cloud.complete ? `${cloud.items.length} 个表情` : '正在同步网易云表情'}
                </span>
                <MediaComposer
                  target={{ kind: 'sticker' }}
                  label="网易云自定义表情"
                  disabled={!accountKey || disabled}
                  onMediaPlay={() => {}}
                  onSent={(receipt) => {
                    if (receipt.senderUid === accountKey) {
                      setNotice('已添加到网易云自定义表情')
                      cloud.refresh()
                    }
                  }}
                />
                <button
                  className="icon-btn"
                  title="刷新自定义表情"
                  aria-label="刷新自定义表情"
                  disabled={cloud.loading}
                  onClick={() => {
                    setNotice('')
                    cloud.refresh()
                  }}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
              {cloud.groups.length > 1 && (
                <select
                  className="sticker-group-select"
                  aria-label="表情分组"
                  value={cloud.groupId}
                  disabled={cloud.loading}
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
                  <button className="text-btn" onClick={cloud.refresh}>
                    重试
                  </button>
                </p>
              )}
              <div className="sticker-grid cloud-sticker-grid">
                {cloud.items.map((item) => (
                  <button
                    type="button"
                    key={stickerKey(item)}
                    title={item.restricted ? item.restriction : item.emojiName}
                    aria-label={`发送自定义表情 ${item.emojiName}`}
                    disabled={disabled || item.restricted || !onSticker}
                    onClick={() => {
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
              </div>
              {cloud.loading && (
                <p className="loading">
                  <LoaderCircle size={15} className="spin" />
                  正在读取表情…
                </p>
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

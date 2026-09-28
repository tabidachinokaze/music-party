import { useState } from 'react'
import { Smile } from 'lucide-react'
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
}: {
  onInsert(value: string): void
  stickers?: ChatEmoji[]
  onSticker?(value: ChatEmoji): void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
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
          {!!recent.length && onSticker && (
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
        </Overlay>
      )}
    </>
  )
}

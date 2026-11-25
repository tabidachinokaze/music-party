// SPDX-License-Identifier: AGPL-3.0-only
// React adaptation of folium-mod-music-party@b01525f's panel composer,
// text pickers and mention composer. Copyright (C) tabidachinokaze.
// See THIRD_PARTY_NOTICES.md.

import { ui } from '../../shared/ui-language'
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { useSurfaceActive } from './windows/Surface'
import { ComposerPanel } from './ComposerPanel'
import { CornerDownLeft, LoaderCircle, Send, Smile } from 'lucide-react'
import { UserAvatar } from './design/UserAvatar'
import type { Member } from '../../shared/types'
import { mountComposerSubmit } from './composer-submit'
import {
  composerEmojis,
  composerKaomojis,
  currentMentionQuery,
  insertComposerText,
  type ComposerSelection,
  type MentionQuery,
} from './composer-text'

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  maxLength,
  label,
  placeholder,
  busy = false,
  disabled = false,
  className = '',
  members,
  renderTools,
  notice,
  submitLabel = ui('发送', 'Send'),
  composerRef,
}: {
  value: string
  onChange(value: string): void
  onSubmit(): void | Promise<unknown>
  maxLength: number
  label: string
  placeholder: string
  busy?: boolean
  disabled?: boolean
  className?: string
  members?: Member[]
  renderTools(): ReactNode
  notice?: ReactNode
  submitLabel?: string
  composerRef?: Ref<{ insertText(text: string): void }>
}) {
  const surfaceActive = useSurfaceActive()
  const form = useRef<HTMLFormElement>(null),
    draft = useRef<HTMLTextAreaElement>(null),
    send = useRef<HTMLButtonElement>(null),
    emojiButton = useRef<HTMLButtonElement>(null),
    kaomojiButton = useRef<HTMLButtonElement>(null),
    selection = useRef<ComposerSelection>({ start: value.length, end: value.length }),
    pendingCaret = useRef<{ value: string; caret: number } | null>(null),
    composing = useRef(false)
  const [menu, setMenu] = useState<'Emoji' | 'kaomoji' | null>(null),
    [mention, setMention] = useState<MentionQuery | null>(null),
    [active, setActive] = useState(0),
    [error, setError] = useState('')
  const pickerId = useId(),
    mentionId = useId()
  const seen = new Set<string>()
  const candidates = mention
    ? (members || []).filter((member) => {
        if (!member.nickname.trim() || seen.has(member.uid)) return false
        seen.add(member.uid)
        return member.nickname.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase())
      })
    : []
  const activeIndex = candidates.length ? Math.min(active, candidates.length - 1) : 0

  useEffect(() => {
    if (!draft.current || !form.current || !send.current) return
    return mountComposerSubmit(draft.current, form.current, send.current)
  }, [])
  useLayoutEffect(() => {
    const pending = pendingCaret.current,
      node = draft.current
    if (!node) return
    if (!pending) {
      selection.current = { start: node.selectionStart, end: node.selectionEnd }
      return
    }
    if (pending.value !== value) return
    node.focus({ preventScroll: true })
    node.setSelectionRange(pending.caret, pending.caret)
    selection.current = { start: pending.caret, end: pending.caret }
    pendingCaret.current = null
  }, [value])
  useLayoutEffect(() => {
    if (surfaceActive) return
    setMenu(null)
    setMention(null)
  }, [surfaceActive])
  useEffect(() => {
    if (!mention) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (
        target &&
        (draft.current?.contains(target) ||
          form.current?.querySelector('.composer-mentions')?.contains(target))
      )
        return
      setMention(null)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [mention])

  function saveSelection() {
    const node = draft.current
    if (node) selection.current = { start: node.selectionStart, end: node.selectionEnd }
  }
  function updateMention(nextValue = value) {
    saveSelection()
    if (!members || composing.current || disabled) return
    const next = currentMentionQuery(nextValue, selection.current)
    setMention(next)
    setActive(0)
  }
  function insert(text: string, range = selection.current, isMention = false) {
    if (disabled || composing.current) return
    const next = insertComposerText(value, range, text, maxLength)
    if (!next) {
      if (isMention)
        setError(
          ui(
            '最多输入 {0} 字，剩余空间不足以提及这位成员',
            'The {0}-character limit leaves too little room for this mention',
            maxLength,
          ),
        )
      draft.current?.focus({ preventScroll: true })
      return
    }
    pendingCaret.current = next
    setMention(null)
    setError('')
    setMenu(null)
    onChange(next.value)
    // Inserting the same text still restores its caret and editor focus.
    if (next.value === value && draft.current) {
      draft.current.focus({ preventScroll: true })
      draft.current.setSelectionRange(next.caret, next.caret)
      pendingCaret.current = null
    }
  }
  function choose(member: Member) {
    if (mention) insert(`@${member.nickname.trim()} `, mention, true)
  }
  useImperativeHandle(composerRef, () => ({
    insertText: (text) =>
      insert(text, selection.current, text.startsWith('@') && text.endsWith(' ')),
  }))
  function toggleMenu(next: 'Emoji' | 'kaomoji') {
    setMention(null)
    setMenu((previous) => (previous === next ? null : next))
  }

  return (
    <form
      ref={form}
      className={`party-composer ${className}`}
      data-ready={Boolean(value.trim())}
      data-error={Boolean(error)}
      onSubmit={(event) => {
        event.preventDefault()
        if (disabled || busy || !value.trim()) return
        setMention(null)
        setMenu(null)
        void onSubmit()
      }}
    >
      {notice && <p className="composer-notice">{notice}</p>}
      <textarea
        ref={draft}
        aria-label={label}
        aria-controls={mention ? mentionId : undefined}
        aria-expanded={mention ? true : undefined}
        aria-activedescendant={
          mention && candidates.length ? `${mentionId}-${activeIndex}` : undefined
        }
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        rows={1}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value)
          setError('')
          updateMention(event.target.value)
        }}
        onSelect={saveSelection}
        onBlur={saveSelection}
        onClick={() => updateMention()}
        onCompositionStart={() => {
          composing.current = true
          setMention(null)
        }}
        onCompositionEnd={(event) => {
          composing.current = false
          updateMention(event.currentTarget.value)
        }}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateMention()
        }}
        onKeyDown={(event) => {
          if (
            !mention ||
            composing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return
          if (event.key === 'Tab') return setMention(null)
          if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') setMention(null)
          else if (event.key === 'Enter') {
            const member = candidates[activeIndex]
            if (member) choose(member)
          } else if (candidates.length) {
            const index =
              (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) %
              candidates.length
            setActive(index)
            form.current
              ?.querySelector(`#${CSS.escape(`${mentionId}-${index}`)}`)
              ?.scrollIntoView({ block: 'nearest' })
          }
        }}
      />
      <div className="composer-tools">
        <button
          ref={emojiButton}
          className="icon-btn composer-tool"
          type="button"
          aria-label="Emoji"
          title="Emoji"
          aria-haspopup="dialog"
          aria-expanded={menu === 'Emoji'}
          aria-controls={menu === 'Emoji' ? pickerId : undefined}
          disabled={disabled || busy}
          onClick={() => toggleMenu('Emoji')}
        >
          <Smile size={16} />
        </button>
        <button
          ref={kaomojiButton}
          className="icon-btn composer-tool"
          type="button"
          aria-label={ui('颜文字', 'Kaomoji')}
          title={ui('颜文字', 'Kaomoji')}
          aria-haspopup="dialog"
          aria-expanded={menu === 'kaomoji'}
          aria-controls={menu === 'kaomoji' ? pickerId : undefined}
          disabled={disabled || busy}
          onClick={() => toggleMenu('kaomoji')}
        >
          <span aria-hidden="true">(ω)</span>
        </button>
        {renderTools()}
        <button
          ref={send}
          className="primary composer-send"
          type="submit"
          disabled={disabled || busy || !value.trim()}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : value.trim() ? (
            <Send size={14} />
          ) : (
            <CornerDownLeft size={14} />
          )}
          <span>{busy ? ui('发送中…', 'Sending…') : submitLabel}</span>
        </button>
      </div>
      {error && (
        <p className="composer-notice" role="status">
          {error}
        </p>
      )}
      {menu && (
        <ComposerPanel
          id={pickerId}
          title={menu === 'kaomoji' ? ui('颜文字', 'Kaomoji') : menu}
          anchor={menu === 'Emoji' ? emojiButton.current : kaomojiButton.current}
          onClose={() => setMenu(null)}
          picker
          contentProps={{
            className:
              menu === 'kaomoji' ? 'composer-text-grid composer-kaomoji' : 'composer-text-grid',
          }}
        >
          {(menu === 'kaomoji' ? composerKaomojis : composerEmojis).map((text) => (
            <button
              key={text}
              title={ui(
                menu === 'kaomoji' ? '插入颜文字 {0}' : '插入表情 {0}',
                menu === 'kaomoji' ? 'Insert kaomoji {0}' : 'Insert emoji {0}',
                text,
              )}
              type="button"
              onClick={() => insert(text)}
            >
              {text}
            </button>
          ))}
        </ComposerPanel>
      )}
      {mention && (
        <div
          data-list-viewport=""
          className="composer-mentions"
          id={mentionId}
          role="listbox"
          aria-label={ui('提及成员', 'Mention a member')}
        >
          {candidates.map((member, index) => (
            <button
              key={member.uid}
              id={`${mentionId}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              title={ui('提及 {0}', 'Mention {0}', member.nickname)}
              aria-label={member.nickname}
              aria-selected={index === activeIndex}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(member)}
            >
              <UserAvatar
                name={member.nickname}
                src={member.avatar}
                className="composer-mention-avatar"
              />
              <span className="composer-mention-name">{member.nickname}</span>
            </button>
          ))}
          {!candidates.length && (
            <p className="composer-mention-empty">
              {ui('没有匹配的房间成员', 'No matching room members')}
            </p>
          )}
        </div>
      )}
    </form>
  )
}

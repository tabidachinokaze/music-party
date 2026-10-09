// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from folium-mod-music-party@b01525f src/client/mention-composer.ts
// and src/client/private-tools.ts. Copyright (C) tabidachinokaze.
// See THIRD_PARTY_NOTICES.md.

export interface ComposerSelection {
  start: number
  end: number
}
export interface MentionQuery extends ComposerSelection {
  query: string
}

export function currentMentionQuery(
  value: string,
  selection: ComposerSelection,
): MentionQuery | null {
  if (selection.start !== selection.end) return null
  const end = selection.start,
    start = value.lastIndexOf('@', end - 1)
  if (start < 0 || start >= end) return null
  const query = value.slice(start + 1, end)
  // Keep email addresses and completed mentions out of the suggestion list.
  if (/\s|@/u.test(query) || (start > 0 && /[A-Za-z0-9._%+-]/u.test(value[start - 1]))) return null
  return { start, end, query }
}

export function insertComposerText(
  value: string,
  selection: ComposerSelection,
  text: string,
  limit: number,
) {
  if (value.length - (selection.end - selection.start) + text.length > limit) return null
  return {
    value: value.slice(0, selection.start) + text + value.slice(selection.end),
    caret: selection.start + text.length,
  }
}

export const composerEmojis = [
  '😀',
  '😊',
  '😂',
  '🥰',
  '😍',
  '🥹',
  '😎',
  '🤔',
  '😭',
  '😴',
  '🥳',
  '🤗',
  '👍',
  '👏',
  '🫶',
  '❤️',
  '💙',
  '✨',
  '🎵',
  '🎧',
  '🌙',
  '☀️',
  '🌸',
  '🍀',
]
export const composerKaomojis = [
  '(｡･ω･｡)',
  '(≧▽≦)',
  '( •̀ ω •́ )✧',
  '(づ｡◕‿‿◕｡)づ',
  '(´･_･`)',
  '╮(╯▽╰)╭',
  '(T_T)',
  '٩(ˊᗜˋ*)و',
]

import { describe, expect, it } from 'vitest'
import { currentMentionQuery, insertComposerText } from '../src/renderer/src/composer-text'
import { mountComposerSubmit } from '../src/renderer/src/composer-submit'

describe('composer insertion', () => {
  it('replaces a selected range and leaves the caret after an emoji or kaomoji', () => {
    expect(insertComposerText('前面旧文字后面', { start: 2, end: 5 }, '😊', 100)).toEqual({
      value: '前面😊后面',
      caret: 4,
    })
    expect(insertComposerText('ab', { start: 1, end: 1 }, '(T_T)', 100)).toEqual({
      value: 'a(T_T)b',
      caret: 6,
    })
  })
  it('allows replacement within the limit but does not truncate a full nickname', () => {
    expect(insertComposerText('12345', { start: 0, end: 5 }, '😊', 5)?.value).toBe('😊')
    expect(insertComposerText('1234', { start: 4, end: 4 }, '😊', 5)).toBeNull()
    expect(insertComposerText('@听 你好', { start: 0, end: 2 }, '@完整的房间用户名 ', 100)).toEqual(
      { value: '@完整的房间用户名  你好', caret: 10 },
    )
  })
  it('finds the unfinished mention at the caret and ignores emails, selections and completed mentions', () => {
    expect(currentMentionQuery('你好 @听友 后文', { start: 6, end: 6 })).toEqual({
      start: 3,
      end: 6,
      query: '听友',
    })
    expect(currentMentionQuery('@', { start: 1, end: 1 })).toEqual({ start: 0, end: 1, query: '' })
    expect(currentMentionQuery('mail@host', { start: 9, end: 9 })).toBeNull()
    expect(currentMentionQuery('@听友 ', { start: 4, end: 4 })).toBeNull()
    expect(currentMentionQuery('@听友', { start: 1, end: 3 })).toBeNull()
  })
})

describe('composer submit chord', () => {
  function setup() {
    const draft = Object.assign(new EventTarget(), {
      value: '你好',
      disabled: false,
      readOnly: false,
    })
    const submit = { disabled: false, title: '', textContent: '发送', setAttribute() {} }
    let requests = 0
    const form = { requestSubmit: () => requests++ }
    const dispose = mountComposerSubmit(
      draft as unknown as HTMLTextAreaElement,
      form as unknown as HTMLFormElement,
      submit as unknown as HTMLButtonElement,
    )
    function key(overrides: Record<string, unknown> = {}) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        key: 'Enter',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        isComposing: false,
        keyCode: 13,
        repeat: false,
        ...overrides,
      })
      draft.dispatchEvent(event)
      return event
    }
    return { draft, submit, key, dispose, requests: () => requests }
  }
  it('keeps plain Enter for text/mention handlers and submits exactly once for Ctrl+Enter', () => {
    const test = setup()
    expect(test.key().defaultPrevented).toBe(false)
    expect(test.requests()).toBe(0)
    expect(test.key({ ctrlKey: true }).defaultPrevented).toBe(true)
    expect(test.requests()).toBe(1)
    test.key({ ctrlKey: true, repeat: true })
    expect(test.requests()).toBe(1)
    test.dispose()
  })
  it('does not submit composing text or alternate modifier combinations', () => {
    const test = setup()
    test.draft.dispatchEvent(new Event('compositionstart'))
    expect(test.key({ ctrlKey: true }).defaultPrevented).toBe(false)
    test.draft.dispatchEvent(new Event('compositionend'))
    test.key({ ctrlKey: true, isComposing: true })
    test.key({ ctrlKey: true, keyCode: 229 })
    test.key({ ctrlKey: true, altKey: true })
    test.key({ ctrlKey: true, metaKey: true })
    expect(test.requests()).toBe(0)
    test.key({ ctrlKey: true })
    expect(test.requests()).toBe(1)
    test.dispose()
  })
  it('honors disabled, read-only and empty drafts and removes listeners on dispose', () => {
    const test = setup()
    test.submit.disabled = true
    test.key({ ctrlKey: true })
    test.submit.disabled = false
    test.draft.disabled = true
    test.key({ ctrlKey: true })
    test.draft.disabled = false
    test.draft.readOnly = true
    test.key({ ctrlKey: true })
    test.draft.readOnly = false
    test.draft.value = '   '
    test.key({ ctrlKey: true })
    test.draft.value = '你好'
    test.dispose()
    test.key({ ctrlKey: true })
    expect(test.requests()).toBe(0)
  })
})

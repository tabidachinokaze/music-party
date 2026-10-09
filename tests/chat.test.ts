import { expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageTime } from '../src/renderer/src/ChatMessageCard'
import { ApiService, validate } from '../src/main/service'
import { multiPayload } from '../src/main/multi-api'
import { parseSnapshot } from '../src/shared/multiplayer'
import { mergeChat, parseChatPage } from '../src/shared/chat'
import type { ChatMessage } from '../src/shared/types'
const nativeSnapshot = () => ({
  roomId: 'r',
  multiRoomInfoDTO: { chatRoomId: '987654321', roomType: 'MULTI_MATCH_SONG' },
  multiLtRoomUserAgg: {
    onlineNums: 3,
    onlineUserInfos: [
      { uid: 1, nickname: 'one', avatar: 'https://img.test/1' },
      { uid: 2, nickname: 'two' },
      { uid: 3, nickname: 'three' },
    ],
  },
})
it('keeps a safe integer timestamp outside the Date range from crashing the chat list', () => {
  expect(renderToStaticMarkup(createElement(MessageTime, { time: 8640000000000001 }))).toContain(
    '时间未知',
  )
})
const request = {
  method: 'multiChatSend' as const,
  args: {
    roomId: 'r',
    text: 'hello private message',
    requestId: '11111111-1111-4111-8111-111111111111',
  },
}
const status = { body: { code: 200, data: { multiLtRoomSnapshot: nativeSnapshot() } } }
it('reads wire aliases for actual members and chat room ID, with no dependence on Android property names', () => {
  const result = parseSnapshot(nativeSnapshot(), 1)
  expect(result.members.map((m) => m.nickname)).toEqual(['one', 'two', 'three'])
  expect(result.onlineCount).toBe(3)
  expect(result.membersKnown).toBe(true)
  expect(result.chatRoomId).toBe('987654321')
})
it('does not treat an absent member list as empty and tolerates one malformed member', () => {
  expect(parseSnapshot({ roomId: 'r' }, 1).membersKnown).toBe(false)
  const raw = nativeSnapshot()
  raw.multiLtRoomUserAgg.onlineUserInfos.push({ uid: NaN, nickname: 'bad' })
  expect(parseSnapshot(raw, 1).members).toHaveLength(3)
})
it('constructs the official plain-text chat envelope and history cursor', () => {
  const data = multiPayload('multiChatSend', {
    roomId: 'r',
    chatRoomId: '987',
    text: '<b>你好</b>\n👋',
  })
  expect(data).toMatchObject({ chatroomId: '987', msgType: 0 })
  expect(JSON.parse((data as any).clientExt)).toEqual({
    bizType: 'listenTogether',
    ltType: 'MULTI_MATCH_SONG',
    roomId: 'r',
  })
  expect(JSON.parse((data as any).msgBody)).toEqual({ msg: '<b>你好</b>\n👋', msgType: 0 })
  expect(multiPayload('multiChatHistory', { roomId: 'r', cursor: 'older' })).toEqual({
    roomId: 'r',
    direction: 0,
    page: '{"size":50,"cursor":"older"}',
  })
})
it('rejects empty or oversized messages and renderer-controlled destination IDs', () => {
  for (const text of [' ', 'a'.repeat(101), 'bad\u0000'])
    expect(() => validate({ ...request, args: { ...request.args, text } })).toThrow()
  expect(() =>
    validate({ ...request, args: { ...request.args, chatRoomId: 'another-room' } }),
  ).toThrow()
})
it('deduplicates concurrent sends and resolves destination from the current authenticated room', async () => {
  const invoke = vi.fn(async (method: string, _args: any) =>
    method === 'multiStatus' ? status : { body: { code: 200, data: { success: true } } },
  )
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=test')
  const [a, b] = await Promise.all([service.call(request), service.call(request)])
  expect(a.ok && b.ok).toBe(true)
  expect(invoke.mock.calls.filter(([m]) => m === 'multiChatSend')).toHaveLength(1)
  expect(invoke.mock.calls[1][1]).toMatchObject({
    roomId: 'r',
    chatRoomId: '987654321',
    text: request.args.text,
  })
  expect(JSON.stringify(a.trace)).not.toContain('hello private message')
  expect(
    (await service.call({ ...request, args: { ...request.args, text: 'different' } })).ok,
  ).toBe(false)
})
it('never sends to a room after the account has left it', async () => {
  const invoke = vi.fn(async () => ({ body: { code: 200, data: {} } }))
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=test')
  const result = await service.call(request)
  expect(result.ok).toBe(false)
  expect(result.deliveryUnknown).toBe(false)
  expect(invoke).toHaveBeenCalledTimes(1)
})
it('keeps a timed-out send uncertain, without automatic retry', async () => {
  const invoke = vi.fn(async (method: string) => {
    if (method === 'multiStatus') return status
    throw new Error('network timeout')
  })
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=test')
  const result = await service.call(request)
  expect(result.deliveryUnknown).toBe(true)
  await service.call(request)
  expect(invoke.mock.calls.filter(([m]) => m === 'multiChatSend')).toHaveLength(1)
})
it('filters cross-room and audience-limited messages, preserves plain text and paginates', () => {
  const item = {
    roomId: 'r',
    sendUid: 2,
    sendTime: 1000,
    nickname: 'two',
    msgType: 0,
    imChatRoomMsgBody: { text: '<script>alert(1)</script>' },
  }
  const result = parseChatPage(
    {
      data: {
        records: [
          item,
          { ...item, roomId: 'other', sendTime: 2 },
          { ...item, onlyCanSeeUserIds: [3], sendTime: 3 },
        ],
        page: { more: true, cursor: 'older' },
      },
    },
    'r',
    '1',
  )
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0].text).toBe('<script>alert(1)</script>')
  expect(result.cursor).toBe('older')
})
it('merges overlapping pages, replaces one optimistic echo, and keeps new identical messages visible', () => {
  const server: ChatMessage = {
    id: '1:1000',
    roomId: 'r',
    uid: '1',
    time: 1000,
    text: 'hi',
    nickname: 'one',
    avatar: '',
    kind: 'text',
  }
  const local: ChatMessage = {
    ...server,
    id: 'local:a',
    time: 2000,
    delivery: 'submitted',
    echoAfter: 1000,
  }
  expect(mergeChat([server], [local])).toHaveLength(2)
  expect(
    mergeChat([server, local], [server, { ...server, id: '1:2100', time: 2100 }]).map((m) => m.id),
  ).toEqual(['1:1000', '1:2100'])
})
it('omits received chat text from diagnostics while returning it for the UI', async () => {
  const service = new ApiService(async () => ({
    body: {
      code: 200,
      data: {
        records: [{ sendUid: 1, sendTime: 1, imChatRoomMsgBody: { text: 'private chat body' } }],
        page: { more: false },
      },
    },
  }))
  service.restore('MUSIC_U=test')
  const result = await service.call({ method: 'multiChatHistory', args: { roomId: 'r' } })
  expect(result.ok).toBe(true)
  expect(JSON.stringify(result.data)).toContain('private chat body')
  expect(JSON.stringify(result.trace)).not.toContain('private chat body')
})

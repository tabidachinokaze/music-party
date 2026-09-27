import { expect, it, vi } from 'vitest'
import { ApiService, validate } from '../src/main/service'
import {
  findInvitations,
  inviteText,
  messageContent,
  mergePrivate,
  parseConversations,
  parsePrivatePage,
} from '../src/shared/private-messages'
import type { PrivateMessage } from '../src/shared/types'
const link =
  'https://st.music.163.com/listen-together/multishare/index.html?roomId=official-room&inviterUid=456&isFLT=false'
const send = {
  method: 'privateSend' as const,
  args: { uid: '456', text: 'private body', requestId: '22222222-2222-4222-8222-222222222222' },
}
const account = { body: { data: { code: 200, profile: { userId: 123 } } } }
it('recognizes escaped links inside text and JSON cards and the verified official multi deep link', () => {
  const variants = [
    link.replaceAll('&', String.raw`\&`),
    JSON.stringify({ type: 99, card: { url: link } }),
    {
      card: {
        androidUrl: 'orpheus://nm/multiListenTogether/joinRoom?roomId=official-room&inviterId=456',
      },
    },
  ]
  for (const value of variants)
    expect(findInvitations(value)).toEqual([
      { roomId: 'official-room', inviterUid: '456', isFLT: false },
    ])
})
it('does not turn pair/follow/foreign URLs or arbitrary roomId properties into multi invitations', () => {
  for (const value of [
    link.replace('st.music.163.com', 'evil.test'),
    link.replace('isFLT=false', 'isFLT=true'),
    'https://st.music.163.com/listen-together/share/?roomId=r&inviterId=1',
    { roomId: 'r', inviterId: 1 },
  ])
    expect(findInvitations(value)).toEqual([])
})
it('preserves Unicode and plain text and represents unknown message types without crashing', () => {
  expect(messageContent(JSON.stringify({ type: 1, msg: '<b>你好👋</b>\nhello' })).text).toBe(
    '<b>你好👋</b>\nhello',
  )
  expect(messageContent({ type: 999 }).text).toContain('暂不支持')
})
it('identifies both incoming and outgoing conversation peers and retains paging metadata', () => {
  const body = {
    more: true,
    msgs: [
      {
        fromUser: { userId: 456, nickname: 'Alice' },
        toUser: { userId: 123 },
        lastMsg: '{"msg":"one"}',
        lastMsgTime: 1,
        newMsgCount: 2,
      },
      {
        fromUser: { userId: 123 },
        toUser: { userId: 789, nickname: 'Bob' },
        lastMsg: '{"msg":"two"}',
        lastMsgTime: 2,
      },
    ],
  }
  const page = parseConversations(body, '123')
  expect(page.conversations.map((c) => c.uid)).toEqual(['456', '789'])
  expect(page.more).toBe(true)
  expect(page.conversations[0].unread).toBe(2)
})
it('uses the oldest timestamp for history and excludes messages from another conversation', () => {
  const msg = (id: number, from: number, to: number, time: number) => ({
    id,
    fromUser: { userId: from },
    toUser: { userId: to },
    time,
    msg: JSON.stringify({ type: 1, msg: 'text' }),
  })
  const page = parsePrivatePage(
    { more: true, msgs: [msg(1, 456, 123, 200), msg(2, 123, 456, 100), msg(3, 789, 123, 150)] },
    '123',
    '456',
  )
  expect(page.messages.map((m) => m.id)).toEqual(['server:2', 'server:1'])
  expect(page.before).toBe(100)
})
it('replaces a sent optimistic bubble only with its own matching recipient echo', () => {
  const local: PrivateMessage = {
    id: 'local:1',
    senderId: '123',
    recipientId: '456',
    time: 1000,
    text: 'hello',
    invitations: [],
    delivery: 'submitted',
    echoAfter: 800,
  }
  const old = { ...local, id: 'server:old', time: 700, delivery: undefined }
  expect(mergePrivate([old], [local])).toHaveLength(2)
  const echo = { ...local, id: 'server:new', time: 1100, delivery: undefined }
  expect(mergePrivate([old, local], [echo]).map((m) => m.id)).toEqual(['server:old', 'server:new'])
})
it('sends one recipient and deduplicates retries without exposing text in diagnostics', async () => {
  const invoke = vi.fn(async (method: string, _args: any) =>
    method === 'login_status' ? account : { body: { code: 200, msgs: [] } },
  )
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=test')
  const replies = await Promise.all([service.call(send), service.call(send)])
  expect(replies.every((r) => r.ok)).toBe(true)
  const calls = invoke.mock.calls.filter(([method]) => method === 'send_text')
  expect(calls).toHaveLength(1)
  expect(calls[0][1]).toEqual({
    msg: 'private body',
    user_ids: '456',
    cookie: 'MUSIC_U=test',
    timeout: 12000,
  })
  expect(JSON.stringify(replies[0].trace)).not.toContain('private body')
  expect(() => validate({ ...send, args: { ...send.args, uid: '456,789' } })).toThrow()
})
it('revalidates the current official room and builds the invitation with the authenticated sender', async () => {
  const invoke = vi.fn(async (method: string, _args: any) =>
    method === 'login_status'
      ? account
      : method === 'multiStatus'
        ? { body: { code: 200, data: { multiLtRoomSnapshot: { roomId: 'r' } } } }
        : { body: { code: 200, msgs: [] } },
  )
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=test')
  const reply = await service.call({
    method: 'privateInvite',
    args: { uid: '456', roomId: 'r', requestId: send.args.requestId },
  })
  expect(reply.ok).toBe(true)
  expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({
    user_ids: '456',
    msg: inviteText('r', '123'),
  })
})
it('never sends an invitation for a room the user has already left, or a private message to self', async () => {
  const invoke = vi.fn(async (method: string) =>
    method === 'login_status' ? account : { body: { code: 200, data: {} } },
  )
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=test')
  expect(
    (
      await service.call({
        method: 'privateInvite',
        args: { uid: '456', roomId: 'r', requestId: send.args.requestId },
      })
    ).ok,
  ).toBe(false)
  expect(
    (
      await service.call({
        ...send,
        args: { ...send.args, uid: '123', requestId: '33333333-3333-4333-8333-333333333333' },
      })
    ).ok,
  ).toBe(false)
  expect(invoke.mock.calls.some(([method]) => method === 'send_text')).toBe(false)
})
it('hides encoded lastMsg/msgs content from traces but returns it to the private UI', async () => {
  const service = new ApiService(async () => ({
    body: { code: 200, msgs: [{ lastMsg: JSON.stringify({ msg: 'inbox-secret' }) }], more: false },
  }))
  service.restore('MUSIC_U=test')
  const reply = await service.call({ method: 'privateConversations' })
  expect(JSON.stringify(reply.data)).toContain('inbox-secret')
  expect(JSON.stringify(reply.trace)).not.toContain('inbox-secret')
})
it('unwraps the official nativeUrl url1/url2 card wrapper while preserving its caption', () => {
  const caption = '我们一起听歌吧！分享你喜欢的歌给大家，一起玩转多人一起听～'
  const native = 'orpheus://nm/multiListenTogether/joinRoom?roomId=official-room&inviterId=456'
  const wrapper = `orpheus://nm/redirect?url1=${encodeURIComponent(native)}&url2=${encodeURIComponent(link)}`
  const card = JSON.stringify({ msg: caption, generalMsg: { nativeUrl: wrapper } })
  const result = messageContent(card)
  expect(result.text).toBe(caption)
  expect(result.invitations).toEqual([{ roomId: 'official-room', inviterUid: '456', isFLT: false }])
})
it('handles nested encoded bodies and an HTTP official share fallback without executing wrappers', () => {
  const deep = 'orpheus://nm/webview?url=' + encodeURIComponent(link.replace('https:', 'http:'))
  const data = {
    body: JSON.stringify({
      nativeUrl: 'orpheus://nm/redirect?url2=' + encodeURIComponent(encodeURIComponent(deep)),
    }),
  }
  expect(findInvitations(data)).toEqual([
    { roomId: 'official-room', inviterUid: '456', isFLT: false },
  ])
})
it('reads card content alongside the legacy msg field, without inspecting sender profile URLs', () => {
  const raw = {
    id: 100,
    time: 1000,
    fromUser: { userId: 456, nickname: link },
    toUser: { userId: 123 },
    msg: '{"msg":"一起听"}',
    body: JSON.stringify({ nativeUrl: 'orpheus://nm/redirect?url2=' + encodeURIComponent(link) }),
  }
  expect(parsePrivatePage({ msgs: [raw] }, '123', '456').messages[0].invitations).toHaveLength(1)
  expect(
    parsePrivatePage({ msgs: [{ ...raw, body: undefined }] }, '123', '456').messages[0].invitations,
  ).toHaveLength(0)
})
it('rejects foreign, pair and follow targets inside native wrappers and survives bad percent encodings', () => {
  const bad = [
    link.replace('st.music.163.com', 'evil.test'),
    link.replace('isFLT=false', 'isFLT=true'),
    'https://st.music.163.com/listen-together/share/?roomId=r&inviterId=1',
    'https%3A%XXbad',
    'javascript:alert(1)',
  ]
  for (const target of bad)
    expect(
      findInvitations({ nativeUrl: 'orpheus://nm/redirect?url1=' + encodeURIComponent(target) }),
    ).toEqual([])
  expect(
    findInvitations({ nativeUrl: 'https://evil.test/?url1=' + encodeURIComponent(link) }),
  ).toEqual([])
})

import { expect, it } from 'vitest'
import {
  mergePrivate,
  parsePrivatePage,
  messageContent,
  conversationName,
} from '../src/shared/private-messages'
import { parseChatPage, mergeChat } from '../src/shared/chat'
import { musicMessageLink, mediaUrl, richMessageContent } from '../src/shared/message-content'
import { multiPayload } from '../src/main/multi-api'
import { validate } from '../src/main/service'
import { getUiLanguage, setUiLanguage, ui } from '../src/shared/ui-language'
import { roomActivityPresentation } from '../src/shared/room-activity-presentation'
const emoji = {
  emojiId: '1',
  emojiGroupId: '2',
  emojiName: '开心',
  emojiImgUrl: 'https://p1.music.126.net/happy.gif',
  width: 100,
  height: 100,
  format: 'gif',
}
it('renders room emoji, recommendations, interactions and highlighted system text from official fields', () => {
  const messages = parseChatPage(
    {
      data: {
        records: [
          { sendUid: 1, sendTime: 1, msgType: 0, emoji, imChatRoomMsgBody: { text: '[开心]' } },
          {
            sendUid: 2,
            sendTime: 2,
            msgType: 2,
            resourceInfo: { resourceId: 123, bizId: 456, title: '歌曲', artistName: ['歌手'] },
          },
          {
            sendUid: 3,
            sendTime: 3,
            msgType: 1,
            imChatRoomMsgBody: { mainStateText: '赞了这首歌' },
          },
          {
            sendUid: 0,
            sendTime: 4,
            msgType: 3,
            imChatRoomMsgBody: {
              msgRichText: {
                contentTextList: [
                  { text: '欢迎', highLighted: false },
                  { text: '听友', highLighted: true },
                ],
              },
            },
          },
        ],
        page: { more: false },
      },
    },
    'r',
    '1',
  ).messages
  expect(messages.map((m) => m.kind)).toEqual(['image', 'resource', 'interaction', 'notice'])
  expect(messages[0].attachments?.[0]).toMatchObject({ kind: 'image', url: emoji.emojiImgUrl })
  expect(messages[1].attachments?.[0]).toMatchObject({ resourceType: 'song', resourceId: '123' })
  expect(messages[3].richText?.[1]).toMatchObject({ text: '听友', emphasized: true })
})
it('supports legacy resources and modern picture, voice, video, generic card and file envelopes', () => {
  for (const key of [
    'song',
    'playlist',
    'album',
    'artist',
    'program',
    'djRadio',
    'mv',
    'topic',
    'user',
    'event',
    'mlog',
    'concert',
    'live',
    'comment',
  ]) {
    expect(messageContent({ [key]: { id: 123, name: '内容' } }).attachments?.[0].title).toBe('内容')
  }
  const url = 'https://p1.music.126.net/media'
  for (const [msgType, kind] of [
    [1, 'image'],
    [4, 'audio'],
    [5, 'video'],
  ] as const)
    expect(
      messageContent({ msgType, body: JSON.stringify({ url }) }).attachments?.[0],
    ).toMatchObject({ kind, url })
  expect(
    messageContent({
      msgType: 2,
      body: {
        mainTitle: { title: '活动' },
        subTitle: { title: '内容' },
        nativeUrl: 'https://music.163.com/topic?id=123',
      },
    }).attachments?.[0],
  ).toMatchObject({
    title: '活动',
    subtitle: '内容',
    actionUrl: 'https://music.163.com/topic?id=123',
  })
  expect(
    messageContent({ msgType: 49, body: { name: '文档.pdf' } }).attachments?.[0],
  ).toMatchObject({ kind: 'file', title: '文档.pdf' })
  expect(messageContent({ msgType: 0, text: { textBody: '新格式正文' } }).text).toBe('新格式正文')
})
it('preserves literal text and refuses executable, local, credentialed or non-Netease links', () => {
  expect(
    richMessageContent({
      msgType: 5,
      body: {
        videoUrl: 'file:///local.mp4',
        playUrlInfo: { url: 'https://m10.music.126.net/clip.mp4' },
      },
    }).attachments?.[0].url,
  ).toBe('https://m10.music.126.net/clip.mp4')
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://127.0.0.1/a',
    'https://user:pass@example.test/a',
  ])
    expect(mediaUrl(url)).toBeUndefined()
  expect(musicMessageLink('https://music.163.com.evil.test/song?id=1')).toBeUndefined()
  expect(musicMessageLink('orpheus://song/123')).toBe('https://music.163.com/song?id=123')
  expect(
    richMessageContent({ image: { url: 'file:///etc/passwd' } }).attachments?.[0].url,
  ).toBeUndefined()
  expect(messageContent({ msg: '<script>alert(1)</script>' }).text).toBe(
    '<script>alert(1)</script>',
  )
})
it('sends the official sticker envelope and deduplicates echoes by media as well as text', () => {
  const args = {
    roomId: 'r',
    chatRoomId: '9',
    text: '[开心]',
    emoji,
    requestId: '11111111-1111-4111-8111-111111111111',
  }
  expect(JSON.parse((multiPayload('multiChatSend', args) as any).clientExt).emoji).toEqual(emoji)
  expect(() =>
    validate({
      method: 'multiChatSend',
      args: {
        roomId: 'r',
        text: '[开心]',
        emoji: { ...emoji, emojiImgUrl: 'file:///etc/passwd' },
        requestId: args.requestId,
      },
    }),
  ).toThrow('表情')
  const server = parseChatPage(
    {
      data: {
        records: [
          {
            roomId: 'r',
            sendUid: 1,
            sendTime: 1000,
            msgType: 0,
            emoji,
            imChatRoomMsgBody: { text: '[开心]' },
          },
        ],
        page: {},
      },
    },
    'r',
    '1',
  ).messages[0]
  const local = { ...server, id: 'local', time: 950, delivery: 'submitted' as const, echoAfter: 0 }
  expect(mergeChat([local], [server])).toEqual([server])
  expect(
    mergeChat(
      [{ ...local, emoji: { ...emoji, emojiImgUrl: 'https://p1.music.126.net/other.gif' } }],
      [server],
    ),
  ).toHaveLength(2)
})

it('distinguishes a generated attachment preview from the same words typed by the sender', () => {
  const picture = { picInfo: { url: 'https://p1.music.126.net/test.png' } }
  expect(messageContent(picture)).toMatchObject({ text: '图片', previewOnlyText: true })
  expect(messageContent({ ...picture, msg: '图片' }).previewOnlyText).toBeUndefined()
})

it('changes generated labels while preserving sender text, attachment names and room message IDs', () => {
  const previous = getUiLanguage()
  try {
    const record = { sendUid: 1, sendTime: 1, msgType: 2, nickname: '歌曲' }
    const body = { data: { records: [record], page: {} } }
    setUiLanguage('zh-CN')
    const unnamedPeer = { uid: '123', nickname: '' }
    expect(conversationName(unnamedPeer)).toBe('用户 123')
    const original = parseChatPage(body, 'room', '1').messages[0]
    setUiLanguage('en')
    expect(conversationName(unnamedPeer)).toBe('User 123')
    expect(conversationName({ ...unnamedPeer, nickname: '用户 123' })).toBe('用户 123')
    const translated = parseChatPage(body, 'room', '1').messages[0]
    expect(translated.id).toEqual(original.id)
    expect(roomActivityPresentation(original)).toMatchObject({
      label: 'Recommended',
      parts: [
        { kind: 'actor', text: '歌曲' },
        { kind: 'text', text: ' · Recommended a song' },
      ],
    })
    const unnamed = messageContent({ image: { url: 'https://p1.music.126.net/cover.png' } })
    const named = messageContent({
      image: { name: '图片', url: 'https://p1.music.126.net/cover.png' },
    })
    expect(ui(unnamed.text, unnamed.fallbackTextEn!)).toBe('Image')
    expect(named.text).toBe('图片')
    expect(named.fallbackTextEn).toBeUndefined()
    expect(messageContent({ msg: '邀请你加入官方多人一起听' }).fallbackTextEn).toBeUndefined()
  } finally {
    setUiLanguage(previous)
  }
})

it('keeps distinct room sends with the same timestamp through overlapping history pages', () => {
  const event = { roomId: 'r', sendUid: 1, sendTime: 1000, msgType: 0 }
  const records = ['第一条', '第二条'].map((text) => ({ ...event, imChatRoomMsgBody: { text } }))
  const page = parseChatPage({ data: { records, page: {} } }, 'r', '1')
  expect(page.messages).toHaveLength(2)
  expect(mergeChat(page.messages, page.messages)).toHaveLength(2)
})

it('keeps a text send separate from media with the same preview, including records without an ID', () => {
  const message = { fromUser: { userId: 7 }, toUser: { userId: 8 }, time: 10 }
  const page = parsePrivatePage(
    {
      msgs: [
        { ...message, msg: { msg: '图片' } },
        { ...message, msg: { picInfo: { url: 'https://p1.music.126.net/a.png' } } },
        { ...message, msg: { picInfo: { url: 'https://p1.music.126.net/b.png' } } },
      ],
    },
    '7',
    '8',
  )
  expect(page.messages).toHaveLength(3)
  const [plain] = page.messages.filter((m) => !m.attachments)
  const photos = page.messages.filter((m) => m.attachments)
  const sending = { ...plain, id: 'local:text', delivery: 'submitted' as const }
  expect(mergePrivate([sending], photos)).toHaveLength(3)
  expect(mergePrivate([sending, ...photos], page.messages)).toEqual(page.messages)
})

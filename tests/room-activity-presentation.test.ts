import { expect, it } from 'vitest'
import { parseChatPage } from '../src/shared/chat'
import { roomActivityText } from '../src/shared/room-activity'
import { roomActivityPresentation } from '../src/shared/room-activity-presentation'
import type { ChatMessage } from '../src/shared/types'

const activity = (nickname: string, text: string, ...titles: string[]) => {
  const result = roomActivityPresentation({
    nickname,
    text,
    attachments: titles.map((title) => ({ kind: 'resource', resourceType: 'song', title })),
  })
  expect(result.parts.map((part) => part.text).join('')).toBe(result.text)
  return result
}
const songs = (result: ReturnType<typeof activity>) =>
  result.parts.filter((part) => part.kind === 'song').map((part) => part.text)
const parsedActivity = (overrides: Record<string, unknown> = {}): ChatMessage =>
  parseChatPage(
    {
      data: {
        records: [
          {
            roomId: 'room',
            sendUid: '9',
            sendTime: 1000,
            nickname: '文字恋',
            msgType: 2,
            imChatRoomMsgBody: {
              text: '文字恋来了，带来歌曲 スマトラ警備隊 (feat. 初音ミク) - 椎名もた,初音ミク',
            },
            resourceInfo: {
              resourceId: '123',
              title: 'スマトラ警備隊 (feat. 初音ミク)',
              artistName: ['椎名もた', '初音ミク'],
            },
            ...overrides,
          },
        ],
        page: { more: false },
      },
    },
    'room',
    '1',
  ).messages[0]

it('presents the actual join-with-song template as one complete activity, without repeated metadata', () => {
  const message = parsedActivity()
  const result = roomActivityPresentation(message)
  expect(message.kind).toBe('resource')
  expect(result).toMatchObject({ type: 'join', label: '加入', icon: 'user-plus' })
  expect(result.text).toBe(message.text)
  expect(result.parts[0]).toEqual({ kind: 'actor', text: '文字恋' })
  expect(songs(result)).toEqual(['スマトラ警備隊 (feat. 初音ミク)'])
  expect(result.text.match(/文字恋/g)).toHaveLength(1)
  expect(result.text.match(/スマトラ警備隊/g)).toHaveLength(1)
})

it.each([
  ['来了，带来歌曲 我们俩 - 郭顶', 'join', '加入', 'user-plus'],
  ['推荐了歌曲：《我们俩 - 郭顶》', 'recommend', '推荐', 'music-2'],
  ['UP了《我们俩》', 'promote', '置顶', 'arrow-up-to-line'],
  ['置顶了歌曲《我们俩》', 'promote', '置顶', 'arrow-up-to-line'],
  ['浅赞一下《我们俩》', 'like', '点赞', 'thumbs-up'],
  ['为歌曲《我们俩》点赞', 'like', '点赞', 'thumbs-up'],
  ['红心了歌曲《我们俩》', 'redheart', '红心', 'heart'],
  ['退出了房间', 'leave', '离开', 'log-out'],
  ['发生了新的事情', 'notice', '动态', 'info'],
])('recognizes a leading official action: %s', (action, type, label, icon) => {
  const result = activity('[晚风].*', `[晚风].*${action}`)
  expect(result).toMatchObject({ type, label, icon })
  expect(result.parts[0]).toEqual({ kind: 'actor', text: '[晚风].*' })
})

it('adds a missing actor once while preserving the whole server sentence and artist names', () => {
  const text = '推荐了歌曲：《Love Yourself - 艾志恒Asen》\n完整附言，不应裁剪'
  const result = activity('晚风', text, 'Love Yourself', 'Love Yourself')
  expect(result.text).toBe(`晚风 · ${text}`)
  expect(songs(result)).toEqual(['Love Yourself'])
})

it('does not confuse a nickname prefix, a lyric, or a title keyword with an event', () => {
  for (const [nickname, text] of [
    ['文字', '文字恋来了，带来歌曲 我们俩 - 郭顶'],
    ['晚风', '我喜欢的歌词是“你离开了我”'],
    ['晚风', '歌曲《来了，推荐了歌曲》'],
    ['晚风', '来了又走，留下了一首歌'],
    ['晚风', '推荐了歌曲的那个朋友说再见'],
    ['晚风', '浅赞一下《我们俩》的歌词很好'],
  ]) {
    const result = activity(nickname, text, '红心了歌曲')
    expect(result).toMatchObject({ type: 'notice', icon: 'info' })
    expect(result.text).toContain(text)
  }
  expect(activity('文字', '文字恋来了，带来歌曲 我们俩 - 郭顶').text).toBe(
    '文字 · 文字恋来了，带来歌曲 我们俩 - 郭顶',
  )
})

it('highlights complete titles, keeping distinct short titles rather than matching fragments', () => {
  const result = activity(
    '晚风',
    '晚风推荐了歌曲：《Love Yourself - Artist》',
    'Love Yourself',
    'Love',
    'Yourself',
    'Love',
  )
  expect(result.text).toBe('晚风推荐了歌曲：《Love Yourself - Artist》 · Love / Yourself')
  expect(songs(result)).toEqual(['Love Yourself', 'Love', 'Yourself'])
})

it('uses official templates without metadata and leaves ambiguous unstructured titles intact', () => {
  const complete = activity('晚风', '晚风浅赞一下《 Love - Yourself 》！')
  expect(songs(complete)).toEqual(['Love - Yourself'])
  const ambiguous = activity('晚风', '晚风来了，带来歌曲 A - B - C')
  expect(songs(ambiguous)).toEqual([])
  expect(ambiguous.text).toBe('晚风来了，带来歌曲 A - B - C')
})

it.each([
  [5, '收藏了这首歌', 'redheart', '红心', 'heart'],
  [3, '红心了歌曲《我们俩》', 'like', '点赞', 'thumbs-up'],
] as const)(
  'keeps official interaction type %i distinct even when the wording differs',
  (interactType, text, type, label, icon) => {
    const message = parsedActivity({ msgType: 1, interactType, imChatRoomMsgBody: { text } })
    expect(message).toMatchObject({ kind: 'interaction', interactType })
    expect(roomActivityPresentation(message)).toMatchObject({ type, label, icon })
  },
)

it('accepts only safe integer interaction metadata on interaction records', () => {
  for (const interactType of ['5', 5.5, NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(parsedActivity({ msgType: 1, interactType }).interactType).toBeUndefined()
  expect(parsedActivity({ msgType: 2, interactType: 5 }).interactType).toBeUndefined()
  expect(roomActivityPresentation(parsedActivity({ msgType: 2, interactType: 5 })).type).toBe(
    'join',
  )
})

it('preserves unknown content as literal text and does not treat an album as a song', () => {
  const message = {
    nickname: '晚风',
    text: '<script>推荐了歌曲</script>',
    attachments: [{ kind: 'resource' as const, resourceType: 'album', title: '范特西' }],
  }
  const original = structuredClone(message)
  const result = roomActivityPresentation(message)
  expect(result.type).toBe('notice')
  expect(result.text).toBe('晚风 · <script>推荐了歌曲</script> · 范特西')
  expect(songs(result)).toEqual([])
  expect(message).toEqual(original)
  expect(roomActivityText({ nickname: '', text: '', attachments: [] })).toBe('')
  expect(activity('晚风', '').parts).toEqual([{ kind: 'actor', text: '晚风' }])
})

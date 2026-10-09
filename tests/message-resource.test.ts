import { expect, it } from 'vitest'
import { attachmentMusicResource, messageMusicResource } from '../src/shared/message-resource'

it.each([
  ['https://music.163.com/album?id=123', { type: 'album', id: '123' }],
  ['https://music.163.com/#/album?id=123', { type: 'album', id: '123' }],
  ['orpheus://song/123', { type: 'song', id: '123' }],
  ['orpheus://album/123', { type: 'album', id: '123' }],
  ['https://music.163.com/album?id=123&id=456', undefined],
  ['https://music.163.com.evil.test/album?id=123', undefined],
  ['https://music.163.com/album?id=0', undefined],
  ['https://music.163.com/album?id=123abc', undefined],
  ['file:///album?id=123', undefined],
])('routes only exact official music resources: %s', (value, expected) => {
  expect(messageMusicResource(value)).toEqual(expected)
})

it('uses exact attachment metadata before official URL fallback', () => {
  expect(
    attachmentMusicResource({
      kind: 'resource',
      title: '专辑',
      resourceType: 'album',
      resourceId: '888',
    }),
  ).toEqual({ type: 'album', id: '888' })
  expect(
    attachmentMusicResource({ kind: 'resource', title: '专辑', actionUrl: 'orpheus://album/888' }),
  ).toEqual({ type: 'album', id: '888' })
})

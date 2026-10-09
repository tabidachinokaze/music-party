import { expect, it } from 'vitest'
import {
  boundaryCovers,
  privateReadBoundary,
  sortPrivateContacts,
} from '../src/shared/private-activity'
import type { Conversation, PrivateMessage } from '../src/shared/types'

const message = (
  id: string,
  time: number,
  changes: Partial<PrivateMessage> = {},
): PrivateMessage => ({
  id,
  time,
  senderId: '8',
  recipientId: '9',
  text: 'fixture',
  invitations: [],
  ...changes,
})

it('uses authoritative incoming IDs at the latest millisecond and rejects same-time unseen notifications', () => {
  const boundary = privateReadBoundary(
    [
      message('server:9223372036854775001', 1000),
      message('server:9223372036854775002', 1000),
      message('server:10', 999),
    ],
    '8',
  )
  expect(boundary).toEqual({
    time: 1000,
    messageIds: ['9223372036854775001', '9223372036854775002'],
  })
  expect(boundaryCovers(boundary!, 1000, '9223372036854775001')).toBe(true)
  expect(boundaryCovers(boundary!, 1000, '9223372036854775003')).toBe(false)
  expect(boundaryCovers(boundary!, 1000)).toBe(false)
  expect(boundaryCovers(boundary!, 999, 'older')).toBe(true)
  expect(boundaryCovers(boundary!, 1001, '9223372036854775001')).toBe(false)
})

it('cannot acknowledge optimistic sends, guessed IDs or the other participant’s outgoing messages', () => {
  const messages = [
    message('server:1', 1000),
    message('local:fixture', 5000, { delivery: 'sending' }),
    message('8:9:6000:fixture', 6000),
    message('server:2', 7000, { senderId: '9', recipientId: '8' }),
    message('server:3', 8000, { delivery: 'submitted' }),
  ]
  expect(privateReadBoundary(messages, '8')).toEqual({ time: 1000, messageIds: ['1'] })
  expect(privateReadBoundary(messages.slice(1), '8')).toBeNull()
  expect(boundaryCovers(undefined, 1000, '1')).toBe(false)
})

it('includes resource-only incoming messages in the read boundary', () => {
  expect(
    privateReadBoundary(
      [
        message('server:42', 2000, {
          text: '',
          attachments: [{ kind: 'image', title: 'fixture' }],
        }),
      ],
      '8',
    ),
  ).toEqual({ time: 2000, messageIds: ['42'] })
})

it('puts explicitly online peers first, orders each group by activity, and preserves its input', () => {
  const peer = (uid: string, time: number, online?: boolean | null): Conversation => ({
    uid,
    time,
    online,
    nickname: `Peer ${uid}`,
    avatar: '',
    preview: '',
    unread: 0,
  })
  const contacts = [
    peer('1', 5000, false),
    peer('2', 1000, true),
    peer('3', 2000, true),
    peer('4', 6000, null),
  ]
  expect(sortPrivateContacts(contacts).map((person) => person.uid)).toEqual(['3', '2', '4', '1'])
  expect(contacts.map((person) => person.uid)).toEqual(['1', '2', '3', '4'])
})

it('does not treat a missing presence result as online and deterministically breaks same-time ties', () => {
  const contacts: Conversation[] = ['8', '2', '9'].map((uid) => ({
    uid,
    nickname: uid,
    avatar: '',
    preview: '',
    unread: 0,
    time: 1000,
  }))
  expect(sortPrivateContacts(contacts).map((person) => person.uid)).toEqual(['2', '8', '9'])
})

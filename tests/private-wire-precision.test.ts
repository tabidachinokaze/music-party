import { expect, it } from 'vitest'
import { parsePreciseJson, preciseMediaEndpoint } from '../src/main/precise-json'
import { parsePrivatePage } from '../src/shared/private-messages'
import { privateReadBoundary, boundaryCovers } from '../src/shared/private-activity'

it('marks both EAPI and legacy WEAPI private history replies for precise parsing', () => {
  for (const url of [
    'https://music.163.com/weapi/msg/private/history',
    'https://music.163.com/weapi/msg/private/users',
    'https://music.163.com/api/msg/private/history',
    'https://music.163.com/eapi/communication/send/msg',
  ])
    expect(preciseMediaEndpoint(url)).toBe(true)
})

it('keeps the official numeric HTTP ID identical to its Mini notification ID for same-time reads', () => {
  const body = parsePreciseJson(
    `{"code":200,"msgs":[{"id":9223372036854775001,"time":1700000000000,"fromUser":{"userId":8},"toUser":{"userId":9},"msg":"{\\"type\\":1,\\"msg\\":\\"fixture\\"}"}],"more":false}`,
  )
  const page = parsePrivatePage(body, '9', '8')
  expect(page.messages[0].id).toBe('server:9223372036854775001')
  const boundary = privateReadBoundary(page.messages, '8')
  expect(boundaryCovers(boundary!, 1700000000000, '9223372036854775001')).toBe(true)
  expect(boundaryCovers(boundary!, 1700000000000, '9223372036854775002')).toBe(false)
})

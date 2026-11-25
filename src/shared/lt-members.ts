import { ui } from './ui-language'
// SPDX-License-Identifier: AGPL-3.0-only
// Wire format verified against com.netease.cloudmusic.module.listentogether.im.LTMultiUserChangeMsg:
// the IM business envelope carries serverExt.type = 30005 and serverExt.content is a
// LTMultiRoomUserList JSON object (`version`, `onlineNums`, `onlineUserInfos`).
import type { Member } from './types'

export interface LtMemberUpdate {
  roomId: string
  version: number
  onlineCount: number | null
  members: Member[]
}
const MAX_ENVELOPE = 512 * 1024
const MAX_MEMBERS = 500
const MAX_TEXT = 160

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    if (!value || value.length > MAX_ENVELOPE) return null
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function uid(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  return /^[1-9]\d{0,23}$/.test(text) ? text : ''
}
function roomId(value: unknown): string {
  const text = typeof value === 'string' ? value : ''
  return /^[\w-]{1,128}$/.test(text) ? text : ''
}
function text(value: unknown, fallback: string) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, MAX_TEXT) || fallback
    : fallback
}
function contentEnvelope(content: unknown): Record<string, unknown> | null {
  const envelope = record(content)
  if (!envelope) return null
  const ext = record(envelope.serverExt) ?? record(envelope.remoteExtension)?.serverExt
  const serverExt = record(ext)
  if (!serverExt || Number(serverExt.type) !== 30005) return null
  return record(serverExt.content) ?? record(serverExt.data)
}

/**
 * Decode an LTMultiUserChangeMsg from an IM notification or chatroom message.
 * Returns null for every other business so malformed/unknown traffic cannot
 * interrupt the room member polling fallback.
 */
export function parseLtMemberUpdate(content: unknown): LtMemberUpdate | null {
  try {
    const envelope = record(content)
    const data = contentEnvelope(content) ?? contentEnvelope(envelope?.data)
    if (!data) return null
    const raw = data.onlineUserInfos ?? data.onlineUsers ?? data.roomUsers
    if (!Array.isArray(raw) || raw.length > MAX_MEMBERS) return null
    const members: Member[] = []
    const seen = new Set<string>()
    for (const item of raw) {
      const member = record(item)
      if (!member) continue
      const id = uid(member.uid ?? member.userId)
      if (!id || seen.has(id)) continue
      seen.add(id)
      members.push({
        uid: id,
        nickname: text(member.nickname ?? member.nickName, ui('听友', 'Listener')),
        avatar: text(member.avatar ?? member.avatarUrl, ''),
      })
    }
    const seq = (value: unknown) =>
      Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0
    const version = seq(data.version) || seq(data.serverSeq)
    const onlineCount =
      Number.isInteger(data.onlineNums) && (data.onlineNums as number) >= 0
        ? (data.onlineNums as number)
        : members.length
    const resolvedRoom =
      roomId(data.roomId) ||
      roomId(envelope?.roomId) ||
      roomId(record(envelope?.clientExt)?.roomId) ||
      ''
    return { roomId: resolvedRoom, version, onlineCount, members }
  } catch {
    return null
  }
}

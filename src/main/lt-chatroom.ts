// SPDX-License-Identifier: AGPL-3.0-only
// The official multi-listen chatroom is a NIM chatroom.  The Android client logs in
// with this appKey and the account/token returned by
// /api/middle/im/token-and-chatroom-addr/get (bizName=music_listenTogether,
// roomId=chatRoomId, appType=6).  LTMultiUserChangeMsg arrives as a custom chatroom
// message whose `custom` JSON contains serverExt.type=30005.
import { createRequire } from 'node:module'
import { parseLtMemberUpdate, type LtMemberUpdate } from '../shared/lt-members'

const APP_KEY = '3a6a3e48f6854dfa4e4464f3bdaec3b4'
const FALLBACK_ADDRESSES = ['chatwl01.yunxinfw.com:443', 'chatwl02.yunxinfw.com:443']
const requireSdk = createRequire(__filename)

export interface LtChatroomOptions {
  chatroomId: string
  account: string
  token: string
  onUpdate: (update: LtMemberUpdate) => void
  onStatus?: (status: string, data?: unknown) => void
  onDebug?: (raw: unknown, type: unknown) => void
}

function errorText(value: unknown) {
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

let cachedAddresses: string[] | null = null
async function chatroomAddresses(): Promise<string[]> {
  if (cachedAddresses) return cachedAddresses
  try {
    const response = await fetch(`https://lbs.netease.im/lbs/webconf.jsp?appkey=${APP_KEY}`, {
      signal: AbortSignal.timeout(8000),
    })
    const body: any = await response.json()
    const links = Array.isArray(body?.common?.link) ? body.common.link : []
    const chat = links.filter(
      (value: unknown): value is string =>
        typeof value === 'string' && value.includes('chatwl') && value.includes('.'),
    )
    if (chat.length) cachedAddresses = chat
  } catch {}
  return cachedAddresses || FALLBACK_ADDRESSES
}

export class LtChatroom {
  private instance: any = null
  private closed = false
  constructor(
    private readonly options: LtChatroomOptions,
    private readonly addresses: string[],
  ) {}

  static async open(options: LtChatroomOptions): Promise<LtChatroom> {
    // The Node.js NIM build polyfills navigator on globalThis; Node 22+ exposes a
    // read-only navigator getter, so remove it before loading the SDK.
    try {
      delete (globalThis as any).navigator
    } catch {}
    const Chatroom = requireSdk('@yxim/nim-web-sdk/dist/SDK/NIM_Web_Chatroom_nodejs.js')
    const addresses = await chatroomAddresses()
    const room = new LtChatroom(options, addresses)
    room.start(Chatroom)
    return room
  }

  private start(Chatroom: any) {
    const { chatroomId, account, token, onUpdate, onStatus, onDebug } = this.options
    let connected = false
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      onStatus?.('timeout')
      this.close()
    }, 15000)
    timer.unref?.()
    try {
      this.instance = Chatroom.getInstance({
        appKey: APP_KEY,
        account,
        token,
        chatroomId,
        chatroomNick: 'music-party',
        chatroomAvatar: ' ',
        // appLogin=1: use the already logged-in IM account/token, matching the
        // official client's non-independent chatroom mode.
        autoconnect: false,
        chatroomAddresses: this.addresses,
        secure: true,
        debug: false,
        onconnect: () => {
          connected = true
          if (!settled) {
            settled = true
            clearTimeout(timer)
          }
          onStatus?.('connected', { chatroomId })
        },
        ondisconnect: (error: unknown) => {
          if (this.closed) return
          if (!connected && !settled) {
            settled = true
            clearTimeout(timer)
          }
          onStatus?.('disconnected', errorText(error))
        },
        onerror: (error: unknown) => onStatus?.('error', errorText(error)),
        onkicked: (error: unknown) => onStatus?.('kicked', errorText(error)),
        onmsgs: (messages: any[]) => {
          if (!Array.isArray(messages)) return
          for (const message of messages) {
            try {
              const raw = typeof message?.custom === 'string' ? message.custom : message?.custom
              onDebug?.(raw, message?.type)
              const update = parseLtMemberUpdate(raw)
              if (update) {
                onStatus?.('members', { count: update.members.length, version: update.version })
                onUpdate(update)
              }
            } catch {}
          }
        },
      })
    } catch (error) {
      settled = true
      clearTimeout(timer)
      onStatus?.('failed', errorText(error))
      throw error
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    try {
      this.instance?.disconnect()
    } catch {}
    this.instance = null
  }
}

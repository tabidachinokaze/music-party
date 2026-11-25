import { t } from '../shared/ui-language'
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from tabidachinokaze/folium-mod-music-party at b01525f.
// Source: https://github.com/tabidachinokaze/folium-mod-music-party
import { connect, type Socket } from 'node:net'
import { constants, createPublicKey, publicEncrypt, randomBytes, randomUUID } from 'node:crypto'
import {
  embedded,
  frame,
  FrameReader,
  packet,
  properties,
  readProperties,
  streamCipher,
} from './mini-codec'
import { parseMatchNotice, type MatchNotice } from '../shared/match-notice'

// src/main/mini-notifications.ts
export const MUSIC_MINI_APP_KEY = '688ebe2a6a7da3d1125936d9ee8b0966'
// Public service key distributed in the official mini client (SPKI, version 0).
const PUBLIC_KEY = createPublicKey({
  key: Buffer.from(
    'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCBxLuL8+xpQSddSnSvPkvNOHdcr5Euqw+kkOSzO/buDMheCfFILRC/v5+nv8BsL7/YZWVpDA8sIBTxfNRqSCu0uLjlbJqT/sMnPT1xxdQrkb1HSnuSyTbZbqaInQ13tBE2SfcAhsQZJJ1hKQSE2QyKOMxQPhP583qcsIhDbdExvwIDAQAB',
    'base64',
  ),
  format: 'der',
  type: 'spki',
})
export interface MiniNotice {
  timestamp: number
  notice: MatchNotice
}
export interface MiniNotificationOptions {
  persistent?: boolean
  onNotification?: (content: unknown, timestamp: number) => void
  onClose?: (reason: string) => void
}
export class MiniNotifications {
  private socket: Socket | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null
  private rejectLogin: ((error: Error) => void) | null = null
  private ended = false
  private failure = t('common.theMatchingNotificationConnectionHasClosed')
  private touched = Date.now()
  private notices: MiniNotice[] = []
  private serial = 2
  private seen = new Set<string>()
  constructor(private readonly options: MiniNotificationOptions = {}) {}
  async open(credentials: { accId: string; token: string }): Promise<void> {
    if (this.ended || this.socket)
      throw new Error(t('common.theMatchingNotificationConnectionHasClosed'))
    if (
      typeof credentials?.accId !== 'string' ||
      !credentials.accId.trim() ||
      credentials.accId.length > 1024 ||
      typeof credentials.token !== 'string' ||
      !credentials.token.trim() ||
      credentials.token.length > 4096
    )
      throw new Error(t('miniNotifications.couldNotObtainValidNeteaseNotificationCredentials'))
    const key = randomBytes(16),
      encrypt = streamCipher(key),
      decrypt = streamCipher(key)
    const reader = new FrameReader()
    // Service product 6 is music mini. Client type 64 keeps this desktop session separate from phones.
    let login: Buffer | null = frame(
      2,
      2,
      this.serial,
      properties({
        3: 64,
        6: 6,
        8: 0,
        9: 1,
        18: MUSIC_MINI_APP_KEY,
        19: credentials.accId.toLowerCase(),
        25: 'music-party',
        26: randomUUID(),
        1000: credentials.token,
      }),
    )
    const plaintext = Buffer.concat([properties({ 0: key }), login])
    const encrypted: Buffer[] = []
    for (let offset = 0; offset < plaintext.length; offset += 117)
      encrypted.push(
        publicEncrypt(
          { key: PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING },
          plaintext.subarray(offset, offset + 117),
        ),
      )
    plaintext.fill(0)
    key.fill(0)
    const handshake = frame(
      1,
      5,
      1,
      Buffer.concat([
        properties({ 0: 6, 1: 0, 2: 0, 3: 1, 4: 1, 7: 0, 8: MUSIC_MINI_APP_KEY }),
        ...encrypted,
      ]),
    )
    return new Promise((resolve, reject) => {
      this.rejectLogin = reject
      const socket = (this.socket = connect({ host: 'link-music-main.netease.im', port: 8080 }))
      const send = (service: number, command: number, body?: Buffer) => {
        if (!this.ended)
          socket.write(
            encrypt(frame(service, command, (this.serial = (this.serial % 998) + 1), body)),
          )
      }
      const stop = (message: string) => {
        login?.fill(0)
        login = null
        this.close(message)
      }
      let authenticated = false
      let receivedAt = Date.now()
      const receive = (value: ReturnType<typeof packet>, depth = 0) => {
        if (depth > 3) throw new Error(t('miniNotifications.invalidMatchingNotificationEnvelope'))
        if (value.service === 1 && value.command === 5) {
          if (value.status !== 200 || !login)
            throw new Error(
              t('miniNotifications.matchingNotificationHandshakeFailed', { status: value.status }),
            )
          socket.write(encrypt(login))
          login.fill(0)
          login = null
        } else if (value.service === 2 && value.command === 2) {
          if (value.status !== 200)
            throw new Error(
              t('miniNotifications.matchingNotificationSignInFailed', { status: value.status }),
            )
          authenticated = true
          if (this.deadline) clearTimeout(this.deadline)
          this.deadline = null
          if (!this.options.persistent) {
            this.deadline = setTimeout(
              () => stop(t('common.theMatchingNotificationConnectionHasExpiredTryAgain')),
              150000,
            )
            this.deadline.unref()
          }
          this.rejectLogin = null
          this.touched = Date.now()
          resolve()
        } else if (value.service === 2 && value.command === 5) {
          throw new Error(t('miniNotifications.anotherDeviceClosedTheMatchingConnectionTryAgain'))
        } else if (value.service === 4 && [1, 2, 10, 11].includes(value.command) && authenticated) {
          const inner = embedded(value.body, value.command === 2 ? 0 : 1),
            deliveryId = inner.id.readBigInt64LE(),
            id = inner.id.toString('hex')
          if (inner.packet.service === 7 && inner.packet.command === 3 && deliveryId > 0n) {
            send(4, 3, Buffer.concat([inner.id, inner.header]))
          }
          // Zero/negative IDs are unacknowledged envelopes, not unique deliveries.
          // They must all be dispatched, even when different businesses share ID 0.
          if (deliveryId <= 0n) {
            receive(inner.packet, depth + 1)
          } else if (!this.seen.has(id)) {
            if (this.seen.size >= 128) this.seen.delete(this.seen.values().next().value!)
            this.seen.add(id)
            receive(inner.packet, depth + 1)
          }
        } else if (value.service === 7 && value.command === 3 && authenticated) {
          const fields = readProperties(value.body),
            notice = parseMatchNotice(fields.get(5))
          const timestamp = Number(fields.get(0))
          if (notice && Number.isFinite(timestamp) && timestamp > 0) {
            if (this.notices.length >= 16) this.notices.shift()
            this.notices.push({ timestamp, notice })
          }
          if (Number.isFinite(timestamp) && timestamp > 0) {
            // One malformed business must not break another subscriber or its envelope ACK.
            try {
              this.options.onNotification?.(fields.get(5), timestamp)
            } catch {}
          }
        }
      }
      socket.setNoDelay(true)
      socket.once('connect', () => {
        if (!this.ended) socket.write(handshake)
      })
      socket.on('data', (bytes) => {
        if (this.ended) return
        try {
          for (const bytesFrame of reader.push(
            decrypt(typeof bytes === 'string' ? Buffer.from(bytes) : bytes),
          )) {
            receivedAt = Date.now()
            receive(packet(bytesFrame))
          }
        } catch (error) {
          stop(
            error instanceof Error
              ? error.message
              : t('miniNotifications.invalidMatchingNotificationData'),
          )
        }
      })
      socket.on('error', () =>
        stop(t('miniNotifications.couldNotConnectToNeteaseMatchingNotificationsCheck')),
      )
      socket.once('close', () => stop(t('common.disconnectedFromTheMatchingServiceTryAgain')))
      this.deadline = setTimeout(
        () => stop(t('miniNotifications.theMatchingServiceTimedOutTryAgain')),
        12000,
      )
      this.deadline.unref()
      this.heartbeat = setInterval(() => {
        if (!this.options.persistent && Date.now() - this.touched > 20000)
          stop(t('common.theMatchingScreenHasClosed'))
        else if (this.options.persistent && authenticated && Date.now() - receivedAt > 45000)
          stop(t('miniNotifications.neteaseNotificationsTimedOutReconnecting'))
        else if (authenticated) send(1, 2)
      }, 10000)
      this.heartbeat.unref()
    })
  }
  poll(): MiniNotice[] {
    if (this.ended) throw new Error(this.failure)
    this.touched = Date.now()
    return this.notices.splice(0)
  }
  close(reason = t('common.matchingCanceled')) {
    if (this.ended) return
    this.ended = true
    this.failure = reason
    if (this.deadline) clearTimeout(this.deadline)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.deadline = this.heartbeat = null
    this.socket?.destroy()
    this.socket = null
    this.notices.length = 0
    this.seen.clear()
    this.rejectLogin?.(new Error(reason))
    this.rejectLogin = null
    try {
      this.options.onClose?.(reason)
    } catch {}
  }
}

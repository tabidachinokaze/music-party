import { t } from '../shared/ui-language'
import type { Method, Reply, Request, Trace } from '../shared/types'
import { redact, SerialCommands } from '../shared/protocol'
import { CHAT_MAX_LENGTH, chatTrace } from '../shared/chat'
import {
  PRIVATE_METHODS,
  PRIVATE_TEXT_LIMIT,
  SEND_METHODS,
  inviteText,
  privateTrace,
} from '../shared/private-messages'
import { multiEndpoints, multiMutations } from './multi-api'
import { parseEmoji } from '../shared/message-content'
import { normalizeStickerPage } from './stickers'
import { stickerMutationResult, stickerDeletePayload } from '../shared/stickers'
import { PrivatePresence } from './private-presence'
import { assertRoomCurrentSong } from './room-validation'

type Invoke = (
  endpoint: string,
  args: Record<string, unknown>,
) => Promise<{ body: any; cookie?: string[] }>
const endpoints: Record<Method, string> = {
  account: 'login_status',
  qrCreate: 'login_qr_key',
  qrCheck: 'login_qr_check',
  logout: '',
  search: 'cloudsearch',
  song: 'song_detail',
  stream: 'song_url_v1',
  playlists: 'user_playlist',
  playlist: 'playlist_detail',
  playlistAdd: 'api',
  albums: 'album_sublist',
  album: 'album',
  likes: 'likelist',
  like: 'like',
  lyrics: 'lyric',
  artistSongs: 'artist_songs',
  privateConversations: 'msg_private',
  privateHistory: 'msg_private_history',
  privateRead: 'api',
  privateSend: 'send_text',
  privateInvite: 'send_text',
  privateSticker: 'api',
  privatePresence: 'api',
  stickerGroups: 'api',
  stickerPage: 'api',
  stickerCollect: 'api',
  stickerRemove: 'api',
  follows: 'user_follows',
  ...(Object.fromEntries(Object.keys(multiEndpoints).map((key) => [key, key])) as Record<
    keyof typeof multiEndpoints,
    string
  >),
}
const fields: Partial<Record<Method, string[]>> = {
  privateConversations: ['offset'],
  privateHistory: ['uid', 'before'],
  privateRead: ['uid'],
  privateSend: ['uid', 'text', 'requestId'],
  privateInvite: ['uid', 'roomId', 'requestId'],
  privateSticker: ['uid', 'emoji', 'requestId'],
  privatePresence: ['uid'],
  stickerGroups: ['scope'],
  stickerPage: ['groupId', 'cursor'],
  stickerCollect: ['emojiId', 'emojiGroupId'],
  stickerRemove: ['emojiIds'],
  follows: ['uid', 'offset'],
  qrCheck: ['key'],
  search: ['keywords', 'kind', 'offset'],
  song: ['ids'],
  stream: ['id'],
  playlists: ['uid', 'offset'],
  playlist: ['id'],
  playlistAdd: ['playlistId', 'songId', 'uid'],
  albums: ['offset'],
  album: ['id'],
  likes: ['uid'],
  like: ['id', 'value'],
  lyrics: ['id'],
  artistSongs: ['id', 'offset'],
  multiPreview: ['roomId', 'inviterUid'],
  multiJoin: ['roomId', 'inviterUid'],
  multiCreate: ['songId', 'allowStrangerMatch'],
  multiMatch: ['songId'],
  multiMatchCancel: [],
  multiRematchLeave: ['roomId'],
  multiRedHeart: ['roomId', 'songId', 'bizId'],
  multiStatus: [],
  multiChatHistory: ['roomId', 'cursor'],
  multiChatSend: ['roomId', 'text', 'emoji', 'requestId'],
  multiHeartbeat: ['roomId'],
  multiPlayed: ['roomId', 'cursor'],
  multiQueue: ['roomId', 'cursor'],
  multiSongInfo: ['roomId', 'bizId'],
  multiRemove: ['roomId', 'songId', 'bizId'],
  multiUp: ['roomId', 'songId', 'bizId'],
  multiLike: ['roomId', 'songId', 'bizId'],
  multiLeave: ['roomId'],
  multiAdd: ['roomId', 'songId'],
  multiNext: ['roomId', 'songId', 'bizId'],
}

export function validate(request: Request): Record<string, unknown> {
  if (!request || !Object.hasOwn(endpoints, request.method))
    throw new Error(t('service.unsupportedAction'))
  const args = request.args || {}
  if (typeof args !== 'object' || Array.isArray(args))
    throw new Error(t('service.invalidParameterFormat'))
  const allowed = fields[request.method] || []
  if (Object.keys(args).some((key) => !allowed.includes(key)))
    throw new Error(t('service.theRequestContainsUnsupportedParameters'))
  for (const key of allowed) {
    const value = args[key]
    if (key === 'allowStrangerMatch') {
      if (value !== undefined && typeof value !== 'boolean')
        throw new Error(t('service.invalidRoomVisibility'))
      continue
    }
    if (key === 'emojiIds') {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 100 ||
        !value.every((id) => typeof id === 'string' && /^[1-9]\d{0,23}$/.test(id))
      )
        throw new Error(t('service.selectTheStickersToDelete'))
      continue
    }
    if (key === 'emojiId' || key === 'emojiGroupId') {
      if (
        typeof value !== 'string' ||
        !(key === 'emojiGroupId' ? /^-?\d{1,24}$/ : /^[1-9]\d{0,23}$/).test(value)
      )
        throw new Error(t('service.invalidStickerId'))
      continue
    }
    if (key === 'scope') {
      if (value !== 'room' && value !== 'private')
        throw new Error(t('service.invalidStickerDestination'))
      continue
    }
    if (key === 'groupId') {
      if (typeof value !== 'string' || !/^-?\d{1,24}$/.test(value))
        throw new Error(t('service.invalidStickerGroup'))
      continue
    }
    if (
      value === undefined &&
      ['kind', 'offset', 'cursor', 'before', 'emoji'].includes(key) &&
      !(key === 'emoji' && request.method === 'privateSticker')
    )
      continue
    if (key === 'emoji') {
      const emoji = parseEmoji(value)
      if (!emoji) throw new Error(t('service.invalidStickerInformation'))
      continue
    }
    if (key === 'text') {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > (request.method === 'privateSend' ? PRIVATE_TEXT_LIMIT : CHAT_MAX_LENGTH) ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
      )
        throw new Error(
          t('chat.messageLimit', {
            limit: request.method === 'privateSend' ? PRIVATE_TEXT_LIMIT : CHAT_MAX_LENGTH,
          }),
        )
      continue
    }
    if (key === 'requestId') {
      if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value))
        throw new Error(t('service.invalidMessageRequestId'))
      continue
    }
    if (key === 'cursor') {
      if (typeof value !== 'string' || !value || value.length > 2048)
        throw new Error(t('service.invalidChatHistoryCursor'))
      continue
    }
    if (key === 'before') {
      if (!Number.isSafeInteger(value) || Number(value) < 0)
        throw new Error(t('service.invalidMessagePaginationParameters'))
      continue
    }
    if (key === 'offset') {
      if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1000000)
        throw new Error(t('service.invalidPaginationParameters'))
      continue
    }
    if (key === 'value') {
      if (typeof value !== 'boolean') throw new Error(t('service.invalidFavoriteStatus'))
      continue
    }
    if (key === 'kind') {
      if (!['songs', 'playlists', 'artists'].includes(String(value)))
        throw new Error(t('service.invalidSearchType'))
      continue
    }
    if (typeof value !== 'string' || !value || value.length > (key === 'ids' ? 16000 : 300))
      throw new Error(t('service.missingOrInvalidParameter', { key }))
    if (
      ['id', 'songId', 'inviterUid', 'bizId', 'uid', 'playlistId'].includes(key) &&
      !/^\d{1,24}$/.test(value)
    )
      throw new Error(t('service.invalidTrackOrUserId'))
    if (key === 'ids' && !/^\d{1,24}(,\d{1,24}){0,499}$/.test(value))
      throw new Error(t('service.enterUpTo500CommaSeparatedTrackIds'))
    if (key === 'roomId' && !/^[\w-]{1,128}$/.test(value))
      throw new Error(t('service.invalidRoomId'))
  }
  if (
    PRIVATE_METHODS.has(request.method) &&
    args.uid !== undefined &&
    !/^[1-9]\d{0,23}$/.test(String(args.uid))
  )
    throw new Error(t('service.invalidRecipientOrUserId'))
  if (
    ['multiCreate', 'multiMatch'].includes(request.method) &&
    !/^[1-9]\d{0,23}$/.test(String(args.songId))
  )
    throw new Error(t('service.chooseAFullLengthTrackToStartMatching'))
  if (
    request.method === 'playlistAdd' &&
    !['uid', 'playlistId', 'songId'].every((key) => /^[1-9]\d{0,23}$/.test(String(args[key])))
  )
    throw new Error(t('service.invalidPlaylistTrackOrAccountId'))
  return { ...args }
}

function stripCredentials(value: any): any {
  if (Array.isArray(value)) return value.map(stripCredentials)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/cookie|token|secret|password|authorization/i.test(key))
        .map(([key, item]) => [key, stripCredentials(item)]),
    )
  return value
}

export class ApiService {
  private presence: PrivatePresence
  private cookie = ''
  private epoch = 0
  private uid = ''
  private id = 0
  private mutations = new SerialCommands()
  private activeKey = ''
  private sends = new Map<string, { signature: string; reply: Promise<Reply>; settled: boolean }>()
  constructor(
    private invoke: Invoke,
    private onCookie: (value: string) => void = () => {},
    private onAccount: (uid: string) => void = () => {},
  ) {
    this.presence = new PrivatePresence(invoke, () => this.session())
  }
  restore(cookie: string) {
    this.epoch++
    this.cookie = cookie
    this.uid = ''
    this.activeKey = ''
    this.sends.clear()
    this.presence.clear()
  }
  session() {
    return { cookie: this.cookie, epoch: this.epoch, uid: this.uid }
  }
  async call(request: Request): Promise<Reply> {
    if (!SEND_METHODS.has(request?.method)) return this.execute(request)
    try {
      validate(request)
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
    const key = String(request.args!.requestId)
    const signature = JSON.stringify([
      request.method,
      request.args!.uid,
      request.args!.roomId,
      request.args!.text,
      request.args!.emoji,
    ])
    const existing = this.sends.get(key)
    if (existing)
      return existing.signature === signature
        ? existing.reply
        : {
            ok: false,
            error: t('service.thatMessageRequestIdIsAlreadyInUse'),
          }
    if (this.sends.size >= 100) {
      const oldest = [...this.sends].find(([, entry]) => entry.settled)
      if (oldest) this.sends.delete(oldest[0])
      else
        return {
          ok: false,
          error: t('service.waitForTheCurrentMessageToFinishSending'),
        }
    }
    const entry = { signature, reply: this.execute(request), settled: false }
    this.sends.set(key, entry)
    entry.reply.finally(() => {
      entry.settled = true
    })
    return entry.reply
  }
  private async execute(request: Request): Promise<Reply> {
    const epoch = this.epoch
    const cookie = this.cookie
    const assertSession = () => {
      if (epoch !== this.epoch)
        throw Object.assign(new Error(t('service.theAccountChangedTryAgain')), { code: 409 })
    }
    const invoke: Invoke = async (endpoint, args) => {
      assertSession()
      const result = await this.invoke(endpoint, { ...args, cookie })
      assertSession()
      return result
    }
    const isPrivate = PRIVATE_METHODS.has(request?.method)
    const isChat = request?.method === 'multiChatHistory' || request?.method === 'multiChatSend'
    const traceBody = (body: any) =>
      isPrivate ? privateTrace(body) : isChat ? chatTrace(body) : redact(body)
    let sendAttempted = false
    const start = Date.now()
    const trace: Trace = {
      id: ++this.id,
      time: new Date().toISOString(),
      method: request?.method || 'invalid',
      duration: 0,
      ok: false,
      request: redact(request?.args),
      response: null,
    }
    try {
      const args = validate(request)
      const run = async (_sequence: number) => {
        assertSession()
        const method = request.method
        if (method === 'logout') {
          this.epoch++
          this.cookie = ''
          this.uid = ''
          this.activeKey = ''
          this.sends.clear()
          this.presence.clear()
          this.onCookie('')
          this.onAccount('')
          return { code: 200 }
        }
        if (
          ((method.startsWith('multi') && method !== 'multiPreview') ||
            ['playlists', 'playlistAdd', 'albums', 'likes', 'like'].includes(method) ||
            PRIVATE_METHODS.has(method)) &&
          !this.cookie
        )
          throw new Error(t('service.scanTheQrCodeToSignInFirst'))
        if (method === 'qrCheck' && args.key !== this.activeKey)
          throw new Error(t('service.theQrCodeHasChangedScanTheNew'))
        if (method === 'playlistAdd') {
          const account = await invoke('login_status', { timeout: 12000 })
          const selfUid = String(account.body?.data?.profile?.userId || '')
          if (account.body?.data?.code === 302 || !/^[1-9]\d{0,23}$/.test(selfUid))
            throw new Error(t('common.yourSessionExpiredSignInAgain'))
          if (selfUid !== args.uid)
            throw new Error(t('service.theAccountChangedSelectThePlaylistsAgain'))
          const detail = (await invoke('playlist_detail', { id: args.playlistId, timeout: 12000 }))
            .body
          const playlist = detail?.playlist
          if (
            Number(detail?.code) !== 200 ||
            String(playlist?.id) !== args.playlistId ||
            String(playlist?.creator?.userId) !== selfUid
          )
            throw new Error(t('service.youCanOnlyAddTracksToPlaylistsCreated'))
          if (Number(playlist.specialType) === 5)
            throw new Error(t('service.useTheHeartButtonToAddThisTrack'))
          if (!Array.isArray(playlist.trackIds))
            throw new Error(t('service.couldNotVerifyThePlaylistContentsRefreshAnd'))
          if (playlist.trackIds.some((track: any) => String(track.id) === args.songId))
            return { code: 200, alreadyExists: true }
          args.data = {
            op: 'add',
            pid: args.playlistId,
            trackIds: JSON.stringify([args.songId]),
            imme: 'true',
          }
          args.uri = '/api/playlist/manipulate/tracks'
          args.crypto = 'weapi'
          delete args.playlistId
          delete args.songId
          delete args.uid
        }
        if (['multiRemove', 'multiUp', 'multiLike', 'multiRedHeart'].includes(method)) {
          const status = await invoke('multiStatus', { cookie: this.cookie, timeout: 12000 })
          if (status.body?.data?.multiLtRoomSnapshot?.roomId !== args.roomId)
            throw new Error(t('common.yourAccountHasLeftThisRoomReconnectTo'))
          if (method === 'multiLike' || method === 'multiRedHeart')
            assertRoomCurrentSong(
              status.body,
              {
                roomId: String(args.roomId),
                songId: String(args.songId),
                bizId: String(args.bizId),
              },
              method === 'multiRedHeart',
            )
          if (method === 'multiRemove') {
            const account = await invoke('login_status', {
              cookie: this.cookie,
              timeout: 12000,
            })
            const uid = String(account.body?.data?.profile?.userId || '')
            if (!/^[1-9]\d*$/.test(uid)) throw new Error(t('common.yourSessionExpiredSignInAgain'))
            let cursor = '',
              found = false
            const seen = new Set<string>()
            do {
              const response = await invoke('multiQueue', {
                roomId: args.roomId,
                ...(cursor ? { cursor } : {}),
                cookie: this.cookie,
                timeout: 12000,
              })
              const data = response.body?.data
              if (response.body?.code !== 200 || !Array.isArray(data?.songLists))
                throw new Error(t('service.couldNotVerifyWhoAddedTheTrackTry'))
              const entry = data.songLists.find(
                (row: any) =>
                  String(row.songInfo?.bizId) === args.bizId &&
                  String(row.songInfo?.resourceId) === args.songId,
              )
              if (entry) {
                if (String(entry.rcmdUid) !== uid)
                  throw new Error(t('service.youCanOnlyRemoveTracksYouSuggested'))
                if (
                  String(
                    status.body.data.multiLtRoomSnapshot.roomPlaySongInfo?.playSong?.songBizId,
                  ) === args.bizId
                )
                  throw new Error(t('service.youCannotRemoveTheTrackCurrentlyPlaying'))
                found = true
                break
              }
              if (!data.page?.more) break
              if (
                typeof data.page.cursor !== 'string' ||
                !data.page.cursor ||
                seen.has(data.page.cursor)
              )
                throw new Error(t('service.couldNotReadTheNextQueuePageTry'))
              cursor = data.page.cursor
              seen.add(cursor)
            } while (true)
            if (!found) throw new Error(t('service.thisTrackIsNoLongerInTheRoom'))
          }
        }
        if (method === 'privateSend' || method === 'privateInvite') {
          const account = await invoke('login_status', { cookie: this.cookie, timeout: 12000 })
          const selfUid = String(account.body?.data?.profile?.userId || '')
          if (!/^[1-9]\d*$/.test(selfUid))
            throw Object.assign(new Error(t('service.yourSessionExpiredScanTheQrCodeTo')), {
              code: 302,
            })
          if (args.uid === selfUid)
            throw Object.assign(new Error(t('common.youCannotSendADirectMessageToYourself')), {
              code: 400,
            })
          let text = args.text
          if (method === 'privateInvite') {
            const status = await invoke('multiStatus', { cookie: this.cookie, timeout: 12000 })
            if (
              status.body?.code !== 200 ||
              status.body?.data?.multiLtRoomSnapshot?.roomId !== args.roomId
            )
              throw Object.assign(new Error(t('service.yourRoomChangedSelectTheRoomToShare')), {
                code: 409,
              })
            text = inviteText(String(args.roomId), selfUid)
          }
          // Exactly one validated recipient; no renderer-supplied bulk user_ids or sender identity.
          args.msg = text
          args.user_ids = args.uid
          delete args.uid
          delete args.text
          delete args.requestId
          delete args.roomId
        }
        if (['privateConversations', 'privateHistory', 'follows'].includes(method)) args.limit = 30
        if (method === 'privatePresence') {
          const peer = await this.presence.get(String(args.uid))
          assertSession()
          return { code: 200, data: peer }
        }
        if (method === 'privateRead') {
          // Official message-center API; always acknowledge one opened conversation, never all.
          args.data = { userId: args.uid }
          args.uri = '/api/communication/msg/unread/count/clean'
          args.crypto = 'eapi'
          delete args.uid
        }
        if (method === 'stickerGroups') {
          args.data = { resourceType: args.scope === 'room' ? 3 : 2 }
          args.uri = '/api/social/emoji/groups'
          args.crypto = 'eapi'
          delete args.scope
        }
        if (method === 'stickerPage') {
          args.data = { emojiGroupId: args.groupId, cursor: args.cursor || '', size: 10 }
          args.uri = '/api/social/emoji/groups/detail/page'
          args.crypto = 'eapi'
          delete args.groupId
          delete args.cursor
        }
        if (method === 'stickerCollect') {
          args.data = { emojiId: args.emojiId, emojiGroupId: args.emojiGroupId }
          args.uri = '/api/social/emoji/collect'
          args.crypto = 'eapi'
          delete args.emojiId
          delete args.emojiGroupId
        }
        if (method === 'stickerRemove') {
          args.data = stickerDeletePayload(args.emojiIds)
          args.uri = '/api/social/emoji/cancel'
          args.crypto = 'eapi'
          delete args.emojiIds
        }
        if (method === 'privateSticker') {
          const account = (await invoke('login_status', { cookie: this.cookie, timeout: 12000 }))
            .body?.data?.profile
          if (!account?.userId)
            throw Object.assign(new Error(t('service.signInAgainFirst')), {
              code: 302,
            })
          if (String(account.userId) === args.uid)
            throw Object.assign(new Error(t('common.youCannotSendADirectMessageToYourself')), {
              code: 400,
            })
          const emoji = parseEmoji(args.emoji)!
          const token = (await invoke('register_checktoken_v3', { timeout: 12000 })).body?.token
          if (!token) throw new Error(t('common.couldNotObtainAMessageVerificationTokenTry'))
          args.data = {
            checkToken: token,
            sendMsgBody: JSON.stringify({
              scene: 1,
              receiverUserIds: args.uid,
              channelId: args.uid,
              symphonyId: '',
              refMsgBody: {},
              msgBody: {
                msgType: 1,
                body: JSON.stringify({
                  url: emoji.emojiImgUrl,
                  emojiId: emoji.emojiId,
                  emojiGroupId: emoji.emojiGroupId,
                  width: emoji.width,
                  height: emoji.height,
                  format: emoji.format,
                  name: emoji.emojiName,
                }),
                unikey: args.requestId,
                msgTime: Date.now(),
                status: 1,
                sendStatus: 0,
                sender: { user: { userId: account.userId } },
                text: { textBody: '', atBody: [] },
              },
            }),
          }
          args.uri = '/api/communication/send/msg'
          args.crypto = 'eapi'
          delete args.uid
          delete args.emoji
          delete args.requestId
        }
        if (method === 'multiChatSend') {
          if (args.emoji) args.emoji = parseEmoji(args.emoji)
          // Resolve the IM room from the authenticated server snapshot, never from renderer input.
          const status = await invoke('multiStatus', { cookie: this.cookie, timeout: 12000 })
          const snapshot = status.body?.data?.multiLtRoomSnapshot
          if (status.body?.code !== 200 || snapshot?.roomId !== args.roomId)
            throw Object.assign(new Error(t('service.yourAccountIsNoLongerInThisRoom')), {
              code: status.body?.code !== 200 ? Number(status.body?.code) || 409 : 409,
            })
          const chatId = (snapshot.multiRoomInfoDTO ?? snapshot.roomInfo)?.chatRoomId
          if (
            !['string', 'number'].includes(typeof chatId) ||
            (typeof chatId === 'number' && !Number.isSafeInteger(chatId)) ||
            !/^[1-9]\d{0,23}$/.test(String(chatId))
          )
            throw Object.assign(
              new Error(t('service.roomChatIsTemporarilyUnavailableTryAgainWhen')),
              { code: 409 },
            )
          args.chatRoomId = String(chatId)
        }
        if (method === 'stream') args.level = 'standard'
        if (method === 'search') {
          Object.assign(args, {
            type: ({ songs: 1, playlists: 1000, artists: 100 } as const)[
              (args.kind || 'songs') as 'songs' | 'playlists' | 'artists'
            ],
            limit: 30,
          })
          delete args.kind
        }
        if (method === 'playlists' || method === 'albums') args.limit = 50
        if (method === 'artistSongs') Object.assign(args, { limit: 100, order: 'hot' })
        // Upstream like.js converts the string 'false'; passing a boolean there would incorrectly like a song.
        if (method === 'like') {
          args.like = args.value ? 'true' : 'false'
          delete args.value
        }
        let result
        try {
          if (SEND_METHODS.has(method)) sendAttempted = true
          result = await invoke(endpoints[method], {
            ...args,
            cookie: this.cookie,
            timeout: 12000,
          })
        } catch (primaryError: any) {
          if (method !== 'stream') throw primaryError
          // Same account, ordinary Netease endpoint: no external source or entitlement bypass.
          result = await invoke('song_url', {
            id: args.id,
            br: 320000,
            cookie: this.cookie,
            timeout: 12000,
          })
          result.body = {
            ...result.body,
            compatibility: {
              source: 'song_url',
              reason: String(
                redact(
                  primaryError?.message || t('service.theNewAudioSourceIsTemporarilyUnavailable'),
                ),
              ),
            },
          }
        }
        const body = result.body
        trace.response = traceBody(body)
        const code = body?.code ?? body?.data?.code
        if (
          method === 'playlistAdd' &&
          (Number(code) !== 200 || body?.data === false || body?.data?.result === false)
        )
          throw new Error(
            body?.message || body?.msg || t('service.couldNotConfirmTheAdditionRefreshThePlaylist'),
          )
        const validQr = method === 'qrCheck' && [800, 801, 802, 803].includes(Number(code))
        if (method === 'privateRead' && (Number(code) !== 200 || body?.data === false))
          throw new Error(body?.message || t('service.couldNotConfirmReadStatusTryAgain'))
        if (
          !body ||
          (code !== undefined && Number(code) !== 200 && !validQr) ||
          body?.data?.success === false ||
          (SEND_METHODS.has(method) && body?.data === false)
        ) {
          const failedType = body?.data?.failedType
          const error = new Error(
            body?.data?.failedMessage ||
              (failedType === 'MULTI_SONG_NOT_SATISFIED'
                ? t('service.thisTrackCannotStartANeteaseGroupRoom')
                : failedType) ||
              body?.message ||
              body?.msg ||
              t('service.requestFailed', { code: code ?? t('service.unknownResponse') }),
          )
          Object.assign(error, { code: Number(code) })
          throw error
        }
        if (
          ['multiCreate', 'multiJoin', 'multiLeave', 'multiMatch', 'multiRematchLeave'].includes(
            method,
          ) &&
          body.data?.success !== true
        )
          throw new Error(t('service.theRoomActionWasNotConfirmedCheckThe'))
        if (['multiAdd', 'multiNext'].includes(method) && body.data?.failedCode !== 0)
          throw new Error(
            body.data?.failedMsg ||
              t('room.actionRejected', {
                code: body.data?.failedCode ?? t('service.confirmationMissing'),
              }),
          )
        if (
          method === 'multiRedHeart' &&
          (body.data?.failedCode !== 0 || body.data?.result === false)
        )
          throw new Error(
            body.data?.failedMsg || t('service.theRoomFavoriteWasNotConfirmedTryAgain'),
          )
        if (
          ['multiRemove', 'multiUp', 'multiLike'].includes(method) &&
          (body.data?.result === false ||
            !(body.data?.failedCode === 0 || body.data?.result === true))
        )
          throw new Error(body.data?.failedMsg || t('service.theRoomDidNotAcceptTheActionTry'))
        if (method === 'multiJoin' && body.data?.multiLtRoomSnapshot?.roomId !== args.roomId)
          throw new Error(t('service.theServiceReturnedADifferentRoomCheckYour'))
        if (method === 'qrCreate') {
          this.activeKey = body.data?.unikey
          if (!this.activeKey) throw new Error(t('service.couldNotObtainASignInQrCode'))
          const qr = await invoke('login_qr_create', { key: this.activeKey, qrimg: true })
          return { key: this.activeKey, ...qr.body.data }
        }
        if (method === 'qrCheck' && code === 803) {
          // Set-Cookie attributes must not be sent back as cookies.
          const cookie = (result.cookie || []).map((item) => item.split(';')[0]).join('; ')
          if (!/(?:^|;\s*)MUSIC_U=/.test(cookie))
            throw new Error(t('service.signInSucceededWithoutCredentialsScanTheQr'))
          this.cookie = cookie
          this.epoch++
          this.uid = ''
          this.sends.clear()
          this.presence.clear()
          this.activeKey = ''
          this.onCookie(cookie)
        }
        if (method === 'account') {
          const uid = String(body.data?.profile?.userId || '')
          const nextUid = /^[1-9]\d{0,23}$/.test(uid) ? uid : ''
          if (this.uid && this.uid !== nextUid) {
            this.epoch++
            this.sends.clear()
            this.presence.clear()
          }
          this.uid = nextUid
          this.onAccount(this.uid)
        }
        if (method === 'stickerCollect' || method === 'stickerRemove') stickerMutationResult(body)
        if (
          method === 'privateSticker' &&
          (!body.data?.msgBody?.msgId || [-2, -1].includes(body.data.msgBody.status))
        )
          throw new Error(t('service.stickerDeliveryCouldNotBeConfirmedRefreshThe'))
        return stripCredentials(
          method === 'stickerPage'
            ? normalizeStickerPage(body, String(request.args!.groupId))
            : body,
        )
      }
      const data =
        multiMutations.has(request.method) ||
        SEND_METHODS.has(request.method) ||
        ['stickerCollect', 'stickerRemove'].includes(request.method) ||
        /^(qrCreate|qrCheck|logout|like|playlistAdd)$/.test(request.method)
          ? await this.mutations.run(run)
          : await run(0)
      trace.ok = true
      trace.response = traceBody(data)
      return { ok: true, data, trace }
    } catch (error: any) {
      if (
        request.method === 'account' &&
        epoch === this.epoch &&
        Number(error?.code || error?.body?.code) === 302
      ) {
        if (this.uid) {
          this.epoch++
          this.sends.clear()
          this.presence.clear()
        }
        this.uid = ''
        this.onAccount('')
      }
      const message = String(
        redact(
          error?.body?.message ||
            error?.body?.msg ||
            error?.message ||
            t('service.theNeteaseServiceIsTemporarilyUnavailable'),
        ),
      )
      trace.response =
        isChat || isPrivate
          ? {
              error: t('service.chatRequestFailedContentHidden'),
              code: Number(error?.code || error?.body?.code) || undefined,
            }
          : { error: message, body: trace.response || redact(error?.body) }
      const code = Number(error?.code || error?.body?.code) || undefined
      return {
        ok: false,
        error: message,
        code,
        deliveryUnknown:
          SEND_METHODS.has(request.method) && sendAttempted && (!code || code >= 500),
        trace,
      }
    } finally {
      trace.duration = Date.now() - start
    }
  }
}

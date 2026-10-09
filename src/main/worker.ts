import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ApiService } from './service'
import { createHttpInvoker } from './transport'
import { multiEndpoints, multiPayload, type MultiMethod } from './multi-api'
import { MediaSender } from './media-send'
import { parsePreciseJson, preciseMediaEndpoint } from './precise-json'
import { SharedNotifications } from './shared-notifications'

const requireApi = createRequire(__filename)
// Upstream can print raw error responses; diagnostics leave this process only through ApiService.
console.log = console.info = console.warn = console.error = () => {}
const api = requireApi('@neteasecloudmusicapienhanced/api')
const apiRequire = createRequire(requireApi.resolve('@neteasecloudmusicapienhanced/api'))
const axios = apiRequire('axios').default
axios.defaults.timeout = 12000
const responseTransforms = [].concat(axios.defaults.transformResponse || []) as any[]
axios.defaults.transformResponse = [
  function (this: any, data: any, headers: any, status: any) {
    if (typeof data === 'string' && preciseMediaEndpoint(this.url)) return parsePreciseJson(data)
    return responseTransforms.reduce(
      (value, transform) => transform.call(this, value, headers, status),
      data,
    )
  },
]
let keyReady: Promise<void> | undefined
async function ensureKey() {
  if (!keyReady)
    keyReady = (async () => {
      const { getXeapiPublicKey } = apiRequire('./util/xeapiKey')
      const key = await getXeapiPublicKey()
      writeFileSync(join(tmpdir(), 'xeapi_public_key'), JSON.stringify(key), { mode: 0o600 })
    })().catch((error) => {
      keyReady = undefined
      throw error
    })
  await keyReady
}
const bundled = async (endpoint: string, args: Record<string, unknown>) => {
  if (endpoint === 'song_url_v1') await ensureKey()
  return api[endpoint]({
    ...args,
    cookie: args.cookie || 'MUSIC_U=; MUSIC_A=',
    noCookie: true,
    timestamp: randomUUID(),
    ...(preciseMediaEndpoint(args.uri) || ['msg_private', 'msg_private_history'].includes(endpoint)
      ? { e_r: 'false' }
      : {}),
  })
}
const standard = process.env.MUSIC_PARTY_API_URL
  ? createHttpInvoker(process.env.MUSIC_PARTY_API_URL)
  : bundled
const invoke = async (endpoint: string, args: Record<string, unknown>) => {
  if (!Object.hasOwn(multiEndpoints, endpoint)) return standard(endpoint, args)
  const method = endpoint as MultiMethod
  let token = ''
  if (
    [
      'multiCreate',
      'multiJoin',
      'multiAdd',
      'multiNext',
      'multiRemove',
      'multiUp',
      'multiLike',
      'multiRedHeart',
      'multiMatch',
    ].includes(method)
  ) {
    token =
      (await standard('register_checktoken_v3', { cookie: args.cookie, timeout: 12000 })).body
        ?.token || ''
    if (!token) throw new Error('未取得网易云请求校验令牌，请稍后重试')
  }
  return standard('api', {
    uri: multiEndpoints[method],
    data: multiPayload(method, args, token),
    crypto: 'eapi',
    cookie: args.cookie || {},
    timeout: 12000,
  })
}
let mediaCookie = '',
  mediaEpoch = 0
const media = new MediaSender(invoke, () => ({ cookie: mediaCookie, epoch: mediaEpoch }))
let notifications: SharedNotifications | null = null
let notificationUid = ''
const emptySession = randomUUID()
function notificationSnapshot(cursor = 0, session?: string) {
  return {
    ...(notifications?.poll(cursor, session) ?? {
      session: emptySession,
      cursor: 0,
      connected: false,
      reset: false,
      events: [],
    }),
    accountUid: notificationUid,
  }
}
function stopNotifications() {
  notifications?.close()
  notifications = null
  notificationUid = ''
}
function enableNotifications(uid: string) {
  mediaEpoch = service.session().epoch
  if (!uid) {
    stopNotifications()
    return
  }
  if (notificationUid && notificationUid !== uid) stopNotifications()
  notificationUid = uid
  if (!notifications)
    notifications = new SharedNotifications(
      async () => {
        const auth = service.session()
        if (!auth.cookie || !auth.uid) throw new Error('请先重新登录')
        const result = await standard('api', {
          uri: '/api/middle/im/token/get',
          data: { bizTag: 'platform' },
          crypto: 'eapi',
          cookie: auth.cookie,
          timeout: 12000,
        })
        if (service.session().epoch !== auth.epoch) throw new Error('账号已变化')
        const data = result.body?.data
        if (
          result.body?.code !== 200 ||
          typeof data?.accId !== 'string' ||
          !data.accId ||
          typeof data?.token !== 'string' ||
          !data.token
        )
          throw new Error('暂时无法取得私信通知凭据')
        return { accId: data.accId, token: data.token }
      },
      undefined,
      (batch) =>
        process.parentPort?.postMessage({
          type: 'private-notifications',
          batch: { ...batch, accountUid: notificationUid },
        }),
    )
  notifications.enablePrivate(uid)
}
const service = new ApiService(
  invoke,
  (cookie) => {
    stopNotifications()
    mediaCookie = cookie
    mediaEpoch++
    process.parentPort?.postMessage({ type: 'cookie', cookie })
  },
  enableNotifications,
)

process.parentPort?.on('message', async ({ data }) => {
  if (data.type === 'restore') {
    stopNotifications()
    mediaCookie = data.cookie
    mediaEpoch++
    service.restore(data.cookie)
    if (data.cookie) await service.call({ method: 'account' })
    return
  }
  if (data.type === 'media-cancel') {
    media.cancel(data.requestId)
    return
  }
  if (data.type === 'media-send' || data.type === 'sticker-image') {
    const sender =
      data.type === 'sticker-image' ? media.saveImage.bind(media) : media.send.bind(media)
    const reply = await sender(data.request, (progress) =>
      process.parentPort?.postMessage({ type: 'media-progress', progress }),
    )
    process.parentPort?.postMessage({ type: 'media-reply', id: data.id, reply })
    return
  }
  if (
    data.type === 'notifications' ||
    data.type === 'match-open' ||
    data.type === 'match-poll' ||
    data.type === 'match-close'
  ) {
    try {
      let result: unknown
      if (data.type === 'notifications') result = notificationSnapshot(data.cursor, data.session)
      else if (data.type === 'match-close') notifications?.matchClose(data.attemptId)
      else {
        if (!notifications || !notificationUid || notificationUid !== service.session().uid)
          throw new Error('请先重新登录')
        if (data.type === 'match-open') await notifications.matchOpen(data.attemptId)
        else result = notifications.matchPoll(data.attemptId)
      }
      process.parentPort?.postMessage({
        type: 'reply',
        id: data.id,
        reply: { ok: true, data: result },
      })
    } catch {
      process.parentPort?.postMessage({
        type: 'reply',
        id: data.id,
        reply: { ok: false, error: '通知连接暂不可用，请重新同步或重试匹配' },
      })
    }
    return
  }
  if (data.type === 'call')
    process.parentPort?.postMessage({
      type: 'reply',
      id: data.id,
      reply: await service.call(data.request),
    })
})
process.on('exit', stopNotifications)

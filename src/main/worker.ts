import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ApiService } from './service'
import { createHttpInvoker } from './transport'
import { multiEndpoints, multiPayload, type MultiMethod } from './multi-api'
import { MediaSender } from './media-send'

const requireApi = createRequire(__filename)
// Upstream can print raw error responses; diagnostics leave this process only through ApiService.
console.log = console.info = console.warn = console.error = () => {}
const api = requireApi('@neteasecloudmusicapienhanced/api')
const apiRequire = createRequire(requireApi.resolve('@neteasecloudmusicapienhanced/api'))
apiRequire('axios').default.defaults.timeout = 12000
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
  return api[endpoint](args)
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
    ].includes(method)
  ) {
    token = (await standard('register_checktoken_v3', { timeout: 12000 })).body?.token || ''
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
const service = new ApiService(invoke, (cookie) => {
  mediaCookie = cookie
  mediaEpoch++
  process.parentPort?.postMessage({ type: 'cookie', cookie })
})

process.parentPort?.on('message', async ({ data }) => {
  if (data.type === 'restore') {
    mediaCookie = data.cookie
    mediaEpoch++
    service.restore(data.cookie)
    return
  }
  if (data.type === 'media-cancel') {
    media.cancel(data.requestId)
    return
  }
  if (data.type === 'media-send') {
    const reply = await media.send(data.request, (progress) =>
      process.parentPort?.postMessage({ type: 'media-progress', progress }),
    )
    process.parentPort?.postMessage({ type: 'media-reply', id: data.id, reply })
    return
  }
  if (data.type === 'call')
    process.parentPort?.postMessage({
      type: 'reply',
      id: data.id,
      reply: await service.call(data.request),
    })
})

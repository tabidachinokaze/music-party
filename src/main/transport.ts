import { t } from '../shared/ui-language'
import { randomUUID } from 'node:crypto'
import { parsePreciseJson, preciseMediaEndpoint } from './precise-json'
export function createHttpInvoker(base: string, fetcher: typeof fetch = fetch) {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error(t('transport.invalidApiAddress'))
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error(t('transport.remoteApiAddressesMustUseHttps'))
  return async (endpoint: string, args: Record<string, unknown>) => {
    const path = endpoint.replaceAll('_', '/')
    const target = new URL(`${url.pathname.replace(/\/$/, '')}/${path}`, url.origin)
    // Upstream cache keys ignore the POST body, even for /api. Never reuse state/auth/mutation replies.
    target.searchParams.set('timestamp', randomUUID())
    let response: Response
    try {
      response = await fetcher(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-apicache-bypass': 'true' },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          ...args,
          cookie: args.cookie || 'MUSIC_U=; MUSIC_A=',
          noCookie: true,
          timestamp: Date.now(),
        }),
      })
    } catch {
      throw new Error(t('transport.couldNotReachNcmApiCheckTheDocker'))
    }
    let body: any
    try {
      body =
        preciseMediaEndpoint(args.uri) || ['msg_private', 'msg_private_history'].includes(endpoint)
          ? parsePreciseJson(await response.text())
          : await response.json()
    } catch {
      throw new Error(
        t('transport.ncmApiReturnedANonJsonResponseHttp', { status: response.status }),
      )
    }
    if (!response.ok)
      throw Object.assign(
        new Error(
          body.message ||
            body.msg ||
            t('transport.ncmApiRequestFailedHttp', { status: response.status }),
        ),
        { body },
      )
    const cookies = response.headers.getSetCookie?.() || []
    if (!cookies.length && typeof body.cookie === 'string')
      cookies.push(
        ...body.cookie
          .split(';')
          .map((part: string) => part.trim())
          .filter((part: string) => /^(MUSIC_U|MUSIC_A|__csrf|NMTID|__remember_me)=/.test(part)),
      )
    return { body, cookie: cookies }
  }
}

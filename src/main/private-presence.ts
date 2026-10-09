import { neteaseAssetUrl } from '../shared/media'
import type { PrivatePeer } from '../shared/private-notices'

export const PRIVATE_PRESENCE_TTL = 45_000
export const PRIVATE_PRESENCE_RETRY_DELAY = 30_000
const CACHE_LIMIT = 256
const CONCURRENCY = 2

type Session = { cookie: string; epoch: number }
type Invoke = (endpoint: string, args: Record<string, unknown>) => Promise<{ body: any }>
type Entry = { peer: PrivatePeer; expires: number }
type Job = {
  uid: string
  session: Session
  generation: number
  promise: Promise<PrivatePeer>
  resolve(peer: PrivatePeer): void
  reject(error: Error): void
}

/** Official presence reads are independent from the Mini connection's own connectivity. */
export class PrivatePresence {
  private account: Session | null = null
  private generation = 0
  private cache = new Map<string, Entry>()
  private pending = new Map<string, Job>()
  private queue: Job[] = []
  private active = 0

  constructor(
    private readonly invoke: Invoke,
    private readonly session: () => Session,
  ) {}

  get(uid: string): Promise<PrivatePeer> {
    if (!/^[1-9]\d{0,23}$/.test(uid)) return Promise.reject(new Error('私信联系人无效'))
    const session = this.session()
    if (!session.cookie) {
      this.clear()
      return Promise.reject(new Error('请先登录网易云账号'))
    }
    if (this.account?.epoch !== session.epoch || this.account?.cookie !== session.cookie) {
      this.clear()
      this.account = { ...session }
    }
    const cached = this.cache.get(uid)
    if (cached && cached.expires > Date.now()) return Promise.resolve({ ...cached.peer })
    const existing = this.pending.get(uid)
    if (existing) return existing.promise
    let resolve!: Job['resolve'], reject!: Job['reject']
    const promise = new Promise<PrivatePeer>((done, fail) => {
      resolve = done
      reject = fail
    })
    const job = {
      uid,
      session: { ...session },
      generation: this.generation,
      promise,
      resolve,
      reject,
    }
    this.pending.set(uid, job)
    this.queue.push(job)
    this.pump()
    return promise
  }

  /** Call on logout/account changes; outstanding reads cannot populate the next account's cache. */
  clear() {
    this.generation++
    this.account = null
    this.cache.clear()
    this.queue = []
    for (const job of this.pending.values()) job.reject(new Error('账号已变更，请重新查询在线状态'))
    this.pending.clear()
  }

  private current(job: Job) {
    const session = this.session()
    return (
      job.generation === this.generation &&
      session.epoch === job.session.epoch &&
      session.cookie === job.session.cookie &&
      !!session.cookie
    )
  }

  private pump() {
    while (this.active < CONCURRENCY && this.queue.length) {
      const job = this.queue.shift()!
      if (!this.current(job)) {
        job.reject(new Error('账号已变更，请重新查询在线状态'))
        if (this.pending.get(job.uid) === job) this.pending.delete(job.uid)
        continue
      }
      this.active++
      void this.load(job)
    }
  }

  private async load(job: Job) {
    try {
      let peer: PrivatePeer,
        expires = Date.now() + PRIVATE_PRESENCE_TTL
      try {
        const { body } = await this.invoke('api', {
          uri: '/api/communication/msg/setting/get',
          crypto: 'eapi',
          data: { userId: job.uid, scene: 1 },
          cookie: job.session.cookie,
          noCookie: true,
          timeout: 12000,
        })
        if (!this.current(job)) throw new Error('账号已变更，请重新查询在线状态')
        if (Number(body?.code) !== 200 || !body.data || typeof body.data !== 'object')
          throw new Error('在线状态查询暂时不可用')
        const data = body.data
        const profile = data.personalHomepage?.userProfileData
        const verified = String(profile?.userId ?? '') === job.uid
        peer = {
          uid: job.uid,
          online: typeof data.online === 'boolean' ? data.online : null,
          nickname:
            verified && typeof profile.nickname === 'string'
              ? profile.nickname
                  .replace(/[\u0000-\u001f\u007f]/g, '')
                  .trim()
                  .slice(0, 160)
              : '',
          avatar: verified ? (neteaseAssetUrl(profile.avatarUrl) ?? '') : '',
        }
        expires = Date.now() + PRIVATE_PRESENCE_TTL
      } catch (error) {
        if (!this.current(job)) throw new Error('账号已变更，请重新查询在线状态')
        const previous = this.cache.get(job.uid)?.peer
        peer = {
          uid: job.uid,
          nickname: previous?.nickname ?? '',
          avatar: previous?.avatar ?? '',
          online: null,
        }
        expires = Date.now() + PRIVATE_PRESENCE_RETRY_DELAY
      }
      if (!this.current(job)) throw new Error('账号已变更，请重新查询在线状态')
      this.cache.delete(job.uid)
      this.cache.set(job.uid, { peer, expires })
      if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!)
      job.resolve({ ...peer })
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error('在线状态查询失败'))
    } finally {
      this.active--
      if (this.pending.get(job.uid) === job) this.pending.delete(job.uid)
      this.pump()
    }
  }
}

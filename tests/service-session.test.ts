import { expect, it, vi } from 'vitest'
import { ApiService } from '../src/main/service'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const account = (uid: string) => ({ body: { code: 200, data: { profile: { userId: uid } } } })

it('does not publish an old account’s UID or data after a restore replaces its cookie', async () => {
  const gate = deferred<ReturnType<typeof account>>()
  const onAccount = vi.fn()
  const service = new ApiService(
    vi.fn(() => gate.promise),
    undefined,
    onAccount,
  )
  service.restore('MUSIC_U=first-fixture')
  const reply = service.call({ method: 'account' })
  service.restore('MUSIC_U=second-fixture')
  gate.resolve(account('8'))
  expect(await reply).toMatchObject({ ok: false, code: 409 })
  expect((await reply).data).toBeUndefined()
  expect(onAccount).not.toHaveBeenCalled()
  expect(service.session()).toEqual({ cookie: 'MUSIC_U=second-fixture', epoch: 2, uid: '' })
})

it('rejects stale private history without disclosing the old account’s message body', async () => {
  const gate = deferred<{ body: { code: number; msgs: any[] } }>()
  const service = new ApiService(vi.fn(() => gate.promise))
  service.restore('MUSIC_U=first-fixture')
  const reply = service.call({ method: 'privateHistory', args: { uid: '8' } })
  service.restore('MUSIC_U=second-fixture')
  gate.resolve({ body: { code: 200, msgs: [{ id: '1', msg: 'private-old-body' }] } })
  const result = await reply
  expect(result).toMatchObject({ ok: false, code: 409 })
  expect(JSON.stringify(result)).not.toContain('private-old-body')
})

it('blocks both a send in preflight and the following queued send when an account changes', async () => {
  const gate = deferred<ReturnType<typeof account>>()
  const invoke = vi.fn(() => gate.promise)
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=first-fixture')
  const first = service.call({
    method: 'privateSend',
    args: { uid: '8', text: 'first fixture', requestId: '00000000-0000-4000-8000-000000000001' },
  })
  const queued = service.call({
    method: 'privateSend',
    args: { uid: '8', text: 'second fixture', requestId: '00000000-0000-4000-8000-000000000002' },
  })
  await Promise.resolve()
  expect(invoke).toHaveBeenCalledOnce()
  service.restore('MUSIC_U=second-fixture')
  gate.resolve(account('9'))
  expect(await first).toMatchObject({ ok: false, code: 409 })
  expect(await queued).toMatchObject({ ok: false, code: 409 })
  expect(invoke).toHaveBeenCalledOnce()
})

it('blocks a queued room mutation from using a newly restored account’s cookie', async () => {
  const gate = deferred<ReturnType<typeof account>>()
  const invoke = vi.fn(() => gate.promise)
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=first-fixture')
  const first = service.call({
    method: 'privateSend',
    args: { uid: '8', text: 'fixture', requestId: '00000000-0000-4000-8000-000000000001' },
  })
  const queued = service.call({
    method: 'multiAdd',
    args: { roomId: 'fixture-room', songId: '123' },
  })
  await Promise.resolve()
  service.restore('MUSIC_U=second-fixture')
  gate.resolve(account('9'))
  expect(await first).toMatchObject({ ok: false, code: 409 })
  expect(await queued).toMatchObject({ ok: false, code: 409 })
  expect(invoke).toHaveBeenCalledOnce()
})

it('does not carry a cached online result into the next authenticated account', async () => {
  const invoke = vi.fn(async (_endpoint: string, args: Record<string, unknown>) => ({
    body: { code: 200, data: { online: args.cookie === 'MUSIC_U=first-fixture' } },
  }))
  const service = new ApiService(invoke)
  service.restore('MUSIC_U=first-fixture')
  expect(
    (await service.call({ method: 'privatePresence', args: { uid: '8' } })).data.data.online,
  ).toBe(true)
  service.restore('MUSIC_U=second-fixture')
  expect(
    (await service.call({ method: 'privatePresence', args: { uid: '8' } })).data.data.online,
  ).toBe(false)
  expect(invoke).toHaveBeenCalledTimes(2)
})

it.each([
  { label: 'a different verified UID', response: account('456'), uid: '456', ok: true },
  {
    label: 'a missing account profile',
    response: { body: { code: 200, data: { profile: null } } },
    uid: '',
    ok: true,
  },
  {
    label: 'an expired account response',
    response: { body: { code: 302, message: 'fixture expired' } },
    uid: '',
    ok: false,
  },
])(
  'invalidates ongoing reads and queued sends when the same cookie returns $label',
  async (change) => {
    const history = deferred<{ body: { code: number; msgs: any[] } }>()
    const sendPreflight = deferred<ReturnType<typeof account>>()
    let logins = 0
    const invoke = vi.fn(async (endpoint: string): Promise<{ body: any }> => {
      if (endpoint === 'msg_private_history') return history.promise
      if (endpoint === 'login_status') {
        logins++
        if (logins === 1) return account('123')
        if (logins === 2) return sendPreflight.promise
        return change.response
      }
      throw new Error(`Unexpected mutation reached upstream: ${endpoint}`)
    })
    const onAccount = vi.fn()
    const service = new ApiService(invoke, undefined, onAccount)
    service.restore('MUSIC_U=same-fixture-cookie')
    expect((await service.call({ method: 'account' })).ok).toBe(true)
    const original = service.session()
    expect(original.uid).toBe('123')
    const reading = service.call({ method: 'privateHistory', args: { uid: '8' } })
    const sending = service.call({
      method: 'privateSend',
      args: { uid: '8', text: 'fixture', requestId: '00000000-0000-4000-8000-000000000001' },
    })
    const queued = service.call({
      method: 'privateSend',
      args: { uid: '8', text: 'queued fixture', requestId: '00000000-0000-4000-8000-000000000002' },
    })
    await Promise.resolve()
    expect(logins).toBe(2)
    expect((await service.call({ method: 'account' })).ok).toBe(change.ok)
    expect(service.session()).toEqual({ ...original, epoch: original.epoch + 1, uid: change.uid })
    expect(onAccount).toHaveBeenLastCalledWith(change.uid)
    history.resolve({ body: { code: 200, msgs: [{ id: '1', msg: 'stale private body' }] } })
    sendPreflight.resolve(account('123'))
    for (const result of await Promise.all([reading, sending, queued])) {
      expect(result).toMatchObject({ ok: false, code: 409 })
      expect(JSON.stringify(result)).not.toContain('stale private body')
    }
    expect(logins).toBe(3)
    expect(invoke).toHaveBeenCalledTimes(4)
    expect(
      invoke.mock.calls.every(
        ([endpoint]) => endpoint === 'login_status' || endpoint === 'msg_private_history',
      ),
    ).toBe(true)
  },
)

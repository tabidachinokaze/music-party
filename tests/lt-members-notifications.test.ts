import { expect, it, vi } from 'vitest'
import { SharedNotifications } from '../src/main/shared-notifications'

it('forwards a 30005 custom notification to the room member callback', async () => {
  let options: any
  const make = (value: any) => {
    options = value
    return { open: async () => {}, poll: () => [], close: () => {} }
  }
  const onMembers = vi.fn()
  const notifications = new SharedNotifications(
    async () => ({ accId: '1', token: 'token' }),
    make,
    undefined,
    onMembers,
  )
  notifications.enablePrivate('1')
  await vi.waitFor(() => expect(options).toBeTruthy())
  await Promise.resolve()
  options.onNotification(
    JSON.stringify({
      serverExt: {
        type: 30005,
        content: {
          version: 3,
          onlineNums: 1,
          onlineUserInfos: [{ uid: 42, nickname: '听友' }],
        },
      },
    }),
    1,
  )
  expect(onMembers).toHaveBeenCalledWith({
    roomId: '',
    version: 3,
    onlineCount: 1,
    members: [{ uid: '42', nickname: '听友', avatar: '' }],
  })
  notifications.close()
})

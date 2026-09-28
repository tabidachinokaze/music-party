import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { FullScreenController } from '../src/main/fullscreen'

afterEach(() => vi.useRealTimers())
function setup() {
  const window = Object.assign(new EventEmitter(), {
    isFullScreen: () => false,
    setFullScreen: vi.fn(),
  })
  const notify = vi.fn()
  return { window, notify, controller: new FullScreenController(window as any, notify) }
}
it('uses native events even when the window getter is stale, toggling once in each direction', async () => {
  const { window, controller } = setup()
  window.setFullScreen.mockImplementation((value) =>
    window.emit(value ? 'enter-full-screen' : 'leave-full-screen'),
  )
  for (let i = 0; i < 3; i++) {
    expect(await controller.set('toggle')).toBe(true)
    expect(await controller.set('toggle')).toBe(false)
  }
  expect(window.setFullScreen.mock.calls.map(([value]) => value)).toEqual([
    true,
    false,
    true,
    false,
    true,
    false,
  ])
  expect(controller.revision).toBe(6)
})
it('finishes the current transition before applying an opposite request', async () => {
  const { window, controller } = setup()
  const entering = controller.set(true)
  await Promise.resolve()
  const leaving = controller.set(false)
  expect(window.setFullScreen).toHaveBeenCalledTimes(1)
  window.emit('enter-full-screen')
  await Promise.resolve()
  expect(window.setFullScreen.mock.calls.map(([value]) => value)).toEqual([true, false])
  window.emit('leave-full-screen')
  expect(await entering).toBe(false)
  expect(await leaving).toBe(false)
})
it('tracks external fullscreen changes and permits retry after a missing event', async () => {
  vi.useFakeTimers()
  const { window, controller } = setup()
  window.emit('enter-full-screen')
  const failed = expect(controller.set(false)).rejects.toThrow('超时')
  await vi.advanceTimersByTimeAsync(5000)
  await failed
  window.setFullScreen.mockImplementation(() => window.emit('leave-full-screen'))
  expect(await controller.set('toggle')).toBe(false)
})

import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { UpdateController } from '../src/main/updates'
import { plainReleaseNotes, updateSupport } from '../src/shared/updates'
class FakeUpdater extends EventEmitter {
  checkForUpdates = vi.fn(async () => {})
  downloadUpdate = vi.fn(async () => {})
  quitAndInstall = vi.fn()
}
it('supports packaged AppImage and Windows, explains unsupported deployment modes', () => {
  expect(updateSupport(true, 'linux', '/tmp/app.AppImage')).toBeNull()
  expect(updateSupport(true, 'win32')).toBeNull()
  expect(updateSupport(false, 'linux')).toContain('开发模式')
  expect(updateSupport(true, 'linux')).toContain('AppImage')
  expect(updateSupport(true, 'darwin')).toContain('暂不支持')
})
it('checks once, waits for explicit download, and installs only after exit preparation', async () => {
  const backend = new FakeUpdater(),
    before = vi.fn(async () => {}),
    notify = vi.fn()
  backend.checkForUpdates.mockImplementation(async () => {
    backend.emit('update-available', { version: '0.7.1', releaseNotes: '<p>Fix</p>' })
  })
  backend.downloadUpdate.mockImplementation(async () => {
    backend.emit('download-progress', { percent: 50, transferred: 10, total: 20 })
    backend.emit('update-downloaded', { version: '0.7.1' })
  })
  const updater = new UpdateController(backend, '0.7.0', null, notify, before)
  await Promise.all([updater.check(), updater.check()])
  expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(updater.state.phase).toBe('available')
  expect(backend.downloadUpdate).not.toHaveBeenCalled()
  expect((await updater.install()).phase).toBe('available')
  expect(before).not.toHaveBeenCalled()
  await updater.download()
  expect(updater.state.phase).toBe('downloaded')
  expect(backend.quitAndInstall).not.toHaveBeenCalled()
  await updater.install()
  expect(before).toHaveBeenCalledTimes(1)
  expect(before.mock.invocationCallOrder[0]).toBeLessThan(
    backend.quitAndInstall.mock.invocationCallOrder[0],
  )
  expect(backend.quitAndInstall).toHaveBeenCalledWith(false, true)
})
it('does not touch the updater in development mode', async () => {
  const backend = new FakeUpdater(),
    updater = new UpdateController(backend, '0.7.0', 'Development', vi.fn(), vi.fn())
  await updater.check()
  await updater.download()
  await updater.install()
  expect(backend.checkForUpdates).not.toHaveBeenCalled()
  expect(backend.quitAndInstall).not.toHaveBeenCalled()
})
it('handles the first unpublished release and restores the running app after install failure', async () => {
  const backend = new FakeUpdater(),
    failed = vi.fn(),
    updater = new UpdateController(backend, '0.7.0', null, vi.fn(), vi.fn(), failed)
  backend.checkForUpdates.mockRejectedValue(new Error('404 latest version not found'))
  await updater.check()
  expect(updater.state.phase).toBe('error')
  expect(updater.state.message).toContain('没有可用')
  backend.emit('update-downloaded', { version: '0.7.1' })
  backend.quitAndInstall.mockImplementation(() => {
    backend.emit('error', new Error('permission denied'))
  })
  await updater.install()
  expect(failed).toHaveBeenCalledTimes(1)
  expect(updater.state.phase).toBe('error')
})
it('renders release notes as bounded text and ignores unsafe markup', () => {
  expect(plainReleaseNotes([{ note: '<b>New</b>' }])).toBe('New')
  expect(plainReleaseNotes('a'.repeat(20000))).toHaveLength(8000)
})

import { afterEach, expect, it, vi } from 'vitest'
import { importPlayerBackground } from '../src/renderer/src/background-import'
import { PLAYER_BACKGROUND_LIMITS } from '../src/shared/desktop'

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
    'base64',
  ),
)
afterEach(() => vi.unstubAllGlobals())

it('rejects unsupported and oversized source images before invoking a browser decoder', async () => {
  const decode = vi.fn()
  vi.stubGlobal('createImageBitmap', decode)
  await expect(importPlayerBackground(new File(['<svg/>'], 'fake.png'))).rejects.toThrow()
  const oversized = new File([new Uint8Array(PLAYER_BACKGROUND_LIMITS.inputBytes + 1)], 'big.png')
  await expect(importPlayerBackground(oversized)).rejects.toThrow('20 MiB')
  const huge = Uint8Array.from(png)
  const dimensions = new DataView(huge.buffer)
  dimensions.setUint32(16, 9000)
  dimensions.setUint32(20, 9000)
  await expect(importPlayerBackground(new File([huge], 'bomb.png'))).rejects.toThrow('尺寸')
  expect(decode).not.toHaveBeenCalled()
})

it('scales a decoded raster before allocating the canvas and closes the bitmap before IPC', async () => {
  const close = vi.fn(),
    bitmap = { width: 4000, height: 2000, close },
    context = { drawImage: vi.fn(), imageSmoothingQuality: '' },
    canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: BlobCallback) => callback(new Blob([png], { type: 'image/png' })),
    },
    prepare = vi.fn(async () => {
      expect(close).toHaveBeenCalledOnce()
      return { image: 'data:image/png;base64,normalized', width: 2048, height: 1024 }
    })
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap),
  )
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('window', { together: { preparePlayerBackground: prepare } })
  const result = await importPlayerBackground(new File([png], 'image.png', { type: 'image/png' }))
  expect(result).toMatchObject({ width: 2048, height: 1024 })
  expect(canvas).toMatchObject({ width: 2048, height: 1024 })
  expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2048, 1024)
  expect(prepare).toHaveBeenCalledWith(png)
})

it('closes a bitmap rejected by the decoded-dimension guard without allocating a canvas', async () => {
  const close = vi.fn(),
    createElement = vi.fn()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 9000, height: 9000, close })),
  )
  vi.stubGlobal('document', { createElement })
  await expect(importPlayerBackground(new File([png], 'image.png'))).rejects.toThrow('尺寸')
  expect(close).toHaveBeenCalledOnce()
  expect(createElement).not.toHaveBeenCalled()
})

it('closes the bitmap and reports PNG encoding failure without submitting empty bytes', async () => {
  const close = vi.fn(),
    prepare = vi.fn()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 1, height: 1, close })),
  )
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toBlob: (callback: BlobCallback) => callback(null),
    }),
  })
  vi.stubGlobal('window', { together: { preparePlayerBackground: prepare } })
  await expect(importPlayerBackground(new File([png], 'image.png'))).rejects.toThrow('转换失败')
  expect(close).toHaveBeenCalledOnce()
  expect(prepare).not.toHaveBeenCalled()
})

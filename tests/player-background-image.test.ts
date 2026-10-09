import { expect, it, vi } from 'vitest'
import {
  normalizeStoredPlayerBackground,
  preparePlayerBackground,
} from '../src/main/player-background-image'
import { PLAYER_BACKGROUND_LIMITS, validatePlayerBackgroundImage } from '../src/shared/desktop'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
  'base64',
)
// The decoder port is mocked here; actual nativeImage decoding is covered by Electron tests.
function pngHeader(width: number, height: number) {
  const bytes = Buffer.from(png)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}
function raster(
  width: number,
  height: number,
  resized: { width: number; height: number }[] = [],
  encodedSize?: (width: number) => number,
) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: (size: { width: number; height: number; quality: 'best' }) => {
      resized.push({ width: size.width, height: size.height })
      return raster(size.width, size.height, resized, encodedSize)
    },
    toPNG: () =>
      encodedSize?.(width) ? Buffer.alloc(encodedSize(width)) : pngHeader(width, height),
  }
}

it('prepares a byte-backed PNG with dimensions and no dependency on a path or remote URL', () => {
  const decode = vi.fn((_bytes: Buffer) => raster(1, 1)),
    result = preparePlayerBackground(new Uint8Array(png), decode)
  expect(result).toEqual({
    image: `data:image/png;base64,${png.toString('base64')}`,
    width: 1,
    height: 1,
  })
  expect(decode).toHaveBeenCalledOnce()
  expect(decode.mock.calls[0][0]).toEqual(png)
  expect(validatePlayerBackgroundImage(result.image)).toBe(result.image)
})
it('accepts JPEG bytes by signature and returns a normalized PNG', () => {
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 2, 0, 3, 1, 1, 17, 0, 255, 217]),
    result = preparePlayerBackground(jpeg, () => raster(3, 2))
  expect(result).toMatchObject({ width: 3, height: 2 })
  expect(result.image).toMatch(/^data:image\/png;base64,/)
})
it('scales a large source proportionally before encoding a saved background', () => {
  const resized: { width: number; height: number }[] = [],
    result = preparePlayerBackground(pngHeader(4000, 2000), () => raster(4000, 2000, resized))
  expect(resized).toEqual([{ width: 2048, height: 1024 }])
  expect(result).toMatchObject({ width: 2048, height: 1024 })
})
it('reduces dimensions further when a normalized PNG exceeds the persistent byte budget', () => {
  const resized: { width: number; height: number }[] = [],
    result = preparePlayerBackground(pngHeader(2048, 1024), () =>
      raster(2048, 1024, resized, (width) =>
        width > 1000 ? PLAYER_BACKGROUND_LIMITS.storedBytes + 1 : 0,
      ),
    )
  expect(result).toMatchObject({ width: 864, height: 432 })
  expect(Buffer.from(result.image.split(',')[1], 'base64').length).toBeLessThanOrEqual(
    PLAYER_BACKGROUND_LIMITS.storedBytes,
  )
  expect(resized[0]).toEqual({ width: 1536, height: 768 })
})
it('rejects paths, URL strings, empty data, oversized input and unsupported image formats before decoding', () => {
  const decode = vi.fn(() => raster(1, 1))
  for (const input of [
    '/tmp/private.png',
    'https://example.com/image.png',
    png.buffer,
    new Uint8Array(),
    new Uint8Array(PLAYER_BACKGROUND_LIMITS.inputBytes + 1),
    Buffer.from('<svg><script>alert(1)</script></svg>'),
    Buffer.from('not an image'),
  ])
    expect(() => preparePlayerBackground(input, decode)).toThrow()
  expect(decode).not.toHaveBeenCalled()
})
it('rejects extreme encoded pixel dimensions before allocating a decoded raster', () => {
  const decode = vi.fn(() => raster(1, 1)),
    gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    webp = Buffer.alloc(30)
  gif.writeUInt16LE(9000, 6)
  gif.writeUInt16LE(9000, 8)
  webp.write('RIFF', 0)
  webp.write('WEBP', 8)
  webp.write('VP8X', 12)
  webp.writeUIntLE(8999, 24, 3)
  webp.writeUIntLE(8999, 27, 3)
  for (const input of [pngHeader(8000, 8000), pngHeader(20000, 1), gif, webp])
    expect(() => preparePlayerBackground(input, decode)).toThrow('尺寸')
  expect(decode).not.toHaveBeenCalled()
})
it('rejects malformed headers and images the native decoder cannot read', () => {
  const decode = vi.fn(() => raster(1, 1))
  expect(() => preparePlayerBackground(Buffer.from([255, 216, 255, 217]), decode)).toThrow('尺寸')
  expect(decode).not.toHaveBeenCalled()
  expect(() =>
    preparePlayerBackground(png, () => ({ ...raster(1, 1), isEmpty: () => true })),
  ).toThrow('无法解码')
  expect(() =>
    preparePlayerBackground(png, () => {
      throw new Error('decoder failure')
    }),
  ).toThrow('无法解码')
})
it('decodes a newly supplied persisted image instead of trusting a forged PNG header', () => {
  const image = `data:image/png;base64,${png.toString('base64')}`,
    decode = vi.fn(() => ({ ...raster(1, 1), isEmpty: () => true }))
  expect(() => normalizeStoredPlayerBackground(image, decode)).toThrow('无法解码')
  expect(decode).toHaveBeenCalledOnce()
  expect(() => normalizeStoredPlayerBackground('file:///tmp/image.png', decode)).toThrow()
  expect(decode).toHaveBeenCalledOnce()
})
it('rejects truncated, noncanonical and over-dimension PNG data URLs', () => {
  const image = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`
  expect(() => validatePlayerBackgroundImage(image(png.subarray(0, 33)))).toThrow('不完整')
  expect(() => validatePlayerBackgroundImage(image(pngHeader(2049, 1)))).toThrow('尺寸')
  const noncanonical = image(png).replace(/II=$/, 'IJ=')
  expect(noncanonical).not.toBe(image(png))
  expect(() => validatePlayerBackgroundImage(noncanonical)).toThrow('编码')
})

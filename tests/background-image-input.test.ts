import { expect, it } from 'vitest'
import {
  assertBackgroundImageDimensions,
  validateBackgroundImageBytes,
} from '../src/shared/background-image'
import { PLAYER_BACKGROUND_LIMITS } from '../src/shared/desktop'

const png = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
    'base64',
  ),
)
function webp(chunk: string, length: number) {
  const bytes = new Uint8Array(length)
  for (const [text, start] of [
    ['RIFF', 0],
    ['WEBP', 8],
    [chunk, 12],
  ] as const)
    [...text].forEach((character, index) => (bytes[start + index] = character.charCodeAt(0)))
  return bytes
}

it('reads PNG, JPEG and GIF dimensions from bytes before either renderer or main decoding', () => {
  const jpeg = new Uint8Array([255, 216, 255, 192, 0, 11, 8, 0, 2, 0, 3, 1, 1, 17, 0, 255, 217]),
    gif = new Uint8Array(
      Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    )
  expect(validateBackgroundImageBytes(png)).toEqual({ mime: 'image/png', width: 1, height: 1 })
  expect(validateBackgroundImageBytes(jpeg)).toEqual({ mime: 'image/jpeg', width: 3, height: 2 })
  expect(validateBackgroundImageBytes(gif)).toEqual({ mime: 'image/gif', width: 1, height: 1 })
})
it('honors Uint8Array byte offsets so a sliced file is not mistaken for its surrounding buffer', () => {
  const enclosing = new Uint8Array(png.length + 20)
  enclosing.set(png, 12)
  expect(validateBackgroundImageBytes(enclosing.subarray(12, 12 + png.length))).toEqual({
    mime: 'image/png',
    width: 1,
    height: 1,
  })
})
it('reads all supported WebP dimension headers with their packed little-endian fields', () => {
  const extended = webp('VP8X', 30),
    lossless = webp('VP8L', 25),
    lossy = webp('VP8 ', 30)
  extended[24] = 255
  extended[25] = 1
  extended[27] = 127
  lossless[20] = 47
  new DataView(lossless.buffer).setUint32(21, 512 | (257 << 14), true)
  lossy.set([157, 1, 42], 23)
  const view = new DataView(lossy.buffer)
  view.setUint16(26, 529 | 0x8000, true)
  view.setUint16(28, 317 | 0x4000, true)
  expect(validateBackgroundImageBytes(extended)).toEqual({
    mime: 'image/webp',
    width: 512,
    height: 128,
  })
  expect(validateBackgroundImageBytes(lossless)).toEqual({
    mime: 'image/webp',
    width: 513,
    height: 258,
  })
  expect(validateBackgroundImageBytes(lossy)).toEqual({
    mime: 'image/webp',
    width: 529,
    height: 317,
  })
})
it('rejects truncated headers, nonimage input and oversized local bytes', () => {
  for (const bytes of [
    png.subarray(0, 24),
    new Uint8Array([255, 216, 255, 217]),
    webp('VP8X', 20),
    webp('VP8L', 20),
    webp('VP8 ', 20),
    new TextEncoder().encode('<svg/>'),
    new Uint8Array(PLAYER_BACKGROUND_LIMITS.inputBytes + 1),
  ])
    expect(() => validateBackgroundImageBytes(bytes)).toThrow()
  for (const bytes of [null, png.buffer, [137, 80, 78, 71], 'file:///tmp/picture.png'])
    expect(() => validateBackgroundImageBytes(bytes)).toThrow()
})
it('applies the same pixel and side limits to encoded headers and decoded image dimensions', () => {
  const oversized = new Uint8Array(png),
    view = new DataView(oversized.buffer)
  view.setUint32(16, 8000)
  view.setUint32(20, 8000)
  expect(() => validateBackgroundImageBytes(oversized)).toThrow('尺寸')
  for (const size of [
    { width: 8000, height: 8000 },
    { width: 16385, height: 1 },
    { width: 0, height: 10 },
    { width: 1, height: Infinity },
    { width: 4.5, height: 8 },
  ])
    expect(() => assertBackgroundImageDimensions(size)).toThrow('尺寸')
  expect(() => assertBackgroundImageDimensions({ width: 8000, height: 4000 })).not.toThrow()
})

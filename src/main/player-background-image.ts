import {
  PLAYER_BACKGROUND_LIMITS,
  validatePlayerBackgroundImage,
  type PreparedPlayerBackground,
} from '../shared/desktop'
import {
  assertBackgroundImageDimensions,
  validateBackgroundImageBytes,
} from '../shared/background-image'

interface RasterImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number; height: number; quality: 'best' }): RasterImage
  toPNG(): Buffer
}
type Decoder = (bytes: Buffer) => RasterImage
/** Decode local bytes only, then persist a bounded PNG independent of the source file. */
export function preparePlayerBackground(value: unknown, decode: Decoder): PreparedPlayerBackground {
  validateBackgroundImageBytes(value)
  const bytes = Buffer.from(value as Uint8Array)
  let source: RasterImage
  try {
    source = decode(bytes)
    if (source.isEmpty()) throw new Error('empty')
  } catch {
    throw new Error('无法解码背景图片，请选择有效的 PNG、JPEG、GIF 或 WebP 图片')
  }
  const size = source.getSize()
  assertBackgroundImageDimensions(size)
  const scale = Math.min(
    1,
    PLAYER_BACKGROUND_LIMITS.storedDimension / Math.max(size.width, size.height),
  )
  let width = Math.max(1, Math.round(size.width * scale)),
    height = Math.max(1, Math.round(size.height * scale))
  for (let attempt = 0; attempt < 12; attempt++) {
    const image =
        width === size.width && height === size.height
          ? source
          : source.resize({ width, height, quality: 'best' }),
      png = image.toPNG()
    if (png.length > 0 && png.length <= PLAYER_BACKGROUND_LIMITS.storedBytes) {
      const normalized = validatePlayerBackgroundImage(
        `data:image/png;base64,${png.toString('base64')}`,
      )
      return { image: normalized, ...image.getSize() }
    }
    if (width === 1 && height === 1) break
    width = Math.max(1, Math.floor(width * 0.75))
    height = Math.max(1, Math.floor(height * 0.75))
  }
  throw new Error('背景图片处理后仍超过 2 MiB，请选择较小的图片')
}

export function normalizeStoredPlayerBackground(image: unknown, decode: Decoder) {
  const valid = validatePlayerBackgroundImage(image)
  return preparePlayerBackground(
    Buffer.from(valid.slice('data:image/png;base64,'.length), 'base64'),
    decode,
  ).image
}

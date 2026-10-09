import { PLAYER_BACKGROUND_LIMITS } from './desktop'
import { imageFormat } from './image-format'

export interface BackgroundImageInfo {
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  width: number
  height: number
}
const maximumInputDimension = 16384,
  maximumInputPixels = 32_000_000

function inputSize(bytes: Uint8Array, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mime === 'image/png') return { width: view.getUint32(16), height: view.getUint32(20) }
  if (mime === 'image/gif')
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  if (mime === 'image/jpeg') {
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 216 || marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) break
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) }
      }
      offset += length
    }
  }
  if (mime === 'image/webp') {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16)),
      read24 = (offset: number) =>
        bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
    if (chunk === 'VP8X' && bytes.length >= 30)
      return { width: read24(24) + 1, height: read24(27) + 1 }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 47)
      return {
        width: (bytes[21] | ((bytes[22] & 63) << 8)) + 1,
        height: ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 15) << 10)) + 1,
      }
    if (
      chunk === 'VP8 ' &&
      bytes.length >= 30 &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    )
      return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 }
  }
  throw new Error('无法读取背景图片尺寸，请选择有效的 PNG、JPEG、GIF 或 WebP 图片')
}
export function assertBackgroundImageDimensions({
  width,
  height,
}: {
  width: number
  height: number
}) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    Math.max(width, height) > maximumInputDimension ||
    width * height > maximumInputPixels
  )
    throw new Error('背景图片尺寸过大或无效，请选择不超过 3200 万像素的图片')
}

/** Check encoded dimensions before either browser or main-process image decoding. */
export function validateBackgroundImageBytes(value: unknown): BackgroundImageInfo {
  if (
    !(value instanceof Uint8Array) ||
    !(value.buffer instanceof ArrayBuffer) ||
    !value.byteLength ||
    value.byteLength > PLAYER_BACKGROUND_LIMITS.inputBytes
  )
    throw new Error('背景图片为空或超过 20 MiB')
  const format = imageFormat(value)
  if (!format) throw new Error('请选择 PNG、JPEG、GIF 或 WebP 背景图片')
  const size = inputSize(value, format.mime)
  assertBackgroundImageDimensions(size)
  return { mime: format.mime as BackgroundImageInfo['mime'], ...size }
}

import {
  assertBackgroundImageDimensions,
  validateBackgroundImageBytes,
} from '../../shared/background-image'
import { PLAYER_BACKGROUND_LIMITS, type PreparedPlayerBackground } from '../../shared/desktop'

/** Chromium decodes local image formats; the main process validates the resulting static PNG. */
export async function importPlayerBackground(file: File): Promise<PreparedPlayerBackground> {
  if (file.size > PLAYER_BACKGROUND_LIMITS.inputBytes) throw new Error('背景图片不能超过 20 MiB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { mime } = validateBackgroundImageBytes(bytes)
  let bitmap: ImageBitmap | undefined
  let png: Blob
  try {
    bitmap = await createImageBitmap(new Blob([bytes.buffer], { type: mime }))
    assertBackgroundImageDimensions(bitmap)
    const scale = Math.min(
      1,
      PLAYER_BACKGROUND_LIMITS.storedDimension / Math.max(bitmap.width, bitmap.height),
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境无法处理背景图片')
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('背景图片转换失败'))),
        'image/png',
      )
    })
  } catch (error: any) {
    throw new Error(error.message || '无法读取背景图片，请选择有效的 PNG、JPEG、GIF 或 WebP 图片')
  } finally {
    bitmap?.close()
  }
  return window.together.preparePlayerBackground(new Uint8Array(await png.arrayBuffer()))
}

export interface ImageFormat {
  mime: string
  extension: string
}

/** CDN Content-Type and file extensions are advisory; classify the stored bytes. */
export function imageFormat(bytes: Uint8Array): ImageFormat | undefined {
  const matches = (values: number[], offset = 0) =>
    values.every((value, index) => bytes[offset + index] === value)
  const ascii = (value: string, offset: number) =>
    matches(
      Array.from(value, (character) => character.charCodeAt(0)),
      offset,
    )
  if (
    bytes.length >= 33 &&
    matches([137, 80, 78, 71, 13, 10, 26, 10]) &&
    matches([0, 0, 0, 13], 8) &&
    ascii('IHDR', 12)
  )
    return { mime: 'image/png', extension: 'png' }
  if (bytes.length >= 4 && matches([255, 216, 255])) return { mime: 'image/jpeg', extension: 'jpg' }
  if (bytes.length >= 13 && (ascii('GIF87a', 0) || ascii('GIF89a', 0)))
    return { mime: 'image/gif', extension: 'gif' }
  if (
    bytes.length >= 20 &&
    ascii('RIFF', 0) &&
    ascii('WEBP', 8) &&
    ['VP8 ', 'VP8L', 'VP8X'].some((chunk) => ascii(chunk, 12))
  )
    return { mime: 'image/webp', extension: 'webp' }
}

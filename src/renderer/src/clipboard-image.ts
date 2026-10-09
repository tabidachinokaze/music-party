/** Return only an actual clipboard image file; text and links keep normal paste behavior. */
export function clipboardImage(
  data: Pick<DataTransfer, 'items' | 'files'> | null,
): File | undefined {
  if (!data) return
  for (const item of Array.from(data.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const image = item.getAsFile()
      if (image) return image
    }
  }
  return Array.from(data.files || []).find((file) => file.type.startsWith('image/'))
}

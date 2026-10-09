import type { Preferences } from '../../shared/desktop'

type Color = readonly [number, number, number]
function color(hex: string): Color {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error('主题颜色无效')
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as unknown as Color
}
function hex(value: Color) {
  return '#' + value.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')
}
function mix(from: Color, to: Color, amount: number): Color {
  return from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  ) as unknown as Color
}
function luminance(value: Color) {
  const channels = value.map((channel) => {
    const v = channel / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
export function colorContrast(a: string, b: string) {
  const first = luminance(color(a)),
    second = luminance(color(b))
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** Keep the chosen hue while deriving readable text and paired control surfaces. */
export function accentPalette(seed: string, theme: 'dark' | 'light') {
  const source = color(seed)
  const white = color('#ffffff'),
    black = color('#000000')
  const dark = theme === 'dark'
  const surface = color(dark ? '#202025' : '#e6e6ec')
  const container = hex(mix(surface, source, 0.18))
  const containerHover = hex(mix(surface, source, 0.26))
  const backgrounds = [container, containerHover, dark ? '#30313a' : '#c5c6cf']
  let text = hex(source)
  for (let amount = 0; amount <= 100; amount++) {
    text = hex(mix(source, dark ? white : black, amount / 100))
    if (backgrounds.every((background) => colorContrast(text, background) >= 4.5)) break
  }
  const fill = hex(source)
  const onFill =
    colorContrast(fill, '#ffffff') >= colorContrast(fill, '#000000') ? '#ffffff' : '#000000'
  return {
    text,
    fill,
    onFill,
    fillHover: hex(mix(source, onFill === '#ffffff' ? black : white, 0.12)),
    container,
    containerHover,
    border: hex(mix(color(container), color(text), 0.45)),
  }
}

export function applyAppearance(
  root: HTMLElement,
  preferences: Preferences,
  theme: 'dark' | 'light',
) {
  root.style.setProperty('--ui-font-scale', String(preferences.fontScale / 100))
  const roles = [
    'text',
    'fill',
    'onFill',
    'fillHover',
    'container',
    'containerHover',
    'border',
  ] as const
  if (!preferences.accentColor) {
    delete root.dataset.customAccent
    root.style.removeProperty('--pink')
    for (const role of roles) root.style.removeProperty('--accent-' + role)
    return
  }
  root.dataset.customAccent = 'true'
  const palette = accentPalette(preferences.accentColor, theme)
  root.style.setProperty('--pink', palette.text)
  for (const role of roles) root.style.setProperty('--accent-' + role, palette[role])
}

import { expect, it } from 'vitest'
import { accentPalette, colorContrast } from '../src/renderer/src/appearance'

it('keeps custom accents readable in both themes, including extreme colors', () => {
  for (const theme of ['dark', 'light'] as const)
    for (const seed of [
      '#000000',
      '#ffffff',
      '#448aff',
      '#777777',
      '#ff00ff',
      '#ffff00',
      '#3c9d78',
    ]) {
      const palette = accentPalette(seed, theme)
      expect(palette.fill).toBe(seed)
      expect(colorContrast(palette.fill, palette.onFill)).toBeGreaterThanOrEqual(4.5)
      expect(colorContrast(palette.fillHover, palette.onFill)).toBeGreaterThanOrEqual(4.5)
      expect(colorContrast(palette.text, palette.container)).toBeGreaterThanOrEqual(4.5)
      expect(colorContrast(palette.text, palette.containerHover)).toBeGreaterThanOrEqual(4.5)
      expect(
        colorContrast(palette.text, theme === 'dark' ? '#30313a' : '#c5c6cf'),
      ).toBeGreaterThanOrEqual(4.5)
    }
})

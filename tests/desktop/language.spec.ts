import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveUiLanguage,
  translateIn,
  type StaticMessageKey,
  type UiLanguage,
} from '../../src/shared/ui-language'
import { widenPanel } from './windows'

test('system language and explicit choices apply to the player, desktop menus and API worker', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'music-party-device-language-'))
  const launch = (language: string) =>
    electron.launch({
      args: ['.', '--password-store=basic'],
      env: {
        ...process.env,
        LANGUAGE: language,
        MUSIC_PARTY_PROFILE: profile,
        MUSIC_PARTY_API_URL: 'http://127.0.0.1:1',
        ELECTRON_RENDERER_URL: '',
      },
    })
  let app = await launch('zh_HK:en')
  try {
    const page = await app.firstWindow()
    const deviceLanguages = await app.evaluate(({ app }) => app.getPreferredSystemLanguages())
    const system = resolveUiLanguage('system', deviceLanguages)
    if (process.platform === 'linux') expect(system).toBe('zh-TW')
    let expectedLanguage = system
    const label = (key: StaticMessageKey) => translateIn(expectedLanguage, key)
    async function expectLanguage(language: UiLanguage) {
      expectedLanguage = language
      await expect(page.locator('html')).toHaveAttribute('lang', language)
      expect(
        await app.evaluate(
          ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('desktop-show')?.label,
        ),
      ).toBe(label('desktop.showWindow'))
      const worker = await page.evaluate(() => window.together.call({ method: 'albums' }))
      expect(worker.error).toBe(label('service.scanTheQrCodeToSignInFirst'))
    }
    await expectLanguage(system)
    await widenPanel(app, page, 1150, 750)
    await page
      .locator('.main-sidebar')
      .getByRole('button', { name: label('common.settings'), exact: true })
      .click()
    const choices = () =>
      page.getByRole('group', { name: label('common.interfaceLanguage'), exact: true })
    await expect(
      choices().getByRole('button', { name: label('settings.system'), exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await widenPanel(app, page, 321, 682)
    if (!(await choices().isVisible()))
      await page
        .getByRole('navigation', { name: label('settings.settingsCategories') })
        .getByRole('button', { name: label('common.appearance'), exact: true })
        .click()
    for (const [name, language] of [
      ['简体中文', 'zh-CN'],
      ['繁體中文', 'zh-TW'],
      ['English', 'en'],
      ['日本語', 'ja'],
    ] as const) {
      await choices().getByRole('button', { name, exact: true }).click()
      await expectLanguage(language)
      await expect(choices().getByRole('button')).toHaveCount(5)
      const bounds = await choices()
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const box = button.getBoundingClientRect()
            return (
              box.width > 0 &&
              box.left >= 0 &&
              box.right <= innerWidth + 1 &&
              button.scrollWidth <= button.clientWidth + 1
            )
          }),
        )
      expect(bounds).toEqual([true, true, true, true, true])
      await expect(choices().getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }
    await choices()
      .getByRole('button', { name: label('settings.system'), exact: true })
      .click()
    await expectLanguage(system)
    await app.close()
    app = await launch('ja_JP:en')
    const restarted = await app.firstWindow()
    const preferred = await app.evaluate(({ app }) => app.getPreferredSystemLanguages())
    const restored = resolveUiLanguage('system', preferred)
    if (process.platform === 'linux') expect(restored).toBe('ja')
    await expect(restarted.locator('html')).toHaveAttribute('lang', restored)
    const info = await restarted.evaluate(() => window.together.desktopInfo())
    expect(info.preferences.language).toBe('system')
    expect(info.resolvedLanguage).toBe(restored)
    await restarted.evaluate(() => window.together.updatePreferences({ language: 'zh-TW' }))
    await app.close()
    app = await launch('en_US')
    const fixed = await app.firstWindow()
    await expect(fixed.locator('html')).toHaveAttribute('lang', 'zh-TW')
    const saved = await fixed.evaluate(() => window.together.desktopInfo())
    expect(saved.preferences.language).toBe('zh-TW')
    expect(saved.resolvedLanguage).toBe('zh-TW')
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})

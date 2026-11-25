import en from './locales/en'
import ja from './locales/ja'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'

export type MessageKey = keyof typeof en
export type UiLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja'
export type LanguagePreference = UiLanguage | 'system'

type Message = string | { readonly one: string; readonly other: string }
export const catalogs = { 'zh-CN': zhCN, 'zh-TW': zhTW, en, ja } as const satisfies Record<
  UiLanguage,
  Record<MessageKey, Message>
>

type Template<T> = T extends string ? T : T extends { other: infer S extends string } ? S : never
type Names<S extends string> = S extends `${string}{${infer N}}${infer Rest}`
  ? N | Names<Rest>
  : never
type ParametersFor<K extends MessageKey> = Names<Template<(typeof en)[K]>>
type ArgumentsFor<K extends MessageKey> = [ParametersFor<K>] extends [never]
  ? []
  : [values: { [N in ParametersFor<K>]: N extends 'count' ? number : number | string }]
export type StaticMessageKey = {
  [K in MessageKey]: ArgumentsFor<K> extends [] ? K : never
}[MessageKey]

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && Object.hasOwn(catalogs, value)
}

export function resolveUiLanguage(
  preference: LanguagePreference,
  systemLanguages: readonly string[],
): UiLanguage {
  if (isUiLanguage(preference)) return preference
  for (const raw of systemLanguages) {
    try {
      const tag = raw.trim().split(/[.@]/, 1)[0].replaceAll('_', '-')
      const locale = new Intl.Locale(tag)
      if (locale.language === 'zh') return locale.maximize().script === 'Hant' ? 'zh-TW' : 'zh-CN'
      if (locale.language === 'ja' || locale.language === 'en') return locale.language
    } catch {
      // An invalid OS preference must not hide a supported language further down the list.
    }
  }
  return 'en'
}

let language: UiLanguage = 'zh-CN'

export function getUiLanguage(): UiLanguage {
  return language
}

export function setUiLanguage(value: UiLanguage) {
  language = value
}

const pluralRules = new Map<UiLanguage, Intl.PluralRules>()

function formatMessage(
  locale: UiLanguage,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const entry: Message = catalogs[locale][key]
  let template: string
  if (typeof entry === 'string') {
    template = entry
  } else {
    let rules = pluralRules.get(locale)
    if (!rules) {
      rules = new Intl.PluralRules(locale)
      pluralRules.set(locale, rules)
    }
    template = rules.select(Number(values?.count)) === 'one' ? entry.one : entry.other
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!values || !Object.hasOwn(values, name)) throw new Error(`Missing {${name}} in ${key}`)
    return String(values[name])
  })
}

export function translateIn<K extends MessageKey>(
  locale: UiLanguage,
  key: K,
  ...args: ArgumentsFor<K>
): string {
  return formatMessage(locale, key, args[0])
}

export function t<K extends MessageKey>(key: K, ...args: ArgumentsFor<K>): string {
  return formatMessage(language, key, args[0])
}

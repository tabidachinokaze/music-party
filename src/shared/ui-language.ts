export type UiLanguage = 'zh-CN' | 'en'

let language: UiLanguage = 'zh-CN'

export function getUiLanguage(): UiLanguage {
  return language
}

export function setUiLanguage(value: UiLanguage) {
  language = value === 'en' ? 'en' : 'zh-CN'
}

/** Format only application copy. Arguments are user or service data and pass through verbatim. */
export function ui(chinese: string, english: string, ...values: unknown[]): string {
  const text = language === 'en' ? english : chinese
  if (!values.length) return text
  return text.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ''))
}

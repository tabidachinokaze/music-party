import type { StaticMessageKey } from './ui-language'

export type UpdateMessageKey = Extract<StaticMessageKey, `updates.${string}`>
export const PROJECT_URL = 'https://github.com/tabidachinokaze/music-party'
export const PROJECT_LINKS = {
  repository: PROJECT_URL,
  releases: `${PROJECT_URL}/releases`,
  issues: `${PROJECT_URL}/issues`,
} as const
export type ProjectLink = keyof typeof PROJECT_LINKS
export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  version?: string
  releaseNotes?: string
  percent?: number
  transferred?: number
  total?: number
  message: UpdateMessageKey
}
export function updateSupport(
  packaged: boolean,
  platform: string,
  appImage?: string,
): UpdateMessageKey | null {
  if (!packaged) return 'updates.unsupportedDevelopment'
  if (platform === 'linux' && !appImage) return 'updates.requiresAppImage'
  if (platform !== 'linux' && platform !== 'win32') return 'updates.unsupportedPlatform'
  return null
}
export function plainReleaseNotes(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : Array.isArray(value)
        ? value
            .slice(0, 10)
            .map((item) => (typeof item?.note === 'string' ? item.note : ''))
            .join('\n')
        : ''
  return text
    .slice(0, 16000)
    .replace(/<[^>]*>/g, '')
    .slice(0, 8000)
}

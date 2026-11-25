import { isUiLanguage, t, type LanguagePreference, type UiLanguage } from './ui-language'
import { imageFormat } from './image-format'

export interface PlayerBackground {
  image: string | null
  zoom: number
  /** Image opacity is stored in its original format for existing profiles. */
  opacity: number
  layoutTransparency: number
  popupTransparency: number
  componentTransparency: number
  blur: number
  x: number
  y: number
}
const transparencyFields = [
  'layoutTransparency',
  'componentTransparency',
  'popupTransparency',
] as const
export type BackgroundTransparency = Pick<PlayerBackground, (typeof transparencyFields)[number]>
type Wallpaper = Omit<PlayerBackground, keyof BackgroundTransparency>

export interface PreparedPlayerBackground {
  image: string
  width: number
  height: number
}
export const PLAYER_BACKGROUND_LIMITS = {
  inputBytes: 20 * 1024 * 1024,
  storedBytes: 2 * 1024 * 1024,
  storedDimension: 2048,
} as const
export const DEFAULT_PLAYER_BACKGROUND: PlayerBackground = {
  image: null,
  zoom: 100,
  opacity: 48,
  layoutTransparency: 100,
  componentTransparency: 16,
  popupTransparency: 12,
  blur: 0,
  x: 50,
  y: 50,
}

export interface Preferences {
  language: LanguagePreference
  closeToTray: boolean
  mediaKeys: boolean
  theme: 'dark' | 'light' | 'system'
  volume: number
  repeatMode: 'order' | 'loop' | 'single'
  /** Stored under the original key so existing display preferences carry over. */
  fontScale: number
  accentColor: string | null
  playerBackground: PlayerBackground
}
export type PreferencesUpdate = Omit<Partial<Preferences>, 'playerBackground'> & {
  playerBackground?: Wallpaper | Partial<BackgroundTransparency> | PlayerBackground
}

export interface WindowGeometry {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'
export type NavigationDirection = 'back' | 'forward'
export interface DesktopInfo {
  maximized: boolean
  preferences: Preferences
  trayAvailable: boolean
  fullScreen: boolean
  fullScreenRevision: number
  resolvedLanguage: UiLanguage
  resolvedTheme: 'dark' | 'light'
  platform: string
  persistenceError: string
}
export type PlayerCommand =
  'toggle' | 'play' | 'pause' | 'next' | 'previous' | 'settings' | 'lyrics' | 'show'
export interface DesktopMediaState {
  title: string
  artist: string
  playing: boolean
  canToggle: boolean
  canNext: boolean
  canPrevious: boolean
  roomId: string | null
}
export const DEFAULT_PREFERENCES: Preferences = {
  language: 'system',
  closeToTray: true,
  mediaKeys: true,
  theme: 'light',
  volume: 0.6,
  repeatMode: 'order',
  fontScale: 100,
  accentColor: null,
  playerBackground: { ...DEFAULT_PLAYER_BACKGROUND },
}
export function validatePlayerBackgroundImage(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,'))
    throw new Error(t('desktop.thePlayerBackgroundMustBeAProcessedPng'))
  const encoded = value.slice('data:image/png;base64,'.length)
  if (
    encoded.length < 44 ||
    encoded.length > Math.ceil(PLAYER_BACKGROUND_LIMITS.storedBytes / 3) * 4 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error(t('desktop.theBackgroundImageIsEmptyInvalidOrLarger'))
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  if ((encoded.length / 4) * 3 - padding > PLAYER_BACKGROUND_LIMITS.storedBytes)
    throw new Error(t('desktop.theBackgroundImageExceeds2Mib'))
  if (btoa(atob(encoded.slice(-4))) !== encoded.slice(-4))
    throw new Error(t('desktop.invalidBackgroundImageEncoding'))
  const header = Uint8Array.from(atob(encoded.slice(0, 44)), (character) => character.charCodeAt(0))
  if (imageFormat(header)?.mime !== 'image/png')
    throw new Error(t('desktop.theBackgroundIsNotAPngImage'))
  const ending = Uint8Array.from(atob(encoded.slice(-24)), (character) =>
    character.charCodeAt(0),
  ).slice(-12)
  if (
    ![0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130].every((byte, index) => ending[index] === byte)
  )
    throw new Error(t('desktop.theBackgroundPngIsIncomplete'))
  const bytes = new DataView(header.buffer),
    width = bytes.getUint32(16),
    height = bytes.getUint32(20)
  if (!width || !height || Math.max(width, height) > PLAYER_BACKGROUND_LIMITS.storedDimension)
    throw new Error(t('desktop.invalidBackgroundDimensionsChooseAnotherImage'))
  return value
}
export function validatePlayerBackground(
  value: unknown,
  previous?: PlayerBackground,
): PlayerBackground {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(t('desktop.invalidBackgroundSettings'))
  const keys = Object.keys(value)
  const surfacesOnly =
    previous &&
    keys.length > 0 &&
    keys.every((key) => transparencyFields.some((field) => key === field))
  // The appearance sliders and wallpaper editor own different fields. Merge at save time.
  const { layoutTransparency, componentTransparency, popupTransparency } =
    previous ?? DEFAULT_PLAYER_BACKGROUND
  const background: Record<string, unknown> = {
    ...(surfacesOnly ? previous : { layoutTransparency, componentTransparency, popupTransparency }),
    ...value,
  }
  const limits = {
    zoom: [100, 300],
    opacity: [0, 100],
    layoutTransparency: [0, 100],
    componentTransparency: [0, 100],
    popupTransparency: [0, 100],
    blur: [0, 30],
    x: [0, 100],
    y: [0, 100],
  }
  if (Object.keys(background).some((key) => key !== 'image' && !Object.hasOwn(limits, key)))
    throw new Error(t('settings.background.invalidFields'))
  const image = background.image === null ? null : validatePlayerBackgroundImage(background.image)
  for (const [key, [minimum, maximum]] of Object.entries(limits)) {
    const item = background[key]
    if (typeof item !== 'number' || !Number.isFinite(item) || item < minimum || item > maximum)
      throw new Error(t('desktop.backgroundSettingOutOfRange', { key }))
  }
  return {
    image,
    zoom: background.zoom as number,
    opacity: background.opacity as number,
    layoutTransparency: background.layoutTransparency as number,
    componentTransparency: background.componentTransparency as number,
    popupTransparency: background.popupTransparency as number,
    blur: background.blur as number,
    x: background.x as number,
    y: background.y as number,
  }
}
export function validatePreferences(
  value: unknown,
  previousBackground?: PlayerBackground,
): Partial<Preferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(t('desktop.invalidSettingsFormat'))
  const result: Partial<Preferences> = {}
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'closeToTray' || key === 'mediaKeys') && typeof item === 'boolean')
      result[key] = item
    else if (key === 'language' && (item === 'system' || isUiLanguage(item))) result.language = item
    else if (key === 'theme' && ['dark', 'light', 'system'].includes(String(item)))
      result.theme = item as Preferences['theme']
    else if (
      key === 'volume' &&
      typeof item === 'number' &&
      Number.isFinite(item) &&
      item >= 0 &&
      item <= 1
    )
      result.volume = item
    else if (key === 'repeatMode' && ['order', 'loop', 'single'].includes(String(item)))
      result.repeatMode = item as Preferences['repeatMode']
    else if (
      key === 'fontScale' &&
      typeof item === 'number' &&
      Number.isInteger(item) &&
      item >= 80 &&
      item <= 150
    )
      result.fontScale = item
    else if (key === 'accentColor' && item === null) result.accentColor = null
    else if (key === 'accentColor' && typeof item === 'string' && /^#[\da-f]{6}$/i.test(item))
      result.accentColor = item.toLowerCase()
    else if (key === 'playerBackground')
      result.playerBackground = validatePlayerBackground(item, previousBackground)
    else throw new Error(t('desktop.unsupportedOrInvalidSetting', { key }))
  }
  return result
}
export function validateMediaState(value: unknown): DesktopMediaState {
  if (!value || typeof value !== 'object') throw new Error(t('desktop.invalidPlaybackInformation'))
  const v = value as Record<string, unknown>
  for (const key of ['title', 'artist'])
    if (typeof v[key] !== 'string' || (v[key] as string).length > 300)
      throw new Error(t('desktop.invalidTrackInformation'))
  for (const key of ['playing', 'canToggle', 'canNext', 'canPrevious'])
    if (typeof v[key] !== 'boolean') throw new Error(t('desktop.invalidPlaybackState'))
  if (v.roomId !== null && (typeof v.roomId !== 'string' || !/^[\w-]{1,128}$/.test(v.roomId)))
    throw new Error(t('desktop.invalidRoomInformation'))
  return {
    title: v.title as string,
    artist: v.artist as string,
    playing: v.playing as boolean,
    canToggle: v.canToggle as boolean,
    canNext: v.canNext as boolean,
    canPrevious: v.canPrevious as boolean,
    roomId: v.roomId as string | null,
  }
}
export const MIN_WINDOW_SIZE = { width: 288, height: 350 } as const
export function restoreWindow(
  saved: WindowGeometry | undefined,
  areas: { x: number; y: number; width: number; height: number }[],
  frame = { width: 0, height: 0 },
): Required<WindowGeometry> {
  let area = areas[0] || { x: 0, y: 0, width: 1280, height: 850 }
  const desiredWidth =
    saved && Number.isFinite(saved.width) && saved.width > 0 ? Math.round(saved.width) : 1100
  const desiredHeight =
    saved && Number.isFinite(saved.height) && saved.height > 0 ? Math.round(saved.height) : 720
  const left = saved?.x,
    top = saved?.y
  const placed =
    left !== undefined && top !== undefined && Number.isFinite(left) && Number.isFinite(top)
  let bestOverlap = 0
  if (placed) {
    for (const display of areas) {
      const horizontal =
        Math.min(left + desiredWidth + frame.width, display.x + display.width) -
        Math.max(left, display.x)
      const vertical =
        Math.min(top + desiredHeight + frame.height, display.y + display.height) -
        Math.max(top, display.y)
      const overlap = Math.max(0, horizontal) * Math.max(0, vertical)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        area = display
      }
    }
  }
  const availableWidth = Math.max(1, area.width - frame.width)
  const availableHeight = Math.max(1, area.height - frame.height)
  const width = Math.min(Math.max(MIN_WINDOW_SIZE.width, desiredWidth), availableWidth)
  const height = Math.min(Math.max(MIN_WINDOW_SIZE.height, desiredHeight), availableHeight)
  const roomX = availableWidth - width,
    roomY = availableHeight - height
  const x =
    placed && bestOverlap ? Math.max(area.x, Math.min(left, area.x + roomX)) : area.x + roomX / 2
  const y =
    placed && bestOverlap ? Math.max(area.y, Math.min(top, area.y + roomY)) : area.y + roomY / 2
  return { x: Math.round(x), y: Math.round(y), width, height, maximized: saved?.maximized === true }
}

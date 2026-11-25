import { ui, type UiLanguage } from './ui-language'
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
  language: UiLanguage
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
  language: 'zh-CN',
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
    throw new Error(
      ui(
        '播放器背景必须是经过处理的 PNG 图片',
        'The player background must be a processed PNG image.',
      ),
    )
  const encoded = value.slice('data:image/png;base64,'.length)
  if (
    encoded.length < 44 ||
    encoded.length > Math.ceil(PLAYER_BACKGROUND_LIMITS.storedBytes / 3) * 4 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error(
      ui(
        '播放器背景图片为空、格式无效或超过 2 MiB',
        'The background image is empty, invalid or larger than 2 MiB.',
      ),
    )
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  if ((encoded.length / 4) * 3 - padding > PLAYER_BACKGROUND_LIMITS.storedBytes)
    throw new Error(ui('播放器背景图片超过 2 MiB', 'The background image exceeds 2 MiB.'))
  if (btoa(atob(encoded.slice(-4))) !== encoded.slice(-4))
    throw new Error(ui('播放器背景图片编码无效', 'Invalid background image encoding.'))
  const header = Uint8Array.from(atob(encoded.slice(0, 44)), (character) => character.charCodeAt(0))
  if (imageFormat(header)?.mime !== 'image/png')
    throw new Error(ui('播放器背景不是 PNG 图片', 'The background is not a PNG image.'))
  const ending = Uint8Array.from(atob(encoded.slice(-24)), (character) =>
    character.charCodeAt(0),
  ).slice(-12)
  if (
    ![0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130].every((byte, index) => ending[index] === byte)
  )
    throw new Error(ui('播放器背景 PNG 图片不完整', 'The background PNG is incomplete.'))
  const bytes = new DataView(header.buffer),
    width = bytes.getUint32(16),
    height = bytes.getUint32(20)
  if (!width || !height || Math.max(width, height) > PLAYER_BACKGROUND_LIMITS.storedDimension)
    throw new Error(
      ui(
        '播放器背景图片尺寸无效，请重新选择图片',
        'Invalid background dimensions. Choose another image.',
      ),
    )
  return value
}
export function validatePlayerBackground(
  value: unknown,
  previous = DEFAULT_PLAYER_BACKGROUND,
): PlayerBackground {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(ui('播放器背景设置格式无效', 'Invalid background settings.'))
  // Preserve surface preferences when migrating an older wallpaper profile.
  const background: Record<string, unknown> = {
    layoutTransparency: previous.layoutTransparency,
    componentTransparency: previous.componentTransparency,
    popupTransparency: previous.popupTransparency,
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
    throw new Error(
      ui(
        '播放器背景设置不完整或含未知字段',
        'Background settings are incomplete or contain unknown fields.',
      ),
    )
  const image = background.image === null ? null : validatePlayerBackgroundImage(background.image)
  for (const [key, [minimum, maximum]] of Object.entries(limits)) {
    const item = background[key]
    if (typeof item !== 'number' || !Number.isFinite(item) || item < minimum || item > maximum)
      throw new Error(
        ui('播放器背景设置超出范围：{0}', 'Background setting out of range: {0}', key),
      )
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
    throw new Error(ui('设置格式无效', 'Invalid settings format.'))
  const result: Partial<Preferences> = {}
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'closeToTray' || key === 'mediaKeys') && typeof item === 'boolean')
      result[key] = item
    else if (key === 'language' && (item === 'zh-CN' || item === 'en')) result.language = item
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
    else throw new Error(ui('不支持或无效的设置：{0}', 'Unsupported or invalid setting: {0}', key))
  }
  return result
}
export function validateMediaState(value: unknown): DesktopMediaState {
  if (!value || typeof value !== 'object')
    throw new Error(ui('播放信息无效', 'Invalid playback information.'))
  const v = value as Record<string, unknown>
  for (const key of ['title', 'artist'])
    if (typeof v[key] !== 'string' || (v[key] as string).length > 300)
      throw new Error(ui('歌曲信息无效', 'Invalid track information.'))
  for (const key of ['playing', 'canToggle', 'canNext', 'canPrevious'])
    if (typeof v[key] !== 'boolean') throw new Error(ui('播放状态无效', 'Invalid playback state.'))
  if (v.roomId !== null && (typeof v.roomId !== 'string' || !/^[\w-]{1,128}$/.test(v.roomId)))
    throw new Error(ui('房间信息无效', 'Invalid room information.'))
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

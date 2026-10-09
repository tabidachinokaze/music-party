import { imageFormat } from './image-format'

export interface PlayerBackground {
  image: string | null
  zoom: number
  opacity: number
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
  opacity: 35,
  blur: 0,
  x: 50,
  y: 50,
}

export interface Preferences {
  closeToTray: boolean
  theme: 'dark' | 'light' | 'system'
  volume: number
  repeatMode: 'order' | 'loop' | 'single'
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
export interface DesktopInfo {
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
  closeToTray: true,
  theme: 'dark',
  volume: 0.6,
  repeatMode: 'order',
  fontScale: 100,
  accentColor: null,
  playerBackground: { ...DEFAULT_PLAYER_BACKGROUND },
}
export function validatePlayerBackgroundImage(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,'))
    throw new Error('播放器背景必须是经过处理的 PNG 图片')
  const encoded = value.slice('data:image/png;base64,'.length)
  if (
    encoded.length < 44 ||
    encoded.length > Math.ceil(PLAYER_BACKGROUND_LIMITS.storedBytes / 3) * 4 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error('播放器背景图片为空、格式无效或超过 2 MiB')
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  if ((encoded.length / 4) * 3 - padding > PLAYER_BACKGROUND_LIMITS.storedBytes)
    throw new Error('播放器背景图片超过 2 MiB')
  if (btoa(atob(encoded.slice(-4))) !== encoded.slice(-4)) throw new Error('播放器背景图片编码无效')
  const header = Uint8Array.from(atob(encoded.slice(0, 44)), (character) => character.charCodeAt(0))
  if (imageFormat(header)?.mime !== 'image/png') throw new Error('播放器背景不是 PNG 图片')
  const ending = Uint8Array.from(atob(encoded.slice(-24)), (character) =>
    character.charCodeAt(0),
  ).slice(-12)
  if (
    ![0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130].every((byte, index) => ending[index] === byte)
  )
    throw new Error('播放器背景 PNG 图片不完整')
  const bytes = new DataView(header.buffer),
    width = bytes.getUint32(16),
    height = bytes.getUint32(20)
  if (!width || !height || Math.max(width, height) > PLAYER_BACKGROUND_LIMITS.storedDimension)
    throw new Error('播放器背景图片尺寸无效，请重新选择图片')
  return value
}
export function validatePlayerBackground(value: unknown): PlayerBackground {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('播放器背景设置格式无效')
  const background = value as Record<string, unknown>
  const limits = { zoom: [100, 300], opacity: [0, 100], blur: [0, 30], x: [0, 100], y: [0, 100] }
  if (
    Object.keys(background).length !== 6 ||
    Object.keys(background).some((key) => key !== 'image' && !Object.hasOwn(limits, key))
  )
    throw new Error('播放器背景设置不完整或含未知字段')
  const image = background.image === null ? null : validatePlayerBackgroundImage(background.image)
  for (const [key, [minimum, maximum]] of Object.entries(limits)) {
    const item = background[key]
    if (typeof item !== 'number' || !Number.isFinite(item) || item < minimum || item > maximum)
      throw new Error(`播放器背景设置超出范围：${key}`)
  }
  return {
    image,
    zoom: background.zoom as number,
    opacity: background.opacity as number,
    blur: background.blur as number,
    x: background.x as number,
    y: background.y as number,
  }
}
export function validatePreferences(value: unknown): Partial<Preferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式无效')
  const result: Partial<Preferences> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'closeToTray' && typeof item === 'boolean') result.closeToTray = item
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
    else if (key === 'playerBackground') result.playerBackground = validatePlayerBackground(item)
    else throw new Error(`不支持或无效的设置：${key}`)
  }
  return result
}
export function validateMediaState(value: unknown): DesktopMediaState {
  if (!value || typeof value !== 'object') throw new Error('播放信息无效')
  const v = value as Record<string, unknown>
  for (const key of ['title', 'artist'])
    if (typeof v[key] !== 'string' || (v[key] as string).length > 300)
      throw new Error('歌曲信息无效')
  for (const key of ['playing', 'canToggle', 'canNext', 'canPrevious'])
    if (typeof v[key] !== 'boolean') throw new Error('播放状态无效')
  if (v.roomId !== null && (typeof v.roomId !== 'string' || !/^[\w-]{1,128}$/.test(v.roomId)))
    throw new Error('房间信息无效')
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
export function restoreWindow(
  saved: WindowGeometry | undefined,
  areas: { x: number; y: number; width: number; height: number }[],
): WindowGeometry {
  const primary = areas[0] || { x: 0, y: 0, width: 1280, height: 850 }
  const area =
    saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? areas.find(
          (a) =>
            saved.x! + 160 < a.x + a.width &&
            saved.x! + saved.width - 160 > a.x &&
            saved.y! + 100 < a.y + a.height &&
            saved.y! + saved.height - 100 > a.y,
        ) || primary
      : primary
  const width = Math.min(
    area.width,
    Math.max(Math.min(1000, area.width), Number.isFinite(saved?.width) ? saved!.width : 1280),
  )
  const height = Math.min(
    area.height,
    Math.max(Math.min(720, area.height), Number.isFinite(saved?.height) ? saved!.height : 850),
  )
  const x =
    saved && Number.isFinite(saved.x)
      ? Math.min(Math.max(saved.x!, area.x), area.x + area.width - width)
      : area.x + Math.round((area.width - width) / 2)
  const y =
    saved && Number.isFinite(saved.y)
      ? Math.min(Math.max(saved.y!, area.y), area.y + area.height - height)
      : area.y + Math.round((area.height - height) / 2)
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    maximized: saved?.maximized === true,
  }
}

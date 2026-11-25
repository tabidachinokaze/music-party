import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  DesktopInfo,
  PlayerCommand,
  Preferences,
  PreferencesUpdate,
} from '../../shared/desktop'
import type { useParty } from './useParty'
import { applyAppearance } from './appearance'
import { setUiLanguage, t } from '../../shared/ui-language'

type Party = ReturnType<typeof useParty>
export function useDesktop(
  party: Party,
  navigate: (tab: 'settings' | 'lyrics' | 'search') => void,
  receivedInfo: DesktopInfo | null,
  startupError?: string,
) {
  const [info, setInfo] = useState<DesktopInfo | null>(receivedInfo)
  const [error, setError] = useState(startupError ?? '')
  const [ready, setReady] = useState(false)
  const latest = useRef({ party, navigate })
  latest.current = { party, navigate }
  const saved = useRef<Preferences | null>(null)
  const hydrated = useRef(false)
  const requestEpoch = useRef(0)
  const fullScreenState = useRef({ fullScreen: false, fullScreenRevision: -1 })
  const [fullScreenBusy, setFullScreenBusy] = useState(false)
  const fullScreenLock = useRef(false)
  function applyInfo(next: DesktopInfo) {
    setUiLanguage(next.resolvedLanguage)
    document.documentElement.lang = next.resolvedLanguage
    if (next.fullScreenRevision >= fullScreenState.current.fullScreenRevision)
      fullScreenState.current = {
        fullScreen: next.fullScreen,
        fullScreenRevision: next.fullScreenRevision,
      }
    setInfo({ ...next, ...fullScreenState.current })
    saved.current = next.preferences
    document.documentElement.dataset.theme = next.resolvedTheme
    applyAppearance(document.documentElement, next.preferences, next.resolvedTheme)
  }
  async function setFullScreen(value: boolean | 'toggle') {
    if (fullScreenLock.current && value === 'toggle') return
    fullScreenLock.current = true
    setFullScreenBusy(true)
    try {
      applyInfo(await window.together.setFullScreen(value))
    } catch (error: any) {
      latest.current.party.setError(error.message || t('desktop.couldNotSwitchFullscreenMode'))
    } finally {
      fullScreenLock.current = false
      setFullScreenBusy(false)
    }
  }
  async function update(value: PreferencesUpdate) {
    const run = ++requestEpoch.current
    const previous = info
    setInfo((current) => {
      if (!current) return current
      const { playerBackground, ...fields } = value
      return {
        ...current,
        preferences: {
          ...current.preferences,
          ...fields,
          playerBackground: playerBackground
            ? { ...current.preferences.playerBackground, ...playerBackground }
            : current.preferences.playerBackground,
        },
      }
    })
    try {
      const next = await window.together.updatePreferences(value)
      if (run === requestEpoch.current) {
        applyInfo(next)
        setError('')
        return true
      }
    } catch (e: any) {
      if (run === requestEpoch.current) {
        if (previous) applyInfo(previous)
        setError(e.message || t('desktop.couldNotSaveSettings'))
      }
    }
    return false
  }
  function command(command: PlayerCommand) {
    const p = latest.current.party
    if (command === 'settings' || command === 'lyrics') {
      latest.current.navigate(command)
      return
    }
    if (!p.current) return
    if (command === 'toggle') p.act(t('desktop.playbackControls'), p.togglePlay)
    else if (command === 'play' && p.audio.current?.paused) p.act(t('common.play'), p.togglePlay)
    else if (command === 'pause' && !p.audio.current?.paused) p.act(t('common.pause'), p.togglePlay)
    else if (command === 'next')
      p.act(t('common.next'), () => (p.room ? p.nextSong() : p.nextLocal(1)))
    else if (command === 'previous' && p.auditioning)
      p.act(t('common.replayPreview'), () => p.seek(0))
    else if (command === 'previous' && !p.room) p.act(t('common.previous'), () => p.nextLocal(-1))
  }
  useLayoutEffect(() => {
    if (!receivedInfo) return
    applyInfo(receivedInfo)
    if (!hydrated.current) {
      hydrated.current = true
      latest.current.party.setVolume(receivedInfo.preferences.volume)
      latest.current.party.changeRepeat(receivedInfo.preferences.repeatMode)
      setReady(true)
    }
  }, [receivedInfo])
  useEffect(() => {
    const stopCommands = window.together.onPlayerCommand(command)
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('[aria-modal="true"], :popover-open')
      )
        return
      const el = event.target as HTMLElement | null
      const editing =
        el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName || '')
      if (
        event.key === 'Escape' &&
        fullScreenState.current.fullScreen &&
        !editing &&
        !event.defaultPrevented
      ) {
        event.preventDefault()
        void setFullScreen(false)
        return
      }
      if (
        event.code === 'Space' &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !editing &&
        el?.tagName !== 'BUTTON'
      ) {
        event.preventDefault()
        command('toggle')
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => {
      stopCommands()
      window.removeEventListener('keydown', keyboard)
    }
  }, [])
  useEffect(() => {
    if (
      !ready ||
      !saved.current ||
      (saved.current.volume === party.volume && saved.current.repeatMode === party.repeatMode)
    )
      return
    const timer = setTimeout(
      () => update({ volume: party.volume, repeatMode: party.repeatMode }),
      300,
    )
    return () => clearTimeout(timer)
  }, [ready, party.volume, party.repeatMode])
  useEffect(() => {
    window.together
      .updateMedia({
        title: (party.current?.name || '').slice(0, 300),
        artist: (party.current?.artist || '').slice(0, 300),
        playing: party.playing,
        canToggle: !!party.current,
        canPrevious: party.auditioning || (!party.room && party.personalQueue.length > 0),
        canNext: !!party.current,
        roomId: party.room?.roomId || null,
      })
      .catch(() => {})
  }, [
    party.current?.id,
    party.current?.name,
    party.current?.artist,
    party.playing,
    party.room?.roomId,
    party.auditioning,
    party.personalQueue.length,
  ])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const media = navigator.mediaSession
    if (!party.current) {
      media.metadata = null
      media.playbackState = 'none'
      return
    }
    const artwork: MediaImage[] = []
    try {
      const url = new URL(party.current.cover)
      if (['http:', 'https:'].includes(url.protocol)) artwork.push({ src: url.toString() })
    } catch {}
    media.metadata = new MediaMetadata({
      title: party.current.name,
      artist: party.current.artist,
      album: party.current.album,
      artwork,
    })
    media.playbackState = party.playing ? 'playing' : 'paused'
  }, [
    party.current?.id,
    party.current?.name,
    party.current?.artist,
    party.current?.album,
    party.current?.cover,
    party.playing,
  ])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const media = navigator.mediaSession
    const register = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        media.setActionHandler(action, handler)
      } catch {}
    }
    const current = !!party.current
    // Null restores Chromium's automatic play/pause handlers. Consume media actions when disabled.
    const ignoreAction = () => {}
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) =>
      register(action, current && info?.preferences.mediaKeys === false ? ignoreAction : handler)
    const canSeek = !party.room || party.auditioning
    set('play', current ? () => command('play') : null)
    set('pause', current ? () => command('pause') : null)
    set('stop', current ? () => command('pause') : null)
    set('nexttrack', current ? () => command('next') : null)
    set('previoustrack', current && canSeek ? () => command('previous') : null)
    const seek = (position: number) => {
      const p = latest.current.party
      if (!p.room || p.auditioning)
        p.act(t('desktop.seek'), () =>
          p.seek(Math.max(0, Math.min(position, p.current?.duration || 0))),
        )
    }
    set(
      'seekto',
      current && canSeek
        ? (detail) => {
            if (detail.seekTime !== undefined) seek(detail.seekTime * 1000)
          }
        : null,
    )
    set(
      'seekbackward',
      current && canSeek
        ? (detail) => seek(latest.current.party.position - (detail.seekOffset || 10) * 1000)
        : null,
    )
    set(
      'seekforward',
      current && canSeek
        ? (detail) => seek(latest.current.party.position + (detail.seekOffset || 10) * 1000)
        : null,
    )
    return () => {
      for (const action of [
        'play',
        'pause',
        'stop',
        'nexttrack',
        'previoustrack',
        'seekto',
        'seekbackward',
        'seekforward',
      ] as const)
        register(action, null)
    }
  }, [party.current?.id, party.room?.roomId, party.auditioning, info?.preferences.mediaKeys])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    try {
      if (!party.current) navigator.mediaSession.setPositionState()
      else {
        const duration = Number.isFinite(party.audio.current?.duration)
          ? party.audio.current!.duration
          : party.current.duration / 1000
        if (duration > 0)
          navigator.mediaSession.setPositionState({
            duration,
            position: Math.max(0, Math.min(party.position / 1000, duration)),
            playbackRate: 1,
          })
      }
    } catch {}
  }, [party.current?.id, party.position])
  return {
    info,
    error,
    ready,
    update,
    setFullScreen,
    fullScreenBusy,
    quit: () => window.together.quit(),
  }
}

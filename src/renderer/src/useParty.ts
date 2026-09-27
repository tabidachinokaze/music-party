import { useEffect, useRef, useState } from 'react'
import { invitation, parseInvitation, toSong } from '../../shared/protocol'
import {
  heartbeatInterval,
  parseRoomPlayback,
  parseSnapshot,
  shouldAccept,
} from '../../shared/multiplayer'
import type { Member, Method, Room, RoomPlayback, Song, Trace } from '../../shared/types'
import { RoomPlayer } from './room-player'
import { nextQueueIndex, type RepeatMode } from '../../shared/personal-queue'

export function useParty() {
  const [account, setAccount] = useState<any>(null)
  const [session, setSession] = useState('')
  const [version, setVersion] = useState('')
  const [qr, setQr] = useState<{ key: string; qrimg: string } | null>(null)
  const [qrStatus, setQrStatus] = useState('打开网易云音乐，扫描二维码')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [room, setRoom] = useState<Room | null>(null)
  const roomRef = useRef<Room | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [membersStatus, setMembersStatus] = useState('等待房间成员信息')
  const [onlineCount, setOnlineCount] = useState<number | null>(null)
  const [roomPlayback, setRoomPlayback] = useState<RoomPlayback | null>(null)
  const playbackRef = useRef<RoomPlayback | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [searched, setSearched] = useState(false)
  const [personalQueue, setPersonalQueue] = useState<string[]>([])
  const [personalIndex, setPersonalIndex] = useState(-1)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('order')
  const queueRef = useRef<{ ids: string[]; index: number; mode: RepeatMode }>({
    ids: [],
    index: -1,
    mode: 'order',
  })
  const personalSaved = useRef<Song | null>(null)
  const localPlayEpoch = useRef(0)
  const localPlayingId = useRef('')
  const refreshedSource = useRef('')
  const [current, setCurrent] = useState<Song | null>(null)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.6)
  const [health, setHealth] = useState('尚未加入多人房间')
  const [traces, setTraces] = useState<Trace[]>([])
  const audio = useRef<HTMLAudioElement>(null)
  const syncPlayer = useRef<RoomPlayer | null>(null)
  const actionLock = useRef(false)
  const generation = useRef(0)
  const interval = useRef(5000)
  const pollInFlight = useRef<Promise<void> | null>(null)
  const membersInFlight = useRef<Promise<void> | null>(null)
  const disconnected = useRef(false)
  const audioFailure = useRef<{ song: string; until: number } | null>(null)

  async function api(method: Method, args?: Record<string, unknown>) {
    const reply = await window.together.call({ method, args })
    if (!reply.ok)
      throw Object.assign(new Error(reply.error), {
        code: reply.code,
        deliveryUnknown: reply.deliveryUnknown,
      })
    return reply.data
  }
  async function act(label: string, task: () => Promise<void>) {
    if (actionLock.current) return
    actionLock.current = true
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await task()
    } catch (e: any) {
      setError(e.message || '操作失败')
    } finally {
      actionLock.current = false
      setBusy('')
    }
  }
  async function refreshAccount() {
    const body = await api('account')
    const profile = body.data?.profile
    setAccount(profile || null)
    return profile
  }
  async function resolveTrack(id: string) {
    const [details, source] = await Promise.all([api('song', { ids: id }), api('stream', { id })])
    const stream = source.data?.[0]
    if (!stream?.url) throw new Error('当前账号无法播放这首歌曲')
    if (stream.freeTrialInfo && stream.freeTrialInfo !== 'null')
      throw new Error('当前账号只能试听这首歌，请选择可完整播放的歌曲')
    if (!['https:', 'http:'].includes(new URL(stream.url).protocol)) throw new Error('音源地址无效')
    if (!details.songs?.[0]) throw new Error('未取得歌曲信息')
    return { song: toSong(details.songs[0]), url: stream.url }
  }
  useEffect(() => {
    syncPlayer.current = new RoomPlayer(audio.current!, resolveTrack, setCurrent)
    const unsubscribe = window.together.onTrace((trace) =>
      setTraces((items) => [trace, ...items].slice(0, 300)),
    )
    window.together
      .sessionInfo()
      .then((data) => {
        setSession(data.reason)
        setVersion(data.version)
        document.title = `Music Party ${data.version} · 官方多人一起听`
      })
      .catch(() => {})
    refreshAccount().catch((e) => setError(e.message))
    return () => {
      generation.current++
      syncPlayer.current?.reset()
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (!qr) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      try {
        const body = await api('qrCheck', { key: qr.key })
        if (stopped) return
        if (body.code === 803) {
          setQr(null)
          await refreshAccount()
          setNotice('登录成功，可以加入官方多人房间')
          return
        }
        if (body.code === 800) {
          setQr(null)
          setError('二维码已过期，请重新生成')
          return
        }
        setQrStatus(body.code === 802 ? '已扫码，请在手机上确认登录' : '等待扫码')
      } catch (e: any) {
        if (!stopped) setQrStatus(e.message)
      }
      if (!stopped) timer = setTimeout(check, 2500)
    }
    timer = setTimeout(check, 2000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [qr])
  useEffect(() => {
    if (audio.current) audio.current.volume = volume
  }, [volume])
  useEffect(() => {
    function suspend() {
      disconnected.current = true
      if (!roomRef.current) return
      generation.current++
      pollInFlight.current = membersInFlight.current = null
      playbackRef.current = null
      syncPlayer.current?.suspend()
      setHealth('连接已暂停，等待恢复后重新同步')
    }
    async function resume() {
      disconnected.current = false
      if (!roomRef.current) return
      generation.current++
      pollInFlight.current = membersInFlight.current = null
      playbackRef.current = null
      syncPlayer.current?.suspend()
      interval.current = 5000
      setHealth('正在重新确认房间并恢复同步…')
      await refreshMembers()
      if (roomRef.current) await observe()
    }
    const stop = window.together.onLifecycle((state) => {
      if (state === 'suspend') suspend()
      else resume()
    })
    window.addEventListener('offline', suspend)
    window.addEventListener('online', resume)
    return () => {
      stop()
      window.removeEventListener('offline', suspend)
      window.removeEventListener('online', resume)
    }
  }, [])

  function clearRoom() {
    generation.current++
    localPlayEpoch.current++
    roomRef.current = null
    setRoom(null)
    syncPlayer.current?.reset()
    localPlayingId.current = ''
    playbackRef.current = null
    setRoomPlayback(null)
    setMembers([])
    setMembersStatus('等待房间成员信息')
    setOnlineCount(null)
    setCurrent(personalSaved.current)
    setPosition(0)
    audio.current?.removeAttribute('src')
    audio.current?.load()
    audioFailure.current = null
  }
  function applyPlayback(value: any, sampledAt: number, epoch: number) {
    if (epoch !== generation.current) return
    const next = parseRoomPlayback(value, sampledAt)
    if (!next || !shouldAccept(playbackRef.current, next)) return
    playbackRef.current = next
    setRoomPlayback(next)
    const key = `${next.song?.songId}:${next.song?.songBizId}`
    const failed = audioFailure.current
    if (failed?.song === key && performance.now() < failed.until) return
    syncPlayer.current?.apply(next).catch((e) => {
      if (
        epoch === generation.current &&
        playbackRef.current?.song?.songBizId === next.song?.songBizId
      ) {
        audioFailure.current = { song: key, until: performance.now() + 30000 }
        setError(e.message)
      }
    })
  }
  function applySnapshot(value: any, sampledAt: number, epoch: number) {
    if (epoch !== generation.current) return
    const snapshot = parseSnapshot(value, sampledAt)
    if (snapshot.roomId !== roomRef.current?.roomId)
      throw new Error('账号当前房间已变化，请离开本地房间后重新获取')
    applyMembers(snapshot)

    applyPlayback(value.roomPlaySongInfo, sampledAt, epoch)
  }
  function applyMembers(snapshot: import('../../shared/types').RoomSnapshot) {
    if (snapshot.membersKnown) {
      setMembers(snapshot.members)
      setMembersStatus(`成员更新于 ${new Date().toLocaleTimeString()}`)
    } else setMembersStatus('服务端暂未返回成员列表，请稍后刷新')
    if (snapshot.onlineCount !== null) setOnlineCount(snapshot.onlineCount)
    if (
      snapshot.chatRoomId &&
      roomRef.current &&
      roomRef.current.chatRoomId !== snapshot.chatRoomId
    ) {
      const next = { ...roomRef.current, chatRoomId: snapshot.chatRoomId }
      roomRef.current = next
      setRoom(next)
    }
  }
  async function refreshMembers() {
    if (disconnected.current) return
    if (membersInFlight.current) return membersInFlight.current
    const target = roomRef.current
    const epoch = generation.current
    if (!target) return
    const task = (async () => {
      try {
        const at = performance.now()
        const status = await api('multiStatus')
        if (epoch !== generation.current) return
        const snapshot = status.data?.multiLtRoomSnapshot
        if (!snapshot || snapshot.roomId !== target.roomId) {
          clearRoom()
          setNotice('账号已离开或切换了房间')
          return
        }
        applyMembers(parseSnapshot(snapshot, (at + performance.now()) / 2))
      } catch (e: any) {
        if (epoch === generation.current) setMembersStatus(`成员刷新失败：${e.message}`)
      }
    })()
    membersInFlight.current = task
    try {
      await task
    } finally {
      if (membersInFlight.current === task) membersInFlight.current = null
    }
  }
  useEffect(() => {
    if (!room) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await refreshMembers()
      if (!stopped) timer = setTimeout(tick, 10000)
    }
    timer = setTimeout(tick, 10000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [room?.roomId])
  async function observe() {
    if (disconnected.current) return
    if (pollInFlight.current) return pollInFlight.current
    const target = roomRef.current
    const epoch = generation.current
    if (!target) return
    const task = (async () => {
      const started = performance.now()
      try {
        const body = await api('multiHeartbeat', { roomId: target.roomId })
        if (epoch !== generation.current) return
        interval.current = heartbeatInterval(body.data?.heartBeatDuration)
        applyPlayback(body.data?.roomPlaySongInfo, (started + performance.now()) / 2, epoch)

        setHealth(
          `最近同步 ${new Date().toLocaleTimeString()} · 心跳 ${Math.round(interval.current / 1000)} 秒`,
        )
      } catch (e: any) {
        if (epoch !== generation.current) return
        if (e.code === 488) {
          clearRoom()
          setError('官方多人房间已失效，请重新加入')
        } else {
          interval.current = Math.min(interval.current * 2, 60000)
          setHealth(`正在重连：${e.message}`)
          audio.current?.pause()
        }
      }
    })()
    pollInFlight.current = task
    try {
      await task
    } finally {
      if (pollInFlight.current === task) pollInFlight.current = null
    }
  }
  useEffect(() => {
    if (!room) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await observe()
      if (!stopped) timer = setTimeout(tick, interval.current)
    }
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [room?.roomId])

  function attachRoom(value: any, inviterUid: string, role: Room['role'], sampledAt: number) {
    const snapshot = parseSnapshot(value, sampledAt)
    generation.current++
    localPlayEpoch.current++
    localPlayingId.current = ''
    syncPlayer.current?.reset()
    interval.current = 5000
    audioFailure.current = null
    playbackRef.current = null
    setRoomPlayback(null)
    const next = { roomId: snapshot.roomId, inviterUid, role, chatRoomId: snapshot.chatRoomId }
    roomRef.current = next
    setRoom(next)
    applySnapshot(value, sampledAt, generation.current)
    setNotice('已加入网易云官方多人房间。点击歌曲可推送到房间；播放进度跟随服务端。')
  }
  async function ensureNotInRoom() {
    if (roomRef.current) throw new Error('请先离开当前多人房间')
    const status = await api('multiStatus')
    if (status.data?.multiLtRoomSnapshot?.roomId)
      throw new Error('账号已在多人房间中，请使用“恢复当前房间”，或先在官方 App 离开')
  }
  async function createRoom() {
    if (!current || !/^[1-9]\d*$/.test(current.id))
      throw new Error('请先在下方搜索并播放一首歌曲，再创建多人房间')
    await ensureNotInRoom()
    const at = performance.now()
    const body = await api('multiCreate', { songId: current.id })
    attachRoom(
      body.data?.multiLtRoomSnapshot,
      String(account.userId),
      'host',
      (at + performance.now()) / 2,
    )
  }
  async function inspectInvite(link: string) {
    const invite = parseInvitation(link)
    const body = await api('multiPreview', { roomId: invite.roomId, inviterUid: invite.inviterUid })
    setPreview({ ...invite, ...body.data })
  }
  async function joinRoom(link: string) {
    const invite = parseInvitation(link)
    await ensureNotInRoom()
    const at = performance.now()
    const body = await api('multiJoin', { roomId: invite.roomId, inviterUid: invite.inviterUid })
    attachRoom(
      body.data?.multiLtRoomSnapshot,
      invite.inviterUid,
      'guest',
      (at + performance.now()) / 2,
    )
  }
  async function restoreRoom() {
    const at = performance.now()
    const body = await api('multiStatus')
    if (!body.data?.multiLtRoomSnapshot) throw new Error('当前账号未在官方多人房间中')
    attachRoom(
      body.data.multiLtRoomSnapshot,
      String(account.userId),
      'unknown',
      (at + performance.now()) / 2,
    )
  }
  async function leaveRoom() {
    const target = roomRef.current
    if (!target) return
    await api('multiLeave', { roomId: target.roomId })
    clearRoom()
    setNotice('已离开多人房间')
  }
  async function playSong(song: Song, collectionIds?: string[]) {
    if (roomRef.current) {
      const epoch = generation.current
      const at = performance.now()
      const body = await api('multiAdd', { roomId: roomRef.current.roomId, songId: song.id })
      if (epoch !== generation.current) return
      applyPlayback(body.data?.roomSongInfo, (at + performance.now()) / 2, epoch)
      setNotice(`已推送「${song.name}」到官方多人房间`)
      await observe()
      return
    }
    refreshedSource.current = ''
    const ids = collectionIds?.length ? [...new Set(collectionIds)] : [song.id]
    if (!ids.includes(song.id)) ids.unshift(song.id)
    queueRef.current = { ...queueRef.current, ids, index: ids.indexOf(song.id) }
    setPersonalQueue(ids)
    setPersonalIndex(queueRef.current.index)
    await playLocal(song.id)
  }
  async function playLocal(id: string, progress = 0) {
    if (roomRef.current) return
    const epoch = ++localPlayEpoch.current
    const roomEpoch = generation.current
    audio.current?.pause()
    const track = await resolveTrack(id)
    if (epoch !== localPlayEpoch.current || roomEpoch !== generation.current || roomRef.current)
      return
    syncPlayer.current?.reset()
    const player = audio.current!
    player.src = track.url
    setCurrent(track.song)
    personalSaved.current = track.song
    localPlayingId.current = id
    setPosition(progress)
    if (progress > 0) {
      const seekWhenReady = () => {
        if (epoch === localPlayEpoch.current && !roomRef.current)
          player.currentTime = progress / 1000
      }
      player.addEventListener('loadedmetadata', seekWhenReady, { once: true })
    }
    await player.play()
  }
  async function nextLocal(direction: -1 | 1, automatic = false) {
    if (roomRef.current) return
    const q = queueRef.current
    const next = nextQueueIndex(q.ids.length, q.index, direction, q.mode, automatic)
    if (next === null) {
      if (automatic) setNotice('个人队列已播放完毕')
      return
    }
    q.index = next
    setPersonalIndex(next)
    refreshedSource.current = ''
    await playLocal(q.ids[next])
  }
  async function playQueueIndex(index: number) {
    if (roomRef.current || index < 0 || index >= queueRef.current.ids.length) return
    queueRef.current.index = index
    setPersonalIndex(index)
    refreshedSource.current = ''
    await playLocal(queueRef.current.ids[index])
  }
  function changeRepeat(mode: RepeatMode) {
    queueRef.current.mode = mode
    setRepeatMode(mode)
  }
  function clearPersonalQueue() {
    localPlayEpoch.current++
    queueRef.current = { ...queueRef.current, ids: [], index: -1 }
    setPersonalQueue([])
    setPersonalIndex(-1)
    personalSaved.current = null
    if (!roomRef.current) {
      audio.current?.pause()
      audio.current?.removeAttribute('src')
      audio.current?.load()
      setCurrent(null)
      setPosition(0)
      localPlayingId.current = ''
    }
  }

  async function nextSong() {
    const target = roomRef.current
    const song = playbackRef.current?.song
    if (!target || !song) return
    const epoch = generation.current
    const at = performance.now()
    const body = await api('multiNext', {
      roomId: target.roomId,
      songId: song.songId,
      bizId: song.songBizId,
    })
    if (epoch !== generation.current) return
    applyPlayback(body.data?.roomSongInfo, (at + performance.now()) / 2, epoch)
    setNotice('切歌请求已被房间接受')
    await observe()
  }
  async function togglePlay() {
    if (!current) return
    if (roomRef.current) {
      await syncPlayer.current?.setListening(audio.current!.paused)
      return
    }
    if (audio.current!.paused) {
      if (!localPlayingId.current || audio.current!.error) await playLocal(current.id)
      else await audio.current!.play()
    } else audio.current!.pause()
  }
  async function seek(progress: number) {
    if (roomRef.current) throw new Error('多人房间进度由服务端统一控制')
    if (current) {
      audio.current!.currentTime = progress / 1000
      setPosition(progress)
    }
  }
  async function search(query: string) {
    if (!query.trim()) return
    if (/^\d+$/.test(query.trim())) {
      const data = await api('song', { ids: query.trim() })
      setSongs((data.songs || []).map(toSong))
    } else {
      const data = await api('search', { keywords: query.trim() })
      setSongs((data.result?.songs || []).map(toSong))
    }
    setSearched(true)
  }
  async function login() {
    setQr(await api('qrCreate'))
    setQrStatus('打开网易云音乐，扫描二维码')
  }
  async function logout() {
    await api('logout')
    clearRoom()
    clearPersonalQueue()
    setAccount(null)
  }
  async function copyInvite() {
    await window.together.copy(
      invitation({ ...roomRef.current!, inviterUid: String(account.userId) }),
    )
    setNotice('官方多人邀请链接已复制')
  }
  async function exportTrace() {
    if (await window.together.exportTrace()) setNotice('观测记录已导出')
  }
  const audioEvents = {
    onTimeUpdate: () => setPosition(audio.current!.currentTime * 1000),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => {
      setPlaying(false)
      if (roomRef.current) observe()
      else nextLocal(1, true).catch((e) => setError(e.message))
    },
    onError: () => {
      if (roomRef.current) {
        setError('本机音频加载失败，房间播放不受影响')
        return
      }
      const id = localPlayingId.current
      if (id && refreshedSource.current !== id) {
        refreshedSource.current = id
        playLocal(id, (audio.current?.currentTime || 0) * 1000).catch((e) => setError(e.message))
      } else if (id) setError('本机音频加载失败，请重试或换一首歌曲')
    },
  }
  return {
    api,
    personalQueue,
    personalIndex,
    repeatMode,
    changeRepeat,
    nextLocal,
    playQueueIndex,
    clearPersonalQueue,
    account,
    session,
    version,
    qr,
    qrStatus,
    setQr,
    error,
    setError,
    notice,
    setNotice,
    busy,
    room,
    preview,
    inspectInvite,
    members,
    membersStatus,
    refreshMembers,
    onlineCount,
    roomPlayback,
    songs,
    searched,
    current,
    position,
    playing,
    volume,
    setVolume,
    health,
    traces,
    audio,
    audioEvents,
    act,
    playSong,
    togglePlay,
    seek,
    search,
    createRoom,
    joinRoom,
    restoreRoom,
    leaveRoom,
    nextSong,
    login,
    logout,
    copyInvite,
    exportTrace,
    observe,
  }
}

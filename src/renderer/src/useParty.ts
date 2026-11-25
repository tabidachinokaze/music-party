import { getUiLanguage, ui } from '../../shared/ui-language'
import { useEffect, useRef, useState } from 'react'
import { invitation, parseInvitation, toSong } from '../../shared/protocol'
import {
  heartbeatInterval,
  parsePreviewCreator,
  parseRoomPlayback,
  parseRoomTags,
  parseSnapshot,
  shouldAccept,
  targetPosition,
} from '../../shared/multiplayer'
import type {
  Member,
  Method,
  Room,
  RoomPlayback,
  RoomQueueEntry,
  RoomSnapshot,
  Song,
  Trace,
} from '../../shared/types'
import { RoomPlayer } from './room-player'
import { buildRoomQueueHandoff, loadRoomQueueHandoff } from './room-queue-handoff'
import { RoomTransition } from './room-transition'
import { nextQueueIndex, type RepeatMode } from '../../shared/personal-queue'
import { RoomMatcher, type MatchPhase } from './room-match'
import {
  readPersonalQueue,
  rememberRoom,
  rememberedRoom,
  savePersonalQueue,
} from './playback-session'

export interface RoomSongCapture {
  roomId: string
  songId: string
  bizId: string
  uid: string
  epoch: number
}

function roomFromStatus(body: any) {
  const data = body?.data
  const snapshot = data?.multiLtRoomSnapshot
  if (snapshot?.roomId) return snapshot
  const expectsSnapshot = data?.status === 'IN_ROOM' || data?.status === 'RECONNECT_SUCCESS'
  if (!expectsSnapshot && snapshot == null && (snapshot === null || data?.status)) return null
  throw new Error(ui('暂未取得完整的房间状态', 'Room status is not available yet'))
}

export function useParty() {
  const [account, setAccount] = useState<any>(null)
  const accountRef = useRef<any>(null)
  const [session, setSession] = useState('')
  const [version, setVersion] = useState('')
  const language = getUiLanguage()
  useEffect(() => {
    let active = true
    window.together
      .sessionInfo()
      .then((data) => {
        if (!active) return
        setSession(data.reason)
        setVersion(data.version)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [language])
  useEffect(() => {
    if (version)
      document.title = ui(
        'Music Party {0} · 官方多人一起听',
        'Music Party {0} · Listen Together',
        version,
      )
  }, [version, language])
  const qrGeneration = useRef(0)
  const [qr, setQr] = useState<{ key: string; qrimg: string } | null>(null)
  const [qrStatus, setQrStatus] = useState<
    { phase: 'waiting' | 'scanned' | 'expired' | 'confirmed' } | { phase: 'error'; message: string }
  >({ phase: 'waiting' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [room, setRoom] = useState<Room | null>(null)
  const roomRef = useRef<Room | null>(null)
  const [availableRoom, setAvailableRoom] = useState<RoomSnapshot | null>(null)
  const checkAvailableRoom = useRef<(() => Promise<void>) | null>(null)
  const [matchSong, setMatchSong] = useState<Song | null>(null)
  const matchSongRef = useRef<Song | null>(null)
  const [allowStrangerMatch, setAllowStrangerMatch] = useState(false)
  const [matchPhase, setMatchPhase] = useState<MatchPhase>(null)
  const matchingRef = useRef(false)
  const matcher = useRef<RoomMatcher | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [memberError, setMemberError] = useState<{ detail?: string } | null>(null)
  const memberVersionRef = useRef(0)
  const [onlineCount, setOnlineCount] = useState<number | null>(null)
  const [roomPlayback, setRoomPlayback] = useState<RoomPlayback | null>(null)
  const [queueRevision, setQueueRevision] = useState(0)
  const reactionKey = JSON.stringify([account?.userId, room?.roomId, roomPlayback?.song?.songBizId])
  const [reaction, setReaction] = useState({ key: '', liked: false, count: 0 })
  const reactionReady = reaction.key === reactionKey
  const roomReaction = {
    loading: !reactionReady,
    liked: reactionReady && reaction.liked,
    count: Math.max(roomPlayback?.likeCount || 0, reactionReady ? reaction.count : 0),
  }
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
  const queueOwner = useRef('')
  const localPlayEpoch = useRef(0)
  const localPlayingId = useRef('')
  const refreshedSource = useRef('')
  const [current, setCurrent] = useState<Song | null>(null)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [auditioning, setAuditioning] = useState(false)
  const [volume, setVolume] = useState(0.6)
  const [health, setHealth] = useState(ui('尚未加入多人房间', "You haven't joined a room"))
  const [traces, setTraces] = useState<Trace[]>([])
  const audio = useRef<HTMLAudioElement>(null)
  const syncPlayer = useRef<RoomPlayer | null>(null)
  const transition = useRef<RoomTransition | null>(null)
  const actionLock = useRef(false)
  const generation = useRef(0)
  const leavingEpoch = useRef<number | null>(null)
  const interval = useRef(5000)
  const pollInFlight = useRef<Promise<void> | null>(null)
  const membersInFlight = useRef<Promise<void> | null>(null)
  const disconnected = useRef(false)
  const audioFailure = useRef<{ song: string; until: number } | null>(null)
  function updateDirectory(incoming: Member[]) {
    setMembers((current) => {
      // Poll and IM may return the same members in different orders. Keep the
      // existing rows in place and append new members where pending rows appear.
      const remaining = new Map(incoming.map((member) => [member.uid, member]))
      const ordered: Member[] = []
      for (const member of current) {
        const updated = remaining.get(member.uid)
        if (!updated) continue
        ordered.push(updated)
        remaining.delete(member.uid)
      }
      return ordered.concat([...remaining.values()])
    })
  }
  function selectMatchSong(song: Song) {
    if (matchingRef.current) return
    matchSongRef.current = song
    setMatchSong(song)
  }
  useEffect(() => {
    if (
      !matchSongRef.current &&
      current &&
      !auditioning &&
      (!roomRef.current || playbackRef.current?.song?.songId === current.id)
    )
      selectMatchSong(current)
  }, [current?.id, auditioning, roomPlayback?.song?.songBizId])
  useEffect(() => {
    let active = true
    const bizId = roomPlayback?.song?.songBizId
    if (room && bizId)
      api('multiSongInfo', { roomId: room.roomId, bizId })
        .then((body) => {
          if (active)
            setReaction({
              key: reactionKey,
              liked: body.data?.liked === true,
              count: Math.max(0, Number(body.data?.songInfo?.zanCnt) || 0),
            })
        })
        .catch(() => {
          if (active) setReaction({ key: reactionKey, liked: false, count: 0 })
        })
    return () => {
      active = false
    }
  }, [reactionKey])

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
      setError(e.message || ui('操作失败', 'Action failed'))
    } finally {
      actionLock.current = false
      setBusy('')
    }
  }
  async function refreshAccount() {
    const body = await api('account').catch((e) => {
      if ([301, 302, 401].includes(e.code)) return {}
      throw e
    })
    const profile = body.data?.profile
    const nextUid = String(profile?.userId || '')
    const owner = nextUid || 'guest'
    if (queueOwner.current !== owner) {
      void matcher.current?.cancel().catch(() => {})
      if (roomRef.current) clearRoom(false)
      queueOwner.current = owner
      restorePersonalQueue(owner)
      matchSongRef.current = null
      setMatchSong(null)
      setAvailableRoom(null)
    }
    accountRef.current = profile || null
    setAccount(profile || null)
    return profile
  }
  useEffect(() => {
    let active = true
    const uid = String(account?.userId || '')
    if (!uid) {
      setAvailableRoom(null)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let checking = false
    const check = async () => {
      if (checking || roomRef.current || matchingRef.current) return
      checking = true
      clearTimeout(timer)
      const at = performance.now()
      const epoch = generation.current
      try {
        const body = await api('multiStatus')
        if (
          !active ||
          String(accountRef.current?.userId) !== uid ||
          epoch !== generation.current ||
          roomRef.current ||
          matchingRef.current
        )
          return
        const snapshot = roomFromStatus(body)
        const sampledAt = (at + performance.now()) / 2
        if (snapshot?.roomId && snapshot.roomId === rememberedRoom(uid)) {
          attachRoom(snapshot, uid, 'unknown', sampledAt)
        } else {
          setAvailableRoom(snapshot ? parseSnapshot(snapshot, sampledAt) : null)
          rememberRoom(uid, null)
        }
      } catch (error: any) {
        if (active && epoch === generation.current && uid === String(accountRef.current?.userId)) {
          if (error.code === 488) {
            saveRoomId(null)
            setAvailableRoom(null)
          } else if (rememberedRoom(uid)) timer = setTimeout(check, 15000)
        }
      } finally {
        checking = false
      }
    }
    checkAvailableRoom.current = check
    void check()
    window.addEventListener('online', check)
    return () => {
      active = false
      checkAvailableRoom.current = null
      clearTimeout(timer)
      window.removeEventListener('online', check)
    }
  }, [account?.userId])
  async function resolveTrack(id: string, audition = false) {
    const [details, source] = await Promise.all([api('song', { ids: id }), api('stream', { id })])
    const stream = source.data?.[0]
    if (!stream?.url)
      throw new Error(ui('当前账号无法播放这首歌曲', 'This account cannot play this song'))
    if (!audition && stream.freeTrialInfo && stream.freeTrialInfo !== 'null')
      throw new Error(
        ui(
          '当前账号只能试听这首歌，请选择可完整播放的歌曲',
          'Only a preview is available for this account. Choose a song you can play in full.',
        ),
      )
    if (!['https:', 'http:'].includes(new URL(stream.url).protocol))
      throw new Error(ui('音源地址无效', 'Invalid audio source'))
    if (!details.songs?.[0]) throw new Error(ui('未取得歌曲信息', 'Song details unavailable'))
    return { song: toSong(details.songs[0]), url: stream.url }
  }
  useEffect(() => {
    syncPlayer.current = new RoomPlayer(
      audio.current!,
      resolveTrack,
      setCurrent,
      () => performance.now(),
      setAuditioning,
    )
    matcher.current = new RoomMatcher(
      api,
      {
        open: (id) => window.together.matchOpen(id),
        poll: (id) => window.together.matchPoll(id),
        close: (id) => window.together.matchClose(id),
      },
      (phase) => {
        matchingRef.current = phase !== null
        setMatchPhase(phase)
      },
      (snapshot) => {
        try {
          attachRoom(snapshot, '0', 'guest', performance.now())
        } catch (error: any) {
          setError(error.message)
        }
      },
      (error) => setError(error.message),
    )
    const unsubscribe = window.together.onTrace((trace) =>
      setTraces((items) => [trace, ...items].slice(0, 300)),
    )
    const unsubscribeMembers = window.together.onRoomMembers((update) => {
      const active = roomRef.current
      if (!active || (update.roomId && update.roomId !== active.roomId)) return
      if (update.version < memberVersionRef.current) return
      memberVersionRef.current = update.version
      updateDirectory(update.members)
      if (update.onlineCount !== null) setOnlineCount(update.onlineCount)
      setMemberError(null)
    })
    let active = true
    let retry: ReturnType<typeof setTimeout> | undefined
    let accountPending = false
    const checkAccount = async () => {
      if (accountPending || accountRef.current) return
      accountPending = true
      clearTimeout(retry)
      try {
        await refreshAccount()
        window.removeEventListener('online', checkAccount)
      } catch (e: any) {
        if (active) {
          setError(e.message)
          retry = setTimeout(checkAccount, 15000)
        }
      } finally {
        accountPending = false
      }
    }
    window.addEventListener('online', checkAccount)
    void checkAccount()
    return () => {
      active = false
      clearTimeout(retry)
      window.removeEventListener('online', checkAccount)
      generation.current++
      void matcher.current?.cancel().catch(() => {})
      transition.current?.pause()
      syncPlayer.current?.reset()
      unsubscribe()
      unsubscribeMembers()
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
          setQrStatus({ phase: 'confirmed' })
          try {
            if (!(await refreshAccount()))
              throw new Error(
                ui(
                  '未读取到账号信息，请重新扫码',
                  "Couldn't load your account. Please scan the code again.",
                ),
              )
            if (!stopped)
              setNotice(ui('登录成功，可以加入官方多人房间', 'Signed in. You can now join a room.'))
          } catch (error) {
            if (!stopped) setQrStatus({ phase: 'error', message: (error as Error).message })
          } finally {
            if (!stopped) setQr(null)
          }
          return
        }
        if (body.code === 800) {
          setQr(null)
          setQrStatus({ phase: 'expired' })
          return
        }
        setQrStatus({ phase: body.code === 802 ? 'scanned' : 'waiting' })
      } catch (e: any) {
        if (!stopped) setQrStatus({ phase: 'error', message: e.message })
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
      transition.current?.pause()
      pollInFlight.current = membersInFlight.current = null
      playbackRef.current = null
      syncPlayer.current?.suspend()
      setHealth(
        ui(
          '连接已暂停，等待恢复后重新同步',
          'Connection paused. Sync will resume when reconnected.',
        ),
      )
    }
    async function resume() {
      disconnected.current = false
      if (!roomRef.current) return
      generation.current++
      pollInFlight.current = membersInFlight.current = null
      playbackRef.current = null
      syncPlayer.current?.suspend()
      interval.current = 5000
      setHealth(ui('正在重新确认房间并恢复同步…', 'Checking the room and resuming sync…'))
      await refreshMembers()
      if (roomRef.current) await observe()
      transition.current?.resume()
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

  function saveRoomId(roomId: string | null) {
    try {
      rememberRoom(String(accountRef.current?.userId || ''), roomId)
    } catch {
      setError(ui('一起听房间记录无法保存到本机', "Couldn't save this room on this device"))
    }
  }
  function detachRoom(forget = true) {
    if (forget && roomRef.current) saveRoomId(null)
    transition.current?.pause()
    generation.current++
    localPlayEpoch.current++
    roomRef.current = null
    setRoom(null)
    void window.together.leaveImChatroom().catch(() => {})
    playbackRef.current = null
    setRoomPlayback(null)
    setMembers([])
    setMemberError(null)
    memberVersionRef.current = 0
    setOnlineCount(null)
    audioFailure.current = null
  }
  function clearRoom(forget = true) {
    detachRoom(forget)
    syncPlayer.current?.reset()
    localPlayingId.current = ''
    setCurrent(selectedPersonalSong())
    setPosition(0)
    audio.current?.removeAttribute('src')
    audio.current?.load()
  }
  function applyPlayback(value: any, sampledAt: number, epoch: number) {
    if (epoch !== generation.current) return
    const next = parseRoomPlayback(value, sampledAt)
    if (!next || !shouldAccept(playbackRef.current, next)) return
    playbackRef.current = next
    setRoomPlayback(next)
    if (!next.song && !syncPlayer.current?.auditioning) setPosition(0)
    transition.current?.changed()
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
      throw new Error(
        ui(
          '账号当前房间已变化，请离开本地房间后重新获取',
          'Your account has switched rooms. Leave this room and try again.',
        ),
      )
    applyMembers(snapshot)

    applyPlayback(value.roomPlaySongInfo, sampledAt, epoch)
  }
  function applyMembers(snapshot: import('../../shared/types').RoomSnapshot) {
    if (snapshot.membersKnown) {
      updateDirectory(snapshot.members)
      setMemberError(null)
    } else setMemberError({})
    if (snapshot.onlineCount !== null) setOnlineCount(snapshot.onlineCount)
    if (roomRef.current) {
      const previous = roomRef.current
      const previousChat = previous.chatRoomId
      const next = {
        ...previous,
        creatorUid: snapshot.creatorUid ?? previous.creatorUid,
        creatorName:
          snapshot.creatorName ??
          (snapshot.creatorUid && snapshot.creatorUid !== previous.creatorUid
            ? undefined
            : previous.creatorName),
        tags: snapshot.tags ?? previous.tags,
        chatRoomId: snapshot.chatRoomId || previousChat,
        roomBizType: snapshot.roomBizType ?? previous.roomBizType,
      }
      roomRef.current = next
      setRoom(next)
      if (next.chatRoomId && next.chatRoomId !== previousChat)
        void window.together.joinImChatroom(next.chatRoomId).catch(() => {})
    }
  }
  async function refreshRoomOverview() {
    const target = roomRef.current
    if (!target) return checkAvailableRoom.current?.()
    const memberUid = accountRef.current?.userId
    if (target.tags !== undefined && (target.creatorName || !memberUid)) return
    const epoch = generation.current
    const [tags, preview] = await Promise.all([
      target.tags === undefined
        ? api('multiQueue', { roomId: target.roomId })
            .then((body) => parseRoomTags(body.data?.roomTagList) ?? [])
            .catch(() => undefined)
        : undefined,
      !target.creatorName && memberUid
        ? api('multiPreview', { roomId: target.roomId, inviterUid: String(memberUid) })
            .then((body) => body.data)
            .catch(() => undefined)
        : undefined,
    ])
    const active = roomRef.current
    if (active?.roomId !== target.roomId || epoch !== generation.current) return
    const creator = parsePreviewCreator(preview, active.creatorUid)
    const next = {
      ...active,
      tags: active.tags ?? tags,
      creatorUid: active.creatorUid ?? creator.creatorUid,
      creatorName: active.creatorName ?? creator.creatorName,
    }
    if (
      next.tags === active.tags &&
      next.creatorUid === active.creatorUid &&
      next.creatorName === active.creatorName
    )
      return
    roomRef.current = next
    setRoom(next)
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
        const snapshot = roomFromStatus(status)
        if (!snapshot || snapshot.roomId !== target.roomId) {
          if (leavingEpoch.current === epoch) return
          const available = snapshot ? parseSnapshot(snapshot, performance.now()) : null
          clearRoom()
          setAvailableRoom(available)
          setNotice(ui('账号已离开或切换了房间', 'Your account has left or switched rooms'))
          return
        }
        applySnapshot(snapshot, (at + performance.now()) / 2, epoch)
      } catch (e: any) {
        if (epoch === generation.current) setMemberError({ detail: e.message })
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
    const watcher = new RoomTransition(() => playbackRef.current, refreshMembers)
    transition.current = watcher
    watcher.changed()
    return () => {
      watcher.pause()
      if (transition.current === watcher) transition.current = null
    }
  }, [room?.roomId])
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
          ui(
            '最近同步 {0} · 心跳 {1} 秒',
            'Last synced at {0} · Heartbeat every {1}s',
            new Date().toLocaleTimeString(getUiLanguage()),
            Math.round(interval.current / 1000),
          ),
        )
      } catch (e: any) {
        if (epoch !== generation.current) return
        if (e.code === 488) {
          if (leavingEpoch.current === epoch) return
          clearRoom()
          setError(ui('官方多人房间已失效，请重新加入', 'This room has expired. Please rejoin.'))
        } else {
          interval.current = Math.min(interval.current * 2, 60000)
          setHealth(ui('正在重连：{0}', 'Reconnecting: {0}', e.message))
          if (!syncPlayer.current?.auditioning) audio.current?.pause()
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
    memberVersionRef.current = 0
    audioFailure.current = null
    playbackRef.current = null
    setRoomPlayback(null)
    const selfUid = accountRef.current?.userId ? String(accountRef.current.userId) : undefined
    const creatorUid = snapshot.creatorUid ?? (role === 'host' ? selfUid : undefined)
    const next = {
      roomId: snapshot.roomId,
      inviterUid,
      role,
      creatorUid,
      creatorName:
        snapshot.creatorName ??
        (creatorUid && creatorUid === selfUid ? accountRef.current?.nickname : undefined),
      tags: snapshot.tags,
      chatRoomId: snapshot.chatRoomId,
      roomBizType: snapshot.roomBizType,
    }
    setAvailableRoom(null)
    roomRef.current = next
    saveRoomId(next.roomId)
    setRoom(next)
    if (snapshot.chatRoomId)
      void window.together.joinImChatroom(snapshot.chatRoomId).catch(() => {})
    applySnapshot(value, sampledAt, generation.current)
    setNotice(
      ui('已加入一起听，歌曲会自动同步。', 'Joined the room. Songs will sync automatically.'),
    )
  }
  async function ensureNotInRoom() {
    if (roomRef.current)
      throw new Error(ui('请先离开当前多人房间', 'Leave your current room first'))
    const status = await api('multiStatus')
    if (status.data?.multiLtRoomSnapshot?.roomId) {
      setAvailableRoom(parseSnapshot(status.data.multiLtRoomSnapshot, performance.now()))
      throw new Error(
        ui(
          '账号已在多人房间中，请使用“恢复当前房间”，或先在官方 App 离开',
          'Your account is already in a room. Rejoin it here or leave it in NetEase Cloud Music.',
        ),
      )
    }
    setAvailableRoom(null)
  }
  async function createRoom() {
    if (matchingRef.current) throw new Error(ui('请先取消匹配', 'Cancel matching first'))
    const song = matchSongRef.current
    if (!song || !/^[1-9]\d*$/.test(song.id))
      throw new Error(ui('请先选择一首匹配用歌曲', 'Choose a song for matching first'))
    const publicRoom = allowStrangerMatch
    await ensureNotInRoom()
    const at = performance.now()
    const body = await api('multiCreate', { songId: song.id, allowStrangerMatch: publicRoom })
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
    if (matchingRef.current) throw new Error(ui('请先取消匹配', 'Cancel matching first'))
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
    if (matchingRef.current) throw new Error(ui('请先取消匹配', 'Cancel matching first'))
    const at = performance.now()
    const body = await api('multiStatus')
    const snapshot = roomFromStatus(body)
    if (!snapshot) {
      setAvailableRoom(null)
      saveRoomId(null)
      throw new Error(ui('当前账号未在官方多人房间中', 'This account is not in a room'))
    }
    if (availableRoom && snapshot.roomId !== availableRoom.roomId) {
      setAvailableRoom(parseSnapshot(snapshot, performance.now()))
      throw new Error(
        ui('账号所在房间已变化，请确认当前房间', 'Your room has changed. Check the current room.'),
      )
    }
    attachRoom(snapshot, String(account.userId), 'unknown', (at + performance.now()) / 2)
  }
  async function leaveAvailableRoom(roomId: string) {
    const uid = accountRef.current?.userId
    const epoch = generation.current
    const canLeave = () =>
      uid &&
      uid === accountRef.current?.userId &&
      epoch === generation.current &&
      !roomRef.current &&
      !matchingRef.current
    if (!canLeave())
      throw new Error(
        ui('房间状态已变化，请重新查看', 'The room changed. Open Listen Together again.'),
      )
    const snapshot = roomFromStatus(await api('multiStatus'))
    if (!canLeave())
      throw new Error(
        ui('房间状态已变化，请重新查看', 'The room changed. Open Listen Together again.'),
      )
    if (snapshot && snapshot.roomId !== roomId) {
      setAvailableRoom(parseSnapshot(snapshot, performance.now()))
      throw new Error(
        ui('账号所在房间已变化，请确认当前房间', 'Your room has changed. Check the current room.'),
      )
    }
    if (snapshot) await api('multiLeave', { roomId })
    if (canLeave()) {
      generation.current++
      setAvailableRoom(null)
      saveRoomId(null)
      setNotice(ui('已退出当前房间', 'Left the room'))
    }
  }
  async function continueWithRoomQueue(
    lists: Awaited<ReturnType<typeof loadRoomQueueHandoff>>,
    initialSong: RoomPlayback['song'] | undefined,
  ) {
    const playback = playbackRef.current
    const { ids, index } = buildRoomQueueHandoff(lists, playback, initialSong)
    const player = audio.current!
    const { song, listening } = syncPlayer.current!.detachForLocal(playback?.song ?? null)
    const reuse = song && !player.error
    const progress = reuse
      ? player.currentTime * 1000
      : playback?.song
        ? targetPosition(playback, performance.now())
        : 0
    const metadata =
      song || [...lists.waiting, ...lists.played].find((row) => row.songId === ids[index])?.track
    detachRoom()
    selectPersonalTrack(ids, index, metadata)
    refreshedSource.current = ''
    setPosition(progress)
    if (reuse) localPlayingId.current = song.id
    else {
      player.pause()
      player.removeAttribute('src')
      player.load()
    }
    try {
      if (reuse && listening && player.ended) await nextLocal(1, true)
      else if (reuse && listening && player.paused) await player.play()
      else if (!reuse && playback?.song) await playLocal(playback.song.songId, progress, listening)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function leaveRoom(continueLocally = true) {
    const target = roomRef.current
    if (!target) return
    const epoch = generation.current
    const sameRoom = () => epoch === generation.current && roomRef.current?.roomId === target.roomId
    if (leavingEpoch.current === epoch)
      throw new Error(ui('正在离开房间', 'Already leaving this room'))
    leavingEpoch.current = epoch
    try {
      const initialPlayback = playbackRef.current
      const lists = continueLocally
        ? await loadRoomQueueHandoff(api, target.roomId, sameRoom)
        : null
      if (!sameRoom()) return
      await api('multiLeave', { roomId: target.roomId })
      if (!sameRoom()) return
      if (lists) await continueWithRoomQueue(lists, initialPlayback?.song)
      else clearRoom()
    } finally {
      if (leavingEpoch.current === epoch) leavingEpoch.current = null
    }
    setNotice(ui('已离开多人房间', 'Left the room'))
  }
  async function matchRoom() {
    const song = matchSongRef.current
    if (!song) throw new Error(ui('请先选择一首匹配用歌曲', 'Choose a song for matching first'))
    if (matchingRef.current) return
    await ensureNotInRoom()
    await matcher.current?.start(song.id)
  }
  async function cancelMatch() {
    await matcher.current?.cancel()
    setNotice(ui('已取消匹配', 'Matching canceled'))
  }
  async function rematchRoom() {
    const song = matchSongRef.current
    if (!song) throw new Error(ui('请先选择一首匹配用歌曲', 'Choose a song for matching first'))
    if (matchingRef.current) return
    const target = roomRef.current
    if (!target) return matchRoom()
    await api('multiRematchLeave', { roomId: target.roomId })
    clearRoom()
    await matcher.current?.start(song.id)
  }
  function captureRoomSong(): RoomSongCapture | null {
    const target = roomRef.current,
      song = playbackRef.current?.song,
      uid = String(accountRef.current?.userId || '')
    if (!target || !song || syncPlayer.current?.auditioning || current?.id !== song.songId || !uid)
      return null
    return {
      roomId: target.roomId,
      songId: song.songId,
      bizId: song.songBizId,
      uid,
      epoch: generation.current,
    }
  }
  async function redHeartRoomSong(target: RoomSongCapture) {
    if (
      target.epoch !== generation.current ||
      target.uid !== String(accountRef.current?.userId || '') ||
      target.roomId !== roomRef.current?.roomId ||
      target.songId !== playbackRef.current?.song?.songId ||
      target.bizId !== playbackRef.current?.song?.songBizId
    )
      return
    await api('multiRedHeart', {
      roomId: target.roomId,
      songId: target.songId,
      bizId: target.bizId,
    })
  }
  async function playSong(song: Song, collectionIds?: string[]) {
    if (roomRef.current) {
      const epoch = generation.current
      const at = performance.now()
      const body = await api('multiAdd', { roomId: roomRef.current.roomId, songId: song.id })
      if (epoch !== generation.current) return
      applyPlayback(body.data?.roomSongInfo, (at + performance.now()) / 2, epoch)
      setNotice(ui('已推送「{0}」到官方多人房间', 'Recommended “{0}” to the room', song.name))
      await observe()
      return
    }
    refreshedSource.current = ''
    const ids = collectionIds?.length ? [...collectionIds] : [song.id]
    if (!ids.includes(song.id)) ids.unshift(song.id)
    selectPersonalTrack(ids, ids.indexOf(song.id), song)
    await playLocal(song.id)
  }
  async function auditionSong(song: Song) {
    if (!roomRef.current) {
      await playSong(song)
      return
    }
    await syncPlayer.current?.audition(song.id)
  }
  async function stopAudition() {
    await syncPlayer.current?.returnToRoom()
  }
  async function playLocal(id: string, progress = 0, autoplay = true) {
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
    persistQueue()
    localPlayingId.current = id
    setPosition(progress)
    if (progress > 0) {
      const seekWhenReady = () => {
        if (epoch === localPlayEpoch.current && !roomRef.current)
          player.currentTime = progress / 1000
      }
      player.addEventListener('loadedmetadata', seekWhenReady, { once: true })
    }
    if (autoplay) await player.play()
    else player.load()
  }
  async function nextLocal(direction: -1 | 1, automatic = false) {
    if (roomRef.current) return
    const q = queueRef.current
    const next = nextQueueIndex(q.ids.length, q.index, direction, q.mode, automatic)
    if (next === null) {
      if (automatic) setNotice(ui('个人队列已播放完毕', 'Reached the end of your queue'))
      return
    }
    await playQueueIndex(next)
  }
  async function playQueueIndex(index: number) {
    if (roomRef.current || index < 0 || index >= queueRef.current.ids.length) return
    selectPersonalTrack(queueRef.current.ids, index)
    refreshedSource.current = ''
    await playLocal(queueRef.current.ids[index])
  }
  function changeRepeat(mode: RepeatMode) {
    queueRef.current.mode = mode
    setRepeatMode(mode)
  }
  function persistQueue() {
    const { ids, index } = queueRef.current
    try {
      savePersonalQueue(queueOwner.current, { ids, index, song: personalSaved.current })
    } catch {
      setError(ui('个人队列无法保存到本机', "Couldn't save your queue on this device"))
    }
  }
  function selectedPersonalSong() {
    const id = queueRef.current.ids[queueRef.current.index]
    return (
      personalSaved.current || (id ? toSong({ id, name: ui('歌曲 {0}', 'Song {0}', id) }) : null)
    )
  }
  function selectPersonalTrack(ids: string[], index: number, song?: Song) {
    queueRef.current = { ...queueRef.current, ids, index }
    setPersonalQueue(ids)
    setPersonalIndex(index)
    if (song || personalSaved.current?.id !== ids[index]) personalSaved.current = song || null
    localPlayingId.current = ''
    setCurrent(selectedPersonalSong())
    setPosition(0)
    persistQueue()
  }
  function restorePersonalQueue(uid: string) {
    localPlayEpoch.current++
    const saved = uid ? readPersonalQueue(uid) : { ids: [], index: -1, song: null }
    const id = saved.ids[saved.index]
    queueRef.current = { ...queueRef.current, ids: saved.ids, index: saved.index }
    setPersonalQueue(saved.ids)
    setPersonalIndex(saved.index)
    personalSaved.current = saved.song
    if (!roomRef.current) {
      audio.current?.pause()
      audio.current?.removeAttribute('src')
      audio.current?.load()
      setCurrent(selectedPersonalSong())
      setPosition(0)
      localPlayingId.current = ''
      refreshedSource.current = ''
    }
    if (id && !saved.song) {
      void api('song', { ids: id })
        .then((body) => {
          if (
            saved.ids !== queueRef.current.ids ||
            saved.index !== queueRef.current.index ||
            uid !== queueOwner.current ||
            String(body.songs?.[0]?.id) !== id
          )
            return
          personalSaved.current = toSong(body.songs[0])
          if (!roomRef.current) setCurrent(personalSaved.current)
          persistQueue()
        })
        .catch(() => {})
    }
  }
  function clearPersonalQueue() {
    restorePersonalQueue('')
    persistQueue()
  }

  async function nextSong() {
    if (syncPlayer.current?.auditioning) {
      await stopAudition()
      return
    }
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
    setNotice(ui('切歌请求已被房间接受', 'The room accepted your skip request'))
    await observe()
  }
  async function recommendOperation(method: 'multiRemove' | 'multiUp', entry: RoomQueueEntry) {
    const target = roomRef.current,
      epoch = generation.current
    if (!target) throw new Error(ui('请先加入多人房间', 'Join a room first'))
    await api(method, { roomId: target.roomId, songId: entry.songId, bizId: entry.songBizId })
    if (epoch !== generation.current) return
    setQueueRevision((value) => value + 1)
    setNotice(
      method === 'multiRemove'
        ? ui('已删除这首推荐', 'Recommendation removed')
        : ui('已顶歌，待播顺序由官方房间更新', 'Upvoted. The room will update the queue order.'),
    )
    await observe()
  }
  async function likeRoomSong() {
    const target = roomRef.current,
      song = playbackRef.current?.song,
      epoch = generation.current
    if (
      !target ||
      !song ||
      syncPlayer.current?.auditioning ||
      !reactionReady ||
      target.roomId !== room?.roomId ||
      song.songBizId !== roomPlayback?.song?.songBizId
    )
      return
    const countBeforeLike = Math.max(roomReaction.count, playbackRef.current?.likeCount || 0)
    await api('multiLike', { roomId: target.roomId, songId: song.songId, bizId: song.songBizId })
    if (epoch !== generation.current || playbackRef.current?.song?.songBizId !== song.songBizId)
      return
    setReaction((value) => ({
      key: reactionKey,
      liked: true,
      count: Math.max(
        countBeforeLike + 1,
        value.key === reactionKey ? value.count : 0,
        playbackRef.current?.likeCount || 0,
      ),
    }))
    setQueueRevision((value) => value + 1)
    await observe()
  }
  async function togglePlay() {
    if (syncPlayer.current?.auditioning) {
      await stopAudition()
      return
    }
    if (!current) return
    if (roomRef.current) {
      await syncPlayer.current?.setListening(audio.current!.paused)
      return
    }
    if (audio.current!.paused) {
      if (!localPlayingId.current || audio.current!.error) await playLocal(current.id, position)
      else await audio.current!.play()
    } else audio.current!.pause()
  }
  async function pauseForMedia() {
    if (roomRef.current) await syncPlayer.current?.setListening(false)
    else audio.current?.pause()
  }
  async function seek(progress: number) {
    if (syncPlayer.current?.auditioning) {
      syncPlayer.current.seekAudition(progress)
      setPosition(audio.current!.currentTime * 1000)
      return
    }
    if (roomRef.current)
      throw new Error(
        ui('多人房间进度由服务端统一控制', 'Playback position is controlled by the room'),
      )
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
    const run = ++qrGeneration.current
    setQrStatus({ phase: 'waiting' })
    const code = await api('qrCreate')
    if (qrGeneration.current !== run) return
    setQr(code)
  }
  async function logout() {
    await matcher.current?.cancel()
    await api('logout')
    clearRoom(false)
    queueOwner.current = 'guest'
    restorePersonalQueue('guest')
    setAccount(null)
    accountRef.current = null
    matchSongRef.current = null
    setMatchSong(null)
    setAvailableRoom(null)
  }
  async function copyInvite() {
    await window.together.copy(
      invitation({ ...roomRef.current!, inviterUid: String(account.userId) }),
    )
    setNotice(ui('官方多人邀请链接已复制', 'Room invitation link copied'))
  }
  async function exportTrace() {
    if (await window.together.exportTrace())
      setNotice(ui('观测记录已导出', 'Diagnostic log exported'))
  }
  const audioEvents = {
    onTimeUpdate: () => setPosition(audio.current!.currentTime * 1000),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => {
      setPlaying(false)
      if (roomRef.current) {
        const previewEnded = syncPlayer.current?.auditioning
        syncPlayer.current?.ended().catch((e) => setError(e.message))
        if (!previewEnded) transition.current?.ended()
      } else nextLocal(1, true).catch((e) => setError(e.message))
    },
    onError: () => {
      if (roomRef.current) {
        if (syncPlayer.current?.auditioning) {
          setError(
            ui(
              '试听音频加载失败，正在返回一起听',
              "Couldn't load the preview. Returning to the room.",
            ),
          )
          stopAudition().catch((e) => setError(e.message))
          return
        }
        setError(
          ui(
            '本机音频加载失败，房间播放不受影响',
            "Audio couldn't load on this device. The room is still playing.",
          ),
        )
        return
      }
      const id = localPlayingId.current
      if (id && refreshedSource.current !== id) {
        refreshedSource.current = id
        playLocal(id, (audio.current?.currentTime || 0) * 1000).catch((e) => setError(e.message))
      } else if (id)
        setError(
          ui(
            '本机音频加载失败，请重试或换一首歌曲',
            "Couldn't load audio. Try again or choose another song.",
          ),
        )
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
    cancelLogin: () => {
      qrGeneration.current++
      setQr(null)
    },
    error,
    setError,
    notice,
    setNotice,
    busy,
    room,
    availableRoom,
    refreshRoomOverview,
    leaveAvailableRoom,
    matchSong,
    setMatchSong: selectMatchSong,
    allowStrangerMatch,
    setAllowStrangerMatch,
    matching: matchPhase !== null,
    matchPhase,
    matchRoom,
    cancelMatch,
    rematchRoom,
    captureRoomSong,
    redHeartRoomSong,
    preview,
    inspectInvite,
    members,
    membersStatus: memberError?.detail
      ? ui('成员刷新失败：{0}', "Couldn't refresh members: {0}", memberError.detail)
      : memberError
        ? ui(
            '服务端暂未返回成员列表，请稍后刷新',
            "Member details aren't available yet. Try again later.",
          )
        : '',
    memberStatusError: memberError !== null,
    refreshMembers,
    onlineCount,
    roomPlayback,
    roomReaction,
    queueRevision,
    recommendOperation,
    likeRoomSong,
    songs,
    searched,
    current,
    position,
    playing,
    auditioning,
    volume,
    setVolume,
    health,
    traces,
    audio,
    audioEvents,
    act,
    playSong,
    auditionSong,
    stopAudition,
    togglePlay,
    pauseForMedia,
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
  }
}

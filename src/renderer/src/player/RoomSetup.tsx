import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Headphones, Link2, Plus, RefreshCw, Search, X } from 'lucide-react'
import type { useParty } from '../useParty'
import type { Song } from '../../../shared/types'
import { toSong } from '../../../shared/protocol'
import { roomTypeLabel } from '../../../shared/multiplayer'
import { Overlay } from './Overlay'
import './room-setup.css'
export function RoomSetup({
  party: p,
  onClose,
  onJoined,
  onBrowse,
}: {
  party: ReturnType<typeof useParty>
  onClose(): void
  onJoined(): void
  onBrowse(): void
}) {
  const [link, setLink] = useState('')
  const [previewRequested, setPreviewRequested] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Song[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const searchEpoch = useRef(0)
  useEffect(() => () => void ++searchEpoch.current, [])
  async function findMatchSong() {
    if (!query.trim()) return
    const epoch = ++searchEpoch.current
    setSearching(true)
    setSearchError('')
    try {
      const body = await p.api('search', { keywords: query.trim() })
      if (epoch !== searchEpoch.current) return
      setResults((body.result?.songs || []).map(toSong))
    } catch (error: any) {
      if (epoch === searchEpoch.current) setSearchError(error.message)
    } finally {
      if (epoch === searchEpoch.current) setSearching(false)
    }
  }
  return (
    <Overlay title="一起听" onClose={onClose} wide>
      <p className="overlay-intro">用喜欢的歌创建或匹配房间，也可以加入朋友的邀请。</p>
      {p.error && (
        <div className="alert error" role="alert">
          {p.error}
        </div>
      )}
      {p.availableRoom && !p.room && (
        <div className="setup-preview">
          <span>账号已有房间</span>
          <strong>{roomTypeLabel(p.availableRoom.roomBizType)}</strong>
          <button
            className="secondary"
            disabled={!!p.busy || p.matching}
            onClick={() =>
              p.act('恢复房间', async () => {
                await p.restoreRoom()
                onJoined()
              })
            }
          >
            <RefreshCw size={14} /> 恢复当前房间
          </button>
        </div>
      )}
      <section className="match-song-picker">
        <h3>匹配用歌曲</h3>
        {p.matchSong ? (
          <div className="match-song-selected">
            {p.matchSong.cover && <img src={p.matchSong.cover} alt="" />}
            <div>
              <strong>{p.matchSong.name}</strong>
              <small>{p.matchSong.artist}</small>
            </div>
          </div>
        ) : (
          <p>选择用于创建或匹配的歌曲，切换播放歌曲不会改变此选择。</p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void findMatchSong()
          }}
        >
          <input
            aria-label="搜索匹配用歌曲"
            placeholder="搜索歌曲或歌手"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={p.matching}
          />
          <button className="secondary" disabled={!query.trim() || searching || p.matching}>
            <Search size={15} /> {searching ? '搜索中' : '搜索'}
          </button>
        </form>
        {searchError && <p role="alert">{searchError}</p>}
        {results.length > 0 && (
          <div className="match-song-results" aria-label="匹配歌曲搜索结果">
            {results.map((song) => (
              <button
                key={song.id}
                disabled={p.matching}
                className={p.matchSong?.id === song.id ? 'selected' : ''}
                onClick={() => {
                  p.setMatchSong(song)
                  setResults([])
                }}
              >
                {song.cover && <img src={song.cover} alt="" />}
                <span>
                  <strong>{song.name}</strong>
                  <small>{song.artist}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        {p.current && p.matchSong?.id !== p.current.id && (
          <button
            className="text-btn"
            disabled={p.matching}
            onClick={() => p.setMatchSong(p.current!)}
          >
            使用当前播放歌曲
          </button>
        )}
      </section>
      {p.matching && (
        <div className="match-progress" role="status">
          <span>{p.matchPhase}</span>
          <button
            className="secondary"
            onClick={() => p.cancelMatch().catch((error) => p.setError(error.message))}
          >
            <X size={15} /> 取消匹配
          </button>
        </div>
      )}
      <div className="room-setup-grid">
        <section>
          <div className="setup-symbol">
            <Headphones size={25} />
          </div>
          <h3>{p.room ? '换一场一起听' : '开启一场一起听'}</h3>
          <p>创建与匹配使用上方选定的歌曲。</p>
          <label className="match-public-option">
            <input
              type="checkbox"
              checked={p.allowStrangerMatch}
              disabled={!!p.busy || p.matching || !!p.room}
              onChange={(event) => p.setAllowStrangerMatch(event.target.checked)}
            />
            允许陌生人匹配（公开好友房）
          </label>
          <button
            className="primary"
            disabled={!!p.busy || p.matching || !!p.room || !p.matchSong}
            onClick={() =>
              p.act('创建房间', async () => {
                await p.createRoom()
                onJoined()
              })
            }
          >
            <Plus size={16} />
            创建
          </button>
          <button
            className="secondary"
            disabled={!!p.busy || p.matching || !p.matchSong}
            onClick={() => p.act('匹配房间', p.room ? p.rematchRoom : p.matchRoom)}
          >
            <RefreshCw size={15} /> {p.room ? '重新匹配' : '匹配房间'}
          </button>
          {!p.matchSong && (
            <button className="text-btn" onClick={onBrowse}>
              去选一首歌
              <ArrowRight size={14} />
            </button>
          )}
        </section>
        <section>
          <div className="setup-symbol muted">
            <Link2 size={25} />
          </div>
          <h3>朋友已经在等你？</h3>
          <p>粘贴网易云官方多人邀请链接。</p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              p.act('加入房间', async () => {
                await p.joinRoom(link)
                onJoined()
              })
            }}
          >
            <input
              aria-label="一起听邀请链接"
              placeholder="粘贴邀请链接"
              value={link}
              disabled={!!p.busy || p.matching || !!p.room}
              onChange={(event) => {
                setLink(event.target.value)
                setPreviewRequested(false)
              }}
            />
            <button
              className="secondary"
              disabled={!!p.busy || p.matching || !!p.room || !link.trim()}
            >
              加入房间
              <ArrowRight size={15} />
            </button>
          </form>
          <div className="setup-secondary">
            <button
              className="text-btn"
              disabled={!!p.busy || p.matching || !link.trim()}
              onClick={() =>
                p.act('检查邀请', async () => {
                  await p.inspectInvite(link)
                  setPreviewRequested(true)
                })
              }
            >
              预览邀请
            </button>
            {!p.availableRoom && !p.room && (
              <button
                className="text-btn"
                disabled={!!p.busy || p.matching}
                onClick={() =>
                  p.act('恢复房间', async () => {
                    await p.restoreRoom()
                    onJoined()
                  })
                }
              >
                <RefreshCw size={13} />
                恢复当前房间
              </button>
            )}
          </div>
        </section>
      </div>
      {previewRequested && p.preview && (
        <div className="setup-preview">
          <span>邀请预览</span>
          <strong>{p.preview.inviter?.nickname || '好友'}的一起听</strong>
          <p>
            {p.preview.roomStatus === 'EXPIRED'
              ? '邀请已过期'
              : p.preview.songData?.name || '等待加入房间'}
          </p>
        </div>
      )}
    </Overlay>
  )
}

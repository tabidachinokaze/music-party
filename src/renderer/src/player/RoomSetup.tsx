import { useState } from 'react'
import { ArrowRight, Headphones, Link2, Plus, RefreshCw } from 'lucide-react'
import type { useParty } from '../useParty'
import { Overlay } from './Overlay'
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
  return (
    <Overlay title="一起听" onClose={onClose} wide>
      <p className="overlay-intro">开一个音乐房间，或加入朋友的邀请。</p>
      {p.error && (
        <div className="alert error" role="alert">
          {p.error}
        </div>
      )}
      <div className="room-setup-grid">
        <section>
          <div className="setup-symbol">
            <Headphones size={25} />
          </div>
          <h3>邀请朋友一起听</h3>
          <p>{p.current ? `从「${p.current.name}」开始。` : '先播放一首歌，再开启你们的房间。'}</p>
          <button
            className="primary"
            disabled={!!p.busy || !!p.room || !p.current}
            onClick={() =>
              p.act('创建房间', async () => {
                await p.createRoom()
                onJoined()
              })
            }
          >
            <Plus size={16} />
            创建多人一起听
          </button>
          {!p.current && (
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
              disabled={!!p.busy}
              onChange={(event) => {
                setLink(event.target.value)
                setPreviewRequested(false)
              }}
            />
            <button className="secondary" disabled={!!p.busy || !link.trim()}>
              加入房间
              <ArrowRight size={15} />
            </button>
          </form>
          <div className="setup-secondary">
            <button
              className="text-btn"
              disabled={!!p.busy || !link.trim()}
              onClick={() =>
                p.act('检查邀请', async () => {
                  await p.inspectInvite(link)
                  setPreviewRequested(true)
                })
              }
            >
              预览邀请
            </button>
            <button
              className="text-btn"
              disabled={!!p.busy}
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

import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { ui } from '../../../shared/ui-language'
import type { useParty } from '../useParty'
import { Overlay } from './Overlay'

type Party = ReturnType<typeof useParty>

export function RoomMatchSong({ party: p, onChooseSong }: { party: Party; onChooseSong(): void }) {
  return (
    <div className="room-match-song">
      <div className="match-song-selected">
        <small>{ui('匹配用歌曲', 'Song for matching')}</small>
        {p.matchSong ? (
          <>
            <strong title={p.matchSong.name}>{p.matchSong.name}</strong>
            {p.matchSong.artist && <span title={p.matchSong.artist}>{p.matchSong.artist}</span>}
          </>
        ) : (
          <strong>{ui('尚未选歌', 'No song selected')}</strong>
        )}
      </div>
      <button
        className="secondary"
        type="button"
        disabled={!!p.busy || p.matching}
        onClick={onChooseSong}
      >
        {ui('切换歌曲', 'Change song')}
      </button>
    </div>
  )
}

export function RoomSetup({
  party: p,
  onClose,
  onJoined,
  onChooseSong,
  onLeaveAvailable,
}: {
  party: Party
  onClose(): void
  onJoined(): void
  onChooseSong(): void
  onLeaveAvailable(): void
}) {
  const [link, setLink] = useState('')
  const [previewLink, setPreviewLink] = useState<string | null>(null)
  const existing = p.availableRoom
  const locked = !!p.busy || p.matching
  const canStart = !locked && !existing && !!p.matchSong
  const canJoin = !locked && !existing && !!link.trim()
  const memberNames = existing?.members.map((member) => member.nickname).join(ui('、', ', '))
  return (
    <Overlay title={ui('一起听', 'Listen Together')} onClose={onClose} wide>
      <div className="room-lobby">
        {p.error && (
          <p className="alert error" role="alert">
            {p.error}
          </p>
        )}

        {existing && (
          <section className="room-card">
            <h3>{ui('继续一起听', 'Continue listening together')}</h3>
            <p>{ui('你的账号已有一个多人房间', 'Your account is already in a room.')}</p>
            <div className="room-resume-summary">
              <strong>
                {existing.onlineCount === null
                  ? ui('一起听房间', 'Listening room')
                  : ui('{0} 人一起听', '{0} listening', existing.onlineCount)}
              </strong>
              {memberNames && <span title={memberNames}>{memberNames}</span>}
            </div>
            <div className="room-actions">
              <button
                className="primary"
                disabled={locked}
                onClick={() =>
                  p.act(ui('恢复房间', 'Rejoin room'), async () => {
                    await p.restoreRoom()
                    onJoined()
                  })
                }
              >
                {ui('恢复当前房间', 'Rejoin current room')}
              </button>
              <button
                className="secondary room-danger"
                disabled={locked}
                onClick={onLeaveAvailable}
              >
                {ui('退出当前房间', 'Leave current room')}
              </button>
            </div>
          </section>
        )}

        <section className="room-card">
          <h3>{ui('开启一场一起听', 'Start listening together')}</h3>
          <p>
            {ui(
              '用当前网易云歌曲创建房间，或寻找同样喜欢音乐的人。',
              'Start a room with a song or find someone to listen with.',
            )}
          </p>
          <RoomMatchSong party={p} onChooseSong={onChooseSong} />
          <label className="room-public-option">
            {ui('允许陌生人匹配', 'Allow others to match with this room')}
            <input
              type="checkbox"
              checked={p.allowStrangerMatch}
              disabled={locked || !!existing}
              onChange={(event) => p.setAllowStrangerMatch(event.target.checked)}
            />
          </label>
          <div className="room-actions">
            <button
              className="primary"
              disabled={!canStart}
              onClick={() =>
                p.act(ui('创建房间', 'Create room'), async () => {
                  await p.createRoom()
                  onJoined()
                })
              }
            >
              {ui('用当前歌曲创建', 'Create with this song')}
            </button>
            {p.matching ? (
              <button
                className="secondary"
                onClick={() => p.cancelMatch().catch((error) => p.setError(error.message))}
              >
                {ui('取消匹配', 'Cancel matching')}
              </button>
            ) : (
              <button
                className="secondary"
                disabled={!canStart}
                onClick={() => p.act(ui('匹配房间', 'Find a room'), p.matchRoom)}
              >
                {ui('匹配房间', 'Find a room')}
              </button>
            )}
          </div>
          {p.matchPhase && (
            <p className="match-progress" role="status">
              <LoaderCircle size={14} className="spin" />
              {
                {
                  connecting: ui('正在连接匹配服务…', 'Connecting to the matching service…'),
                  searching: ui('正在寻找房间…', 'Looking for a room…'),
                  joining: ui('已找到房间，正在加入…', 'Room found. Joining…'),
                }[p.matchPhase]
              }
            </p>
          )}
        </section>

        <section className="room-card">
          <h3>{ui('加入朋友的房间', 'Join a friend’s room')}</h3>
          <p>
            {ui(
              '粘贴朋友分享的多人一起听邀请链接。',
              'Paste a Listen Together invitation from a friend.',
            )}
          </p>
          <form
            className="room-join-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (canJoin)
                p.act(ui('加入房间', 'Join room'), async () => {
                  await p.joinRoom(link)
                  onJoined()
                })
            }}
          >
            <textarea
              aria-label={ui('一起听邀请链接', 'Listen Together invitation link')}
              placeholder={ui('粘贴邀请链接…', 'Paste invitation link…')}
              rows={2}
              value={link}
              disabled={locked}
              onChange={(event) => {
                setLink(event.target.value)
                setPreviewLink(null)
              }}
            />
            <div className="room-actions">
              <button type="submit" className="secondary" disabled={!canJoin}>
                {ui('通过链接加入', 'Join via link')}
              </button>
              {link.trim() && (
                <button
                  type="button"
                  className="text-btn"
                  disabled={locked}
                  onClick={() =>
                    p.act(ui('检查邀请', 'Check invitation'), async () => {
                      await p.inspectInvite(link)
                      setPreviewLink(link)
                    })
                  }
                >
                  {ui('预览邀请', 'Preview invitation')}
                </button>
              )}
            </div>
          </form>
          {previewLink === link && p.preview && (
            <div className="room-invite-preview" role="status">
              <strong>
                {ui(
                  '{0}的一起听',
                  'Listen Together with {0}',
                  p.preview.inviter?.nickname || ui('好友', 'a friend'),
                )}
              </strong>
              <p>
                {p.preview.roomStatus === 'EXPIRED'
                  ? ui('邀请已过期', 'Invitation expired')
                  : p.preview.songData?.name || ui('等待加入房间', 'Ready to join')}
              </p>
            </div>
          )}
        </section>
      </div>
    </Overlay>
  )
}

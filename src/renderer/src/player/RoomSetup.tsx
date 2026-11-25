import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { t } from '../../../shared/ui-language'
import type { useParty } from '../useParty'
import { Overlay } from './Overlay'

type Party = ReturnType<typeof useParty>

export function RoomMatchSong({ party: p, onChooseSong }: { party: Party; onChooseSong(): void }) {
  return (
    <div className="room-match-song">
      <div className="match-song-selected">
        <small>{t('roomSetup.songForMatching')}</small>
        {p.matchSong ? (
          <>
            <strong title={p.matchSong.name}>{p.matchSong.name}</strong>
            {p.matchSong.artist && <span title={p.matchSong.artist}>{p.matchSong.artist}</span>}
          </>
        ) : (
          <strong>{t('roomSetup.noSongSelected')}</strong>
        )}
      </div>
      <button
        className="secondary"
        type="button"
        disabled={!!p.busy || p.matching}
        onClick={onChooseSong}
      >
        {t('common.changeSong')}
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
  const memberNames = existing?.members.map((member) => member.nickname).join(t('roomSetup.value'))
  return (
    <Overlay title={t('common.listenTogether')} onClose={onClose} wide>
      <div className="room-lobby">
        {p.error && (
          <p className="alert error" role="alert">
            {p.error}
          </p>
        )}

        {existing && (
          <section className="room-card">
            <h3>{t('roomSetup.continueListeningTogether')}</h3>
            <p>{t('roomSetup.yourAccountIsAlreadyInARoom')}</p>
            <div className="room-resume-summary">
              <strong>
                {existing.onlineCount === null
                  ? t('roomSetup.listeningRoom')
                  : t('room.listeningCount', { count: existing.onlineCount })}
              </strong>
              {memberNames && <span title={memberNames}>{memberNames}</span>}
            </div>
            <div className="room-actions">
              <button
                className="primary"
                disabled={locked}
                onClick={() =>
                  p.act(t('roomSetup.rejoinRoom'), async () => {
                    await p.restoreRoom()
                    onJoined()
                  })
                }
              >
                {t('roomSetup.rejoinCurrentRoom')}
              </button>
              <button
                className="secondary room-danger"
                disabled={locked}
                onClick={onLeaveAvailable}
              >
                {t('roomSetup.leaveCurrentRoom')}
              </button>
            </div>
          </section>
        )}

        <section className="room-card">
          <h3>{t('roomSetup.startListeningTogether')}</h3>
          <p>{t('roomSetup.startARoomWithASongOrFind')}</p>
          <RoomMatchSong party={p} onChooseSong={onChooseSong} />
          <label className="room-public-option">
            {t('roomSetup.allowOthersToMatchWithThisRoom')}
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
                p.act(t('roomSetup.createRoom'), async () => {
                  await p.createRoom()
                  onJoined()
                })
              }
            >
              {t('roomSetup.createWithThisSong')}
            </button>
            {p.matching ? (
              <button
                className="secondary"
                onClick={() => p.cancelMatch().catch((error) => p.setError(error.message))}
              >
                {t('roomSetup.cancelMatching')}
              </button>
            ) : (
              <button
                className="secondary"
                disabled={!canStart}
                onClick={() => p.act(t('common.findARoom'), p.matchRoom)}
              >
                {t('common.findARoom')}
              </button>
            )}
          </div>
          {p.matchPhase && (
            <p className="match-progress" role="status">
              <LoaderCircle size={14} className="spin" />
              {
                {
                  connecting: t('roomSetup.connectingToTheMatchingService'),
                  searching: t('roomSetup.lookingForARoom'),
                  joining: t('roomSetup.roomFoundJoining'),
                }[p.matchPhase]
              }
            </p>
          )}
        </section>

        <section className="room-card">
          <h3>{t('roomSetup.joinAFriendsRoom')}</h3>
          <p>{t('roomSetup.pasteAListenTogetherInvitationFromAFriend')}</p>
          <form
            className="room-join-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (canJoin)
                p.act(t('roomSetup.joinRoom'), async () => {
                  await p.joinRoom(link)
                  onJoined()
                })
            }}
          >
            <textarea
              aria-label={t('roomSetup.listenTogetherInvitationLink')}
              placeholder={t('roomSetup.pasteInvitationLink')}
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
                {t('roomSetup.joinViaLink')}
              </button>
              {link.trim() && (
                <button
                  type="button"
                  className="text-btn"
                  disabled={locked}
                  onClick={() =>
                    p.act(t('roomSetup.checkInvitation'), async () => {
                      await p.inspectInvite(link)
                      setPreviewLink(link)
                    })
                  }
                >
                  {t('roomSetup.previewInvitation')}
                </button>
              )}
            </div>
          </form>
          {previewLink === link && p.preview && (
            <div className="room-invite-preview" role="status">
              <strong>
                {t('room.invitedBy', {
                  nickname: p.preview.inviter?.nickname || t('roomSetup.aFriend'),
                })}
              </strong>
              <p>
                {p.preview.roomStatus === 'EXPIRED'
                  ? t('roomSetup.invitationExpired')
                  : p.preview.songData?.name || t('roomSetup.readyToJoin')}
              </p>
            </div>
          )}
        </section>
      </div>
    </Overlay>
  )
}

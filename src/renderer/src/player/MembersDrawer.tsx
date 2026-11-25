import { t } from '../../../shared/ui-language'
import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpToLine, Music2, Trash2 } from 'lucide-react'
import type { Member, RoomQueueEntry } from '../../../shared/types'
import type { useParty } from '../useParty'
import {
  currentMemberRecommendation,
  currentRecommendationOwner,
  memberRecommendationGroups,
} from '../member-recommendations'
import { UserAvatar } from '../design/UserAvatar'
import { Overlay } from './Overlay'
import { MusicianNames } from '../MusicianNames'
import { useQueueTracks } from './useQueueTracks'
import { useMemberRecommendations } from './useMemberRecommendations'
import './member-recommendations.css'

function MemberAvatar({ member }: { member: Member }) {
  return (
    <UserAvatar
      className="member-recommendation-avatar"
      name={member.nickname}
      src={member.avatar}
    />
  )
}

export function MembersDrawer({
  party: p,
  selected,
  onSelect,
  onArtist,
  onClose,
}: {
  party: ReturnType<typeof useParty>
  selected: Member | null
  onSelect(member: Member): void
  onArtist(id: string, name: string): void
  onClose(): void
}) {
  const [removing, setRemoving] = useState<RoomQueueEntry | null>(null)
  const records = useMemberRecommendations(
    p.api,
    p.room?.roomId,
    p.roomPlayback?.version,
    p.members.map((member) => member.uid).join(','),
    p.queueRevision,
  )
  const current = currentMemberRecommendation(
      p.roomPlayback,
      [...records.played, ...records.waiting],
      p.current,
    ),
    owner = currentRecommendationOwner(p.members, current),
    member = p.members.find((member) => member.uid === selected?.uid) || selected
  const groups = member
    ? memberRecommendationGroups(member.uid, records.played, records.waiting, current)
    : null
  const { tracks } = useQueueTracks(
    p.api,
    p.room?.roomId || '',
    groups ? [...groups.waiting, ...groups.played].map((entry) => entry.songId) : [],
  )
  const directory = useRef<HTMLDivElement>(null)
  const directoryPosition = useRef(0)
  const lastMember = useRef('')
  const memberUid = member?.uid
  useLayoutEffect(() => {
    if (memberUid) {
      lastMember.current = memberUid
    } else if (directory.current) {
      directory.current.scrollTop = directoryPosition.current
      if (lastMember.current) {
        const row = Array.from(
          directory.current.querySelectorAll<HTMLElement>('[data-member]'),
        ).find((node) => node.dataset.member === lastMember.current)
        row?.focus({ preventScroll: true })
      }
    }
  }, [memberUid])
  function selectMember(target: Member) {
    directoryPosition.current = directory.current?.scrollTop || 0
    onSelect(target)
  }
  const readError = records.error || (p.memberStatusError ? p.membersStatus : '')
  const missingMembers = Math.max(0, (p.onlineCount ?? 0) - p.members.length)
  const count = (uid: string) => {
    const groups = memberRecommendationGroups(uid, records.played, records.waiting, current)
    return groups.waiting.length + groups.played.length
  }
  const renderGroup = (title: string, entries: RoomQueueEntry[], waiting: boolean) => (
    <section className="member-recommendation-group" aria-label={title}>
      <h3>
        {title} · {entries.length}
      </h3>
      {!entries.length && <p className="muted">{t('membersDrawer.noSongs')}</p>}
      {entries.map((entry) => (
        <div
          key={entry.songBizId}
          className="member-recommendation-song"
          data-biz-id={entry.songBizId}
          data-current={entry.songBizId === current?.songBizId}
        >
          {entry.track.cover ? (
            <img src={entry.track.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className="member-recommendation-art">
              <Music2 size={18} />
            </span>
          )}
          <div className="member-recommendation-copy">
            <strong>{entry.track.name}</strong>
            <small>
              <MusicianNames
                credits={tracks[entry.songId]?.artists || entry.track.artists}
                fallback={entry.track.artist}
                onOpen={onArtist}
              />
            </small>
            {entry.songBizId === current?.songBizId && <span>{t('common.nowPlaying')}</span>}
          </div>
          {waiting ? (
            <div className="member-recommendation-actions">
              <button
                className="icon-btn"
                aria-label={t('common.upvote', { name: entry.track.name })}
                title={entry.uped ? t('membersDrawer.upvoted') : t('membersDrawer.upvote')}
                disabled={!!p.busy || entry.uped}
                onClick={() =>
                  p.act(t('membersDrawer.upvoteAction'), () =>
                    p.recommendOperation('multiUp', entry),
                  )
                }
              >
                <ArrowUpToLine size={16} />
                {!!entry.upCount && <small>{entry.upCount}</small>}
              </button>
              {entry.songRcmdUid === String(p.account?.userId) && (
                <button
                  className="icon-btn"
                  aria-label={t('common.removeRecommendation', { name: entry.track.name })}
                  disabled={!!p.busy}
                  onClick={() => {
                    p.setError('')
                    setRemoving(entry)
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ) : (
            <small className="member-recommendation-likes">
              {t('room.likeCount', { count: entry.likeCount })}
            </small>
          )}
        </div>
      ))}
    </section>
  )
  return (
    <Overlay title={t('common.roomMembers')} onClose={onClose}>
      {member && groups ? (
        <>
          <div className="member-recommendation-heading">
            <MemberAvatar member={member} />
            <strong>{member.nickname}</strong>
            <small>
              {records.complete
                ? t('membersDrawer.tracksRecommended', {
                    count: groups.waiting.length + groups.played.length,
                  })
                : t('membersDrawer.loadingRecommendationCount')}
            </small>
          </div>
          <div data-list-viewport="" className="member-recommendation-list">
            {records.complete ? (
              <>
                {renderGroup(t('membersDrawer.upNext'), groups.waiting, true)}
                {renderGroup(t('membersDrawer.previouslyPlayed'), groups.played, false)}
              </>
            ) : (
              <p className="chat-empty">
                {records.loading
                  ? t('membersDrawer.loadingRecommendations')
                  : t('membersDrawer.recommendationsUnavailable')}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          {owner && (
            <button
              className="member-current-recommender"
              aria-label={t('room.viewRecommender', { nickname: owner.nickname })}
              onClick={() => selectMember(owner)}
            >
              <Music2 size={18} />
              <MemberAvatar member={owner} />
              <strong>{owner.nickname}</strong>
              <small>{p.playing ? t('common.nowPlaying') : t('membersDrawer.paused')}</small>
            </button>
          )}
          <div ref={directory} data-list-viewport="" className="member-directory">
            {p.members.map((member) => (
              <button
                className="member-directory-row"
                key={member.uid}
                data-member={member.uid}
                aria-label={t('room.viewRecommendations', { nickname: member.nickname })}
                onClick={() => selectMember(member)}
              >
                <MemberAvatar member={member} />
                <strong>{member.nickname}</strong>
                {String(p.account?.userId) === member.uid && <span>{t('common.me')}</span>}
                <small>
                  {records.complete
                    ? t('membersDrawer.memberTrackCount', { count: count(member.uid) })
                    : '—'}
                </small>
              </button>
            ))}
            {Array.from({ length: Math.min(8, missingMembers) }, (_, index) => (
              <div className="member-pending" key={index}>
                <span className="member-pending-avatar" aria-hidden="true" />
                <span>
                  {index === 7 && missingMembers > 8
                    ? t('room.waitingForProfiles', { count: missingMembers - index })
                    : t('membersDrawer.waitingForMemberDetails')}
                </span>
              </div>
            ))}
            {!p.members.length && !p.onlineCount && (
              <p className="chat-empty">
                {p.onlineCount === null
                  ? p.memberStatusError
                    ? t('membersDrawer.memberDetailsUnavailable')
                    : t('membersDrawer.loadingMembers')
                  : t('membersDrawer.noRoomMembers')}
              </p>
            )}
          </div>
        </>
      )}
      {readError && (
        <p className="queue-error" role="alert">
          {readError}
          <button
            className="text-btn"
            disabled={!!p.busy || records.loading}
            onClick={() => {
              if (p.memberStatusError)
                void p.act(t('membersDrawer.refreshMembers'), p.refreshMembers)
              if (records.error) records.refresh()
            }}
          >
            {t('common.retry')}
          </button>
        </p>
      )}
      {removing && (
        <Overlay title={t('common.removeYourRecommendation')} onClose={() => setRemoving(null)}>
          <p className="overlay-intro">
            {t('common.removeFromTheRoomQueue', { name: removing.track.name })}
          </p>
          {p.error && (
            <p className="private-error" role="alert">
              {p.error}
            </p>
          )}
          <div className="row-actions">
            <button className="secondary" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="primary"
              disabled={!!p.busy}
              onClick={() =>
                p.act(t('membersDrawer.removeRecommendation'), async () => {
                  await p.recommendOperation('multiRemove', removing)
                  setRemoving(null)
                })
              }
            >
              {t('membersDrawer.confirmRemoveRecommendation')}
            </button>
          </div>
        </Overlay>
      )}
    </Overlay>
  )
}

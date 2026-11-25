import { ui } from '../../../shared/ui-language'
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
      {!entries.length && <p className="muted">{ui('暂无歌曲', 'No songs')}</p>}
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
            {entry.songBizId === current?.songBizId && <span>{ui('正在播放', 'Now playing')}</span>}
          </div>
          {waiting ? (
            <div className="member-recommendation-actions">
              <button
                className="icon-btn"
                aria-label={ui('顶歌 {0}', 'Upvote {0}', entry.track.name)}
                title={entry.uped ? ui('已顶歌', 'Upvoted') : ui('UP 顶歌', 'Upvote')}
                disabled={!!p.busy || entry.uped}
                onClick={() =>
                  p.act(ui('顶歌', 'Upvote'), () => p.recommendOperation('multiUp', entry))
                }
              >
                <ArrowUpToLine size={16} />
                {!!entry.upCount && <small>{entry.upCount}</small>}
              </button>
              {entry.songRcmdUid === String(p.account?.userId) && (
                <button
                  className="icon-btn"
                  aria-label={ui('删除推荐 {0}', 'Remove recommendation: {0}', entry.track.name)}
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
              {ui('{0} 赞', entry.likeCount === 1 ? '{0} like' : '{0} likes', entry.likeCount)}
            </small>
          )}
        </div>
      ))}
    </section>
  )
  return (
    <Overlay title={ui('房间成员', 'Room members')} onClose={onClose}>
      {member && groups ? (
        <>
          <div className="member-recommendation-heading">
            <MemberAvatar member={member} />
            <strong>{member.nickname}</strong>
            <small>
              {records.complete
                ? ui(
                    '共推荐 {0} 首',
                    'Tracks recommended: {0}',
                    groups.waiting.length + groups.played.length,
                  )
                : ui('推荐数加载中', 'Loading recommendation count…')}
            </small>
          </div>
          <div data-list-viewport="" className="member-recommendation-list">
            {records.complete ? (
              <>
                {renderGroup(ui('待播歌曲', 'Up next'), groups.waiting, true)}
                {renderGroup(ui('已播歌曲', 'Previously played'), groups.played, false)}
              </>
            ) : (
              <p className="chat-empty">
                {records.loading
                  ? ui('正在获取推荐记录…', 'Loading recommendations…')
                  : ui('推荐记录暂不可用', 'Recommendations unavailable')}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          {owner && (
            <button
              className="member-current-recommender"
              aria-label={ui('查看当前推荐者 {0}', 'View current recommender: {0}', owner.nickname)}
              onClick={() => selectMember(owner)}
            >
              <Music2 size={18} />
              <MemberAvatar member={owner} />
              <strong>{owner.nickname}</strong>
              <small>
                {p.playing ? ui('正在播放', 'Now playing') : ui('播放已暂停', 'Paused')}
              </small>
            </button>
          )}
          <div ref={directory} data-list-viewport="" className="member-directory">
            {p.members.map((member) => (
              <button
                className="member-directory-row"
                key={member.uid}
                data-member={member.uid}
                aria-label={ui('查看 {0} 的推荐', 'View recommendations from {0}', member.nickname)}
                onClick={() => selectMember(member)}
              >
                <MemberAvatar member={member} />
                <strong>{member.nickname}</strong>
                {String(p.account?.userId) === member.uid && <span>{ui('我', 'Me')}</span>}
                <small>
                  {records.complete
                    ? ui('推荐 {0} 首', 'Tracks recommended: {0}', count(member.uid))
                    : '—'}
                </small>
              </button>
            ))}
            {Array.from({ length: Math.min(8, missingMembers) }, (_, index) => (
              <div className="member-pending" key={index}>
                <span className="member-pending-avatar" aria-hidden="true" />
                <span>
                  {index === 7 && missingMembers > 8
                    ? ui(
                        '等待其余 {0} 位成员资料',
                        'Waiting for {0} more member profiles',
                        missingMembers - index,
                      )
                    : ui('等待成员资料', 'Waiting for member details')}
                </span>
              </div>
            ))}
            {!p.members.length && !p.onlineCount && (
              <p className="chat-empty">
                {p.onlineCount === null
                  ? p.memberStatusError
                    ? ui('暂未取得成员信息', 'Member details unavailable')
                    : ui('正在读取成员…', 'Loading members…')
                  : ui('暂无房间成员', 'No room members')}
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
                void p.act(ui('刷新成员', 'Refresh members'), p.refreshMembers)
              if (records.error) records.refresh()
            }}
          >
            {ui('重试', 'Retry')}
          </button>
        </p>
      )}
      {removing && (
        <Overlay
          title={ui('删除自己的推荐？', 'Remove your recommendation?')}
          onClose={() => setRemoving(null)}
        >
          <p className="overlay-intro">
            {ui(
              '将「{0}」从房间待播列表移除。',
              'Remove “{0}” from the room queue.',
              removing.track.name,
            )}
          </p>
          {p.error && (
            <p className="private-error" role="alert">
              {p.error}
            </p>
          )}
          <div className="row-actions">
            <button className="secondary" onClick={() => setRemoving(null)}>
              {ui('取消', 'Cancel')}
            </button>
            <button
              className="primary"
              disabled={!!p.busy}
              onClick={() =>
                p.act(ui('删除推荐', 'Remove recommendation'), async () => {
                  await p.recommendOperation('multiRemove', removing)
                  setRemoving(null)
                })
              }
            >
              {ui('确认删除推荐', 'Remove recommendation')}
            </button>
          </div>
        </Overlay>
      )}
    </Overlay>
  )
}

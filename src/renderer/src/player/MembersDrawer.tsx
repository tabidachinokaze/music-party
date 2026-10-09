import { useState } from 'react'
import { ArrowLeft, ArrowUpToLine, LoaderCircle, Music2, RefreshCw, Trash2 } from 'lucide-react'
import type { Member, RoomQueueEntry } from '../../../shared/types'
import type { useParty } from '../useParty'
import {
  currentMemberRecommendation,
  currentRecommendationOwner,
  memberRecommendationGroups,
} from '../member-recommendations'
import { Overlay } from './Overlay'
import { useMemberRecommendations } from './useMemberRecommendations'
import './member-recommendations.css'

function MemberAvatar({ member }: { member: Member }) {
  return (
    <span className="member-recommendation-avatar" aria-hidden="true">
      <span>{Array.from(member.nickname)[0] || '♪'}</span>
      {member.avatar && (
        <img
          src={member.avatar}
          alt=""
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      )}
    </span>
  )
}

export function MembersDrawer({
  party: p,
  initialUid,
  onClose,
}: {
  party: ReturnType<typeof useParty>
  initialUid?: string | null
  onClose(): void
}) {
  const [selected, setSelected] = useState<Member | null>(
      () => p.members.find((member) => member.uid === initialUid) || null,
    ),
    [removing, setRemoving] = useState<RoomQueueEntry | null>(null)
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
  const count = (uid: string) => {
    const groups = memberRecommendationGroups(uid, records.played, records.waiting, current)
    return groups.waiting.length + groups.played.length
  }
  const renderGroup = (title: string, entries: RoomQueueEntry[], waiting: boolean) => (
    <section className="member-recommendation-group" aria-label={title}>
      <h3>
        {title} · {entries.length}
      </h3>
      {!entries.length && <p className="muted">暂无歌曲</p>}
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
            <small>{entry.track.artist}</small>
            {entry.songBizId === current?.songBizId && <span>正在播放</span>}
          </div>
          {waiting ? (
            <div className="member-recommendation-actions">
              <button
                className="icon-btn"
                aria-label={`顶歌 ${entry.track.name}`}
                title={entry.uped ? '已顶歌' : 'UP 顶歌'}
                disabled={!!p.busy || entry.uped}
                onClick={() => p.act('顶歌', () => p.recommendOperation('multiUp', entry))}
              >
                <ArrowUpToLine size={16} />
                {!!entry.upCount && <small>{entry.upCount}</small>}
              </button>
              {entry.songRcmdUid === String(p.account?.userId) && (
                <button
                  className="icon-btn"
                  aria-label={`删除推荐 ${entry.track.name}`}
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
            <small className="member-recommendation-likes">{entry.likeCount} 赞</small>
          )}
        </div>
      ))}
    </section>
  )
  return (
    <Overlay title="房间成员" onClose={onClose}>
      <p className="overlay-intro">
        {p.onlineCount === null ? '正在读取成员' : `${p.onlineCount} 人正在一起听`}
      </p>
      {records.error && (
        <p className="private-error" role="alert">
          {records.error}
          <button className="text-btn" disabled={records.loading} onClick={records.refresh}>
            重试加载
          </button>
        </p>
      )}
      {records.loading && (
        <p className="member-recommendation-loading" role="status">
          <LoaderCircle size={14} className="spin" /> 正在同步推荐记录…
        </p>
      )}
      {member && groups ? (
        <>
          <div className="member-recommendation-heading">
            <button
              className="icon-btn"
              aria-label="返回成员列表"
              onClick={() => setSelected(null)}
            >
              <ArrowLeft size={18} />
            </button>
            <MemberAvatar member={member} />
            <strong>{member.nickname}</strong>
            <small>
              {records.complete
                ? `共推荐 ${groups.waiting.length + groups.played.length} 首`
                : '推荐数加载中'}
            </small>
          </div>
          <div className="member-recommendation-list">
            {records.complete ? (
              <>
                {renderGroup('待播歌曲', groups.waiting, true)}
                {renderGroup('已播歌曲', groups.played, false)}
              </>
            ) : (
              <p className="chat-empty">
                {records.loading ? '正在获取推荐记录…' : '推荐记录暂不可用'}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          {owner && (
            <button
              className="member-current-recommender"
              aria-label={`查看当前推荐者 ${owner.nickname}`}
              onClick={() => setSelected(owner)}
            >
              <Music2 size={18} />
              <MemberAvatar member={owner} />
              <strong>{owner.nickname}</strong>
              <small>{p.playing ? '正在播放' : '播放已暂停'}</small>
            </button>
          )}
          <div className="member-directory">
            {p.members.map((member) => (
              <button
                className="member-directory-row"
                key={member.uid}
                aria-label={`查看 ${member.nickname} 的推荐`}
                onClick={() => setSelected(member)}
              >
                <MemberAvatar member={member} />
                <strong>{member.nickname}</strong>
                {String(p.account?.userId) === member.uid && <span>我</span>}
                <small>{records.complete ? `推荐 ${count(member.uid)} 首` : '—'}</small>
              </button>
            ))}
            {!p.members.length && (
              <p className="chat-empty">
                {p.onlineCount === null ? '暂未取得成员信息' : '暂无房间成员'}
              </p>
            )}
          </div>
          {p.onlineCount !== null && p.onlineCount > p.members.length && (
            <p className="muted">当前返回 {p.members.length} 位成员资料</p>
          )}
        </>
      )}
      <div className="member-directory-footer">
        <small>{p.membersStatus}</small>
        <button
          className="secondary"
          disabled={!!p.busy || records.loading}
          onClick={() =>
            p.act('刷新成员', async () => {
              await p.refreshMembers()
              records.refresh()
            })
          }
        >
          <RefreshCw size={14} /> 刷新成员
        </button>
      </div>
      {removing && (
        <Overlay title="删除自己的推荐？" onClose={() => setRemoving(null)}>
          <p className="overlay-intro">将「{removing.track.name}」从房间待播列表移除。</p>
          {p.error && (
            <p className="private-error" role="alert">
              {p.error}
            </p>
          )}
          <div className="row-actions">
            <button className="secondary" onClick={() => setRemoving(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!!p.busy}
              onClick={() =>
                p.act('删除推荐', async () => {
                  await p.recommendOperation('multiRemove', removing)
                  setRemoving(null)
                })
              }
            >
              确认删除推荐
            </button>
          </div>
        </Overlay>
      )}
    </Overlay>
  )
}

import { ui } from '../../../shared/ui-language'
const avatarColors = ['#5e4fa2', '#3a7d6c', '#8c5a3c', '#6d54b5']

// Display the name fallback underneath the photo so a broken or slow avatar
// never leaves the conversation row empty.
export function UserAvatar({
  name,
  src,
  className = '',
  presence,
}: {
  name: string
  src?: string | null
  className?: string
  presence?: 'online' | 'offline' | 'unknown'
}) {
  const status =
    presence &&
    {
      online: ui('在线', 'Online'),
      offline: ui('离线', 'Offline'),
      unknown: ui('在线状态未知', 'Presence unknown'),
    }[presence]
  const initial = Array.from(name.trim())[0] || '♪'
  const backgroundColor = avatarColors[initial.codePointAt(0)! % avatarColors.length]
  return (
    <span
      className={`social-avatar ${className}`}
      style={{ backgroundColor }}
      aria-hidden={presence ? undefined : true}
    >
      <span className="social-avatar-fallback" aria-hidden="true">
        {initial}
      </span>
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      )}
      {presence && (
        <i
          className={`presence-mark contact-${presence}`}
          role="img"
          title={status}
          aria-label={status}
        />
      )}
    </span>
  )
}

export function userPresence(online?: boolean | null) {
  return online === true ? 'online' : online === false ? 'offline' : 'unknown'
}

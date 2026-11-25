import { ui } from '../../shared/ui-language'
import { Fragment } from 'react'
import type { MusicianCredit } from '../../shared/types'

export function MusicianNames({
  credits,
  onOpen,
  artistId,
  fallback,
}: {
  credits?: MusicianCredit[]
  fallback?: string
  onOpen: (id: string, name: string) => void
  artistId?: string
}) {
  if (!credits?.length) return fallback || null
  return credits.map(({ id, name }, index) => (
    <Fragment key={`${id || name}-${index}`}>
      {index > 0 && ' / '}
      {id && id !== artistId ? (
        <button
          type="button"
          className="musician-link"
          title={ui('查看音乐人 {0}', 'View artist {0}', name)}
          aria-label={ui('查看音乐人 {0}', 'View artist {0}', name)}
          onClick={() => onOpen(id, name)}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {name}
        </button>
      ) : (
        name
      )}
    </Fragment>
  ))
}

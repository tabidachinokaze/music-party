import { t } from '../../shared/ui-language'
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
          title={t('common.viewArtist', { name })}
          aria-label={t('common.viewArtist', { name })}
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

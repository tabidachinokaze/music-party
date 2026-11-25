import { t, type StaticMessageKey } from '../../shared/ui-language'
import { useEffect, useState } from 'react'
import {
  CircleCheck,
  CircleAlert,
  Download,
  ExternalLink,
  Info,
  LoaderCircle,
  RefreshCw,
  RotateCw,
} from 'lucide-react'
import { Overlay } from './player/Overlay'
import type { UpdateState } from '../../shared/updates'

export function Updates() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [error, setError] = useState<StaticMessageKey | null>(null)
  const [confirmInstall, setConfirmInstall] = useState(false)
  useEffect(() => {
    let active = true
    const stop = window.together.onUpdate((next) => {
      if (active) setState(next)
    })
    window.together
      .updateState()
      .then((next) => {
        if (active) setState(next)
      })
      .catch(() => {
        if (active) setError('updates.couldNotLoadUpdateInformation')
      })
    return () => {
      active = false
      stop()
    }
  }, [])
  async function action(kind: 'check' | 'download' | 'install') {
    setError(null)
    try {
      setState(await window.together.updateAction(kind))
    } catch {
      setError('updates.theUpdateActionFailedTryAgainLater')
    }
  }
  return (
    <div className="settings-group update-settings">
      <div className="section-title">
        <h2>{t('updates.appUpdates')}</h2>
        {state?.version && (
          <span className="phase">{t('updates.newVersion', { version: state.version })}</span>
        )}
      </div>
      <div role="status" className="update-status" data-phase={error ? 'error' : state?.phase}>
        {error || state?.phase === 'error' ? (
          <CircleAlert size={17} />
        ) : !state || state.phase === 'checking' || state.phase === 'downloading' ? (
          <LoaderCircle className="spin" size={17} />
        ) : state.phase === 'current' || state.phase === 'downloaded' ? (
          <CircleCheck size={17} />
        ) : (
          <Info size={17} />
        )}
        <span>
          {(error && t(error)) ||
            (state?.message ? t(state.message) : t('updates.loadingUpdateStatus'))}
        </span>
      </div>
      {state?.phase === 'downloading' && (
        <div className="update-progress">
          <progress
            aria-label={t('updates.updateDownloadProgress')}
            max={100}
            value={state.percent || 0}
          />
          <span>{Math.round(state.percent || 0)}%</span>
        </div>
      )}
      {state?.releaseNotes && (
        <details>
          <summary>{t('updates.releaseNotes')}</summary>
          <pre>{state.releaseNotes}</pre>
        </details>
      )}
      <div className="row-actions update-actions">
        <button className="secondary" onClick={() => window.together.openProject('releases')}>
          <ExternalLink size={15} />
          {t('updates.githubReleases')}
        </button>
        {state && ['idle', 'current', 'error', 'checking'].includes(state.phase) && (
          <button
            className="primary"
            disabled={state.phase === 'checking'}
            onClick={() => action('check')}
          >
            <RefreshCw size={15} />
            {state.phase === 'checking' ? t('updates.checking') : t('updates.checkForUpdates')}
          </button>
        )}
        {state?.phase === 'available' && (
          <button className="primary" onClick={() => action('download')}>
            <Download size={15} />
            {t('updates.downloadUpdate')}
          </button>
        )}
        {state?.phase === 'downloaded' && (
          <button className="primary" onClick={() => setConfirmInstall(true)}>
            <RotateCw size={15} />
            {t('updates.installAndRestart')}
          </button>
        )}
      </div>
      {confirmInstall && state?.phase === 'downloaded' && state.version && (
        <Overlay
          title={t('updates.installTheUpdateAndRestart')}
          onClose={() => setConfirmInstall(false)}
        >
          <p>{t('updates.confirmInstallVersion', { version: state.version })}</p>
          <div className="row-actions">
            <button className="secondary" onClick={() => setConfirmInstall(false)}>
              {t('updates.installLater')}
            </button>
            <button
              className="primary"
              onClick={() => {
                setConfirmInstall(false)
                action('install')
              }}
            >
              {t('updates.confirmInstallAndRestart')}
            </button>
          </div>
        </Overlay>
      )}
    </div>
  )
}

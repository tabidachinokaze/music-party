import { ui } from '../../shared/ui-language'
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
import { localizedUpdateMessage, type UpdateState } from '../../shared/updates'

export function Updates() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [error, setError] = useState('')
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
        if (active) setError(ui('更新信息读取失败', 'Could not load update information.'))
      })
    return () => {
      active = false
      stop()
    }
  }, [])
  async function action(kind: 'check' | 'download' | 'install') {
    setError('')
    try {
      setState(await window.together.updateAction(kind))
    } catch {
      setError(ui('更新操作失败，请稍后重试', 'The update action failed. Try again later.'))
    }
  }
  return (
    <div className="settings-group update-settings">
      <div className="section-title">
        <h2>{ui('应用更新', 'App updates')}</h2>
        {state?.version && (
          <span className="phase">{ui('新版本 {0}', 'New version {0}', state.version)}</span>
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
          {error ||
            (state?.message
              ? localizedUpdateMessage(state.message)
              : ui('正在读取更新状态…', 'Loading update status…'))}
        </span>
      </div>
      {state?.phase === 'downloading' && (
        <div className="update-progress">
          <progress
            aria-label={ui('更新下载进度', 'Update download progress')}
            max={100}
            value={state.percent || 0}
          />
          <span>{Math.round(state.percent || 0)}%</span>
        </div>
      )}
      {state?.releaseNotes && (
        <details>
          <summary>{ui('版本说明', 'Release notes')}</summary>
          <pre>{state.releaseNotes}</pre>
        </details>
      )}
      <div className="row-actions update-actions">
        <button className="secondary" onClick={() => window.together.openProject('releases')}>
          <ExternalLink size={15} />
          {ui('GitHub 发布页', 'GitHub releases')}
        </button>
        {state && ['idle', 'current', 'error', 'checking'].includes(state.phase) && (
          <button
            className="primary"
            disabled={state.phase === 'checking'}
            onClick={() => action('check')}
          >
            <RefreshCw size={15} />
            {state.phase === 'checking'
              ? ui('检查中…', 'Checking…')
              : ui('检查更新', 'Check for updates')}
          </button>
        )}
        {state?.phase === 'available' && (
          <button className="primary" onClick={() => action('download')}>
            <Download size={15} />
            {ui('下载更新', 'Download update')}
          </button>
        )}
        {state?.phase === 'downloaded' && (
          <button className="primary" onClick={() => setConfirmInstall(true)}>
            <RotateCw size={15} />
            {ui('安装并重启', 'Install and restart')}
          </button>
        )}
      </div>
      {confirmInstall && (
        <Overlay
          title={ui('安装更新并重启？', 'Install the update and restart?')}
          onClose={() => setConfirmInstall(false)}
        >
          <p>
            {ui(
              '将停止本机播放并安装 {0}。重启后，如果账号仍在原房间，将自动接回一起听。',
              'Playback will stop while version {0} is installed. The player will reconnect on restart if your account is still in the room.',
              state?.version,
            )}
          </p>
          <div className="row-actions">
            <button className="secondary" onClick={() => setConfirmInstall(false)}>
              {ui('稍后安装', 'Install later')}
            </button>
            <button
              className="primary"
              onClick={() => {
                setConfirmInstall(false)
                action('install')
              }}
            >
              {ui('确认安装并重启', 'Install and restart')}
            </button>
          </div>
        </Overlay>
      )}
    </div>
  )
}

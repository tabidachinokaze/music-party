import { useEffect, useState } from 'react'
import { Download, ExternalLink, RefreshCw, RotateCw } from 'lucide-react'
import type { UpdateState } from '../../shared/updates'

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
        if (active) setError('更新信息读取失败')
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
      setError('更新操作失败，请稍后重试')
    }
  }
  return (
    <div className="settings-group update-settings">
      <div className="section-title">
        <h2>应用更新</h2>
        {state?.version && <span className="phase">新版本 {state.version}</span>}
      </div>
      <p role="status">{error || state?.message || '正在读取更新状态…'}</p>
      {state?.phase === 'downloading' && (
        <div className="update-progress">
          <progress aria-label="更新下载进度" max={100} value={state.percent || 0} />
          <span>{Math.round(state.percent || 0)}%</span>
        </div>
      )}
      {state?.releaseNotes && (
        <details>
          <summary>版本说明</summary>
          <pre>{state.releaseNotes}</pre>
        </details>
      )}
      <div className="row-actions update-actions">
        <button className="secondary" onClick={() => window.together.openProject('releases')}>
          <ExternalLink size={15} />
          GitHub 发布页
        </button>
        {state && ['idle', 'current', 'error', 'checking'].includes(state.phase) && (
          <button
            className="primary"
            disabled={state.phase === 'checking'}
            onClick={() => action('check')}
          >
            <RefreshCw size={15} />
            {state.phase === 'checking' ? '检查中…' : '检查更新'}
          </button>
        )}
        {state?.phase === 'available' && (
          <button className="primary" onClick={() => action('download')}>
            <Download size={15} />
            下载更新
          </button>
        )}
        {state?.phase === 'downloaded' && (
          <button className="primary" onClick={() => setConfirmInstall(true)}>
            <RotateCw size={15} />
            安装并重启
          </button>
        )}
      </div>
      {confirmInstall && (
        <div className="modal-backdrop">
          <div role="dialog" aria-modal="true" aria-labelledby="install-title" className="modal">
            <h2 id="install-title">安装更新并重启？</h2>
            <p>
              将停止本机播放、尝试退出当前多人房间，然后安装 {state?.version}
              。未发送的消息草稿不会发送。
            </p>
            <div className="row-actions">
              <button className="secondary" onClick={() => setConfirmInstall(false)}>
                稍后安装
              </button>
              <button
                className="primary"
                onClick={() => {
                  setConfirmInstall(false)
                  action('install')
                }}
              >
                确认安装并重启
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

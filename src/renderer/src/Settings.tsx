import { Monitor, Moon, Sun, Power, Music2, GitBranch, ExternalLink } from 'lucide-react'
import { Updates } from './Updates'
import type { useDesktop } from './useDesktop'
import type { useParty } from './useParty'
export function Settings({
  desktop,
  party,
  onDiagnostics,
}: {
  desktop: ReturnType<typeof useDesktop>
  party: ReturnType<typeof useParty>
  onDiagnostics?(): void
}) {
  const info = desktop.info
  return (
    <section className="settings-page">
      {(desktop.error || info?.persistenceError) && (
        <div className="alert error" role="alert">
          {desktop.error || info?.persistenceError}
        </div>
      )}
      <div className="settings-group">
        <h2>外观</h2>
        <p>选择 Music Party 的界面主题。</p>
        <div className="theme-options">
          {(
            [
              { value: 'dark', label: '深色', Icon: Moon },
              { value: 'light', label: '浅色', Icon: Sun },
              { value: 'system', label: '跟随系统', Icon: Monitor },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              aria-pressed={info?.preferences.theme === value}
              className={info?.preferences.theme === value ? 'selected' : ''}
              disabled={!desktop.ready}
              onClick={() => desktop.update({ theme: value })}
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="settings-group">
        <h2>窗口与后台播放</h2>
        <label className="settings-row">
          <span>
            <strong>关闭窗口后继续运行</strong>
            <small>隐藏到系统托盘，音乐和多人房间继续运行。</small>
          </span>
          <input
            type="checkbox"
            aria-label="关闭窗口后继续运行"
            checked={info?.preferences.closeToTray ?? true}
            disabled={!desktop.ready || !info?.trayAvailable}
            onChange={(e) => desktop.update({ closeToTray: e.target.checked })}
          />
        </label>
        {info && !info.trayAvailable && (
          <p className="muted">当前系统托盘不可用，关闭窗口将退出应用。</p>
        )}
        <p className="muted">
          可以从托盘菜单显示窗口、控制播放或退出应用。重新打开应用时恢复窗口大小和位置。
        </p>
      </div>
      <div className="settings-group">
        <h2>播放</h2>
        <label className="settings-row">
          <span>
            <strong>本机音量</strong>
            <small>保存音量供下次打开使用。</small>
          </span>
          <input
            aria-label="默认音量"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={party.volume}
            onChange={(e) => party.setVolume(Number(e.target.value))}
          />
          <span className="volume-value">{Math.round(party.volume * 100)}%</span>
        </label>
        <label className="settings-row">
          <span>
            <strong>个人队列模式</strong>
            <small>多人房间的播放顺序由房间决定。</small>
          </span>
          <select
            aria-label="默认播放模式"
            value={party.repeatMode}
            onChange={(e) => party.changeRepeat(e.target.value as 'order' | 'loop' | 'single')}
          >
            <option value="order">顺序播放</option>
            <option value="loop">列表循环</option>
            <option value="single">单曲循环</option>
          </select>
        </label>
      </div>
      <div className="settings-group">
        <h2>桌面控制</h2>
        <div className="settings-row">
          <span>
            <strong>媒体键与系统播放信息</strong>
            <small>播放时提供歌曲、歌手、封面与进度；由系统媒体控件接收媒体键。</small>
          </span>
          <Music2 size={20} />
        </div>
        <p className="muted">
          空格：播放/暂停（输入文字时不触发） · Ctrl/Cmd+F：搜索 · Ctrl/Cmd+,：设置
        </p>
        <p className="muted">
          一起听时暂停只影响本机；系统“下一首”会请求房间切歌，上一首与进度跳转不可用。
        </p>
      </div>
      <Updates />
      {onDiagnostics && (
        <div className="settings-group">
          <h2>帮助与诊断</h2>
          <p>遇到播放或房间问题时，可以查看并导出接口记录。</p>
          <button className="secondary update-actions" onClick={onDiagnostics}>
            观测记录
          </button>
        </div>
      )}
      <div className="settings-group">
        <h2>项目与反馈</h2>
        <p>源码、版本发布和问题反馈都在 GitHub。</p>
        <div className="row-actions update-actions">
          <button className="secondary" onClick={() => window.together.openProject('repository')}>
            <GitBranch size={16} />
            tabidachinokaze/music-party
          </button>
          <button className="secondary" onClick={() => window.together.openProject('issues')}>
            <ExternalLink size={15} />
            反馈问题
          </button>
        </div>
      </div>
      <div className="settings-group settings-about">
        <div>
          <h2>Music Party {party.version}</h2>
          <p>网易云官方多人一起听 · 桌面预览版</p>
          <small>{party.session}</small>
        </div>
        <button className="secondary danger" onClick={desktop.quit}>
          <Power size={16} />
          退出 Music Party
        </button>
      </div>
    </section>
  )
}

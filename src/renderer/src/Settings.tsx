import { ui } from '../../shared/ui-language'
import {
  Keyboard,
  Languages,
  Check,
  Palette,
  RotateCcw,
  Scaling,
  type LucideIcon,
  SlidersHorizontal,
  UserRound,
  Info,
  ChevronRight,
  Monitor,
  Moon,
  Sun,
  Power,
  GitBranch,
  ExternalLink,
  Image,
} from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { settingsLabels, type SettingsSection } from './windows/navigation-history'
import { ACCENT_PRESETS } from './appearance'
import { Updates } from './Updates'
import type { useDesktop } from './useDesktop'
import type { useParty } from './useParty'
import type { PlayerBackgroundValues } from './PlayerBackground'
import { PlayerBackgroundSettings } from './PlayerBackgroundSettings'
const sections = [
  ['appearance', Palette],
  ['playback', SlidersHorizontal],
  ['account', UserRound],
  ['updates', Info],
] as const

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
  className = '',
  label = false,
}: {
  icon: LucideIcon
  title: string
  description: string
  children?: ReactNode
  className?: string
  label?: boolean
}) {
  const Row = label ? 'label' : 'div'
  const Body = label ? 'span' : 'div'
  return (
    <Row className={'settings-row ' + className}>
      <span className="setting-icon">
        <Icon size={16} aria-hidden="true" />
      </span>
      <Body className="setting-body">
        <span className="setting-label">
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        {children}
      </Body>
    </Row>
  )
}
type Desktop = ReturnType<typeof useDesktop>

function WallpaperRows({
  desktop,
  background,
  onPreview,
}: {
  desktop: Desktop
  background: PlayerBackgroundValues
  onPreview(value: PlayerBackgroundValues | null): void
}) {
  const dragging = useRef(false)
  const pending = useRef<PlayerBackgroundValues | null>(null)
  const [draft, setDraft] = useState<PlayerBackgroundValues | null>(null)
  const current = draft ?? background
  function finish() {
    dragging.current = false
    const next = pending.current
    if (!next) return
    pending.current = null
    void desktop.update({ playerBackground: next })
    setDraft(null)
    onPreview(null)
  }
  const finishOnUnmount = useEffectEvent(() => {
    if (pending.current) {
      void desktop.update({ playerBackground: pending.current })
      onPreview(null)
    }
  })
  useEffect(() => () => finishOnUnmount(), [])
  const rows = [
    ['layoutTransparency', ui('布局背景透明度', 'Layout transparency')],
    ['componentTransparency', ui('组件底色透明度', 'Component transparency')],
    ['popupTransparency', ui('弹窗底色透明度', 'Popup transparency')],
  ] as const
  return (
    <div
      className="settings-group transparency-settings"
      role="group"
      aria-labelledby="transparency-title"
    >
      <div className="settings-wallpaper-title">
        <h2 id="transparency-title">{ui('界面透明度', 'Interface transparency')}</h2>
        <small>{ui('0% 不透明 · 100% 全透明', '0% opaque · 100% transparent')}</small>
      </div>
      {rows.map(([key, title]) => (
        <label key={key} className="transparency-control">
          <span>{title}</span>
          <span className="wallpaper-range">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={current[key]}
              aria-label={title}
              aria-valuetext={current[key] + '%'}
              disabled={!desktop.ready}
              style={{ '--filled': current[key] + '%' } as CSSProperties}
              onPointerDown={() => {
                dragging.current = true
              }}
              onPointerUp={finish}
              onLostPointerCapture={finish}
              onPointerCancel={finish}
              onBlur={finish}
              onChange={(event) => {
                const next = {
                  ...(pending.current ?? current),
                  [key]: Number(event.currentTarget.value),
                }
                pending.current = next
                if (dragging.current) {
                  setDraft(next)
                  onPreview(next)
                } else finish()
              }}
            />
            <output>{current[key]}%</output>
          </span>
        </label>
      ))}
    </div>
  )
}

function DesktopSwitches({ desktop }: { desktop: Desktop }) {
  const info = desktop.info
  return (
    <>
      <SettingRow
        label
        icon={Power}
        title={ui('关闭窗口时最小化到托盘', 'Minimize to tray on close')}
        description={
          info && !info.trayAvailable
            ? ui('当前系统托盘不可用。', 'The system tray is unavailable.')
            : ui(
                '后台继续播放并保持房间连接。',
                'Keep playing and stay connected to your room in the background.',
              )
        }
      >
        <input
          type="checkbox"
          aria-label={ui('关闭窗口后继续运行', 'Keep running when the window closes')}
          checked={info?.preferences.closeToTray ?? true}
          disabled={!desktop.ready || !info?.trayAvailable}
          onChange={(event) => desktop.update({ closeToTray: event.target.checked })}
        />
      </SettingRow>
      <SettingRow
        label
        icon={Keyboard}
        title={ui('系统媒体快捷键', 'System media keys')}
        description={ui(
          '响应系统的播放、暂停和切歌操作。',
          'Use system media keys for playback and track changes.',
        )}
      >
        <input
          type="checkbox"
          aria-label={ui('系统媒体快捷键', 'System media keys')}
          checked={info?.preferences.mediaKeys ?? true}
          disabled={!desktop.ready || !('mediaSession' in navigator)}
          onChange={(event) => desktop.update({ mediaKeys: event.target.checked })}
        />
      </SettingRow>
    </>
  )
}

export function Settings({
  desktop,
  party,
  section,
  onSection,
  onDiagnostics,
  onBackgroundPreview,
  onLogin,
}: {
  desktop: ReturnType<typeof useDesktop>
  party: ReturnType<typeof useParty>
  onBackgroundPreview: React.ComponentProps<typeof PlayerBackgroundSettings>['onPreview']
  section: SettingsSection | null
  onSection(section: SettingsSection): void
  onDiagnostics?(): void
  onLogin(): void
}) {
  const info = desktop.info
  const accent = info?.preferences.accentColor
  const theme = info?.resolvedTheme ?? 'dark'
  const activePreset =
    ACCENT_PRESETS.find(({ dark }) => dark === accent) ?? (!accent ? ACCENT_PRESETS[0] : undefined)
  const displayedAccent = activePreset?.[theme] ?? accent ?? ACCENT_PRESETS[0][theme]
  // Keep the slider under the pointer throughout a drag, even when zoom changes layout tiers.
  const [dragScale, setDragScale] = useState<number | null>(null)
  const displayScale = dragScale ?? info?.preferences.fontScale ?? 100
  function finishScale() {
    if (dragScale === null) return
    setDragScale(null)
    if (dragScale !== info?.preferences.fontScale) void desktop.update({ fontScale: dragScale })
  }
  const active = section ?? 'appearance'
  const [backgroundOpen, setBackgroundOpen] = useState(false)
  return (
    <section data-list-viewport="" className="settings-page" data-index={section === null}>
      <nav className="settings-menu" aria-label={ui('设置分类', 'Settings categories')}>
        {sections.map(([key, Icon]) => (
          <button
            aria-label={settingsLabels[key]}
            aria-current={active === key ? 'page' : undefined}
            key={key}
            onClick={() => onSection(key)}
          >
            <Icon size={17} />
            <span>{settingsLabels[key]}</span>
            <ChevronRight size={15} />
          </button>
        ))}
      </nav>
      <div data-list-viewport="" className="settings-detail">
        {(desktop.error || info?.persistenceError) && (
          <div className="alert error" role="alert">
            {desktop.error || info?.persistenceError}
          </div>
        )}
        <div className="settings-section" hidden={active !== 'appearance'}>
          <div className="settings-group">
            <h2>{ui('外观', 'Appearance')}</h2>

            <SettingRow
              icon={Monitor}
              title={ui('界面主题', 'Theme')}
              description={ui(
                '选择深色、浅色或跟随系统外观。',
                'Choose a theme or follow the system setting.',
              )}
            >
              <div className="theme-options" role="group" aria-label={ui('界面主题', 'Theme')}>
                {(
                  [
                    { value: 'dark', label: ui('深色', 'Dark'), Icon: Moon },
                    { value: 'light', label: ui('浅色', 'Light'), Icon: Sun },
                    { value: 'system', label: ui('跟随系统', 'System'), Icon: Monitor },
                  ] as const
                ).map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    aria-pressed={info?.preferences.theme === value}
                    className={info?.preferences.theme === value ? 'selected' : ''}
                    disabled={!desktop.ready}
                    onClick={() => desktop.update({ theme: value })}
                  >
                    <Icon size={15} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow
              icon={Languages}
              title={ui('界面语言', 'Interface language')}
              description={ui(
                '选择播放器和桌面菜单的显示语言。',
                'Choose the language for the player and desktop menus.',
              )}
            >
              <div
                className="theme-options"
                role="group"
                aria-label={ui('界面语言', 'Interface language')}
              >
                {(
                  [
                    ['zh-CN', '简体中文'],
                    ['en', 'English'],
                  ] as const
                ).map(([language, label]) => (
                  <button
                    key={language}
                    lang={language}
                    aria-pressed={info?.preferences.language === language}
                    className={info?.preferences.language === language ? 'selected' : ''}
                    disabled={!desktop.ready}
                    onClick={() => desktop.update({ language })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow
              className="appearance-font-row"
              icon={Scaling}
              title={ui('显示大小', 'Display size')}
              description={ui(
                '调整整个界面的文字、图标和控件大小。',
                'Scale text, icons and controls throughout the app.',
              )}
            >
              <div className="setting-control">
                <input
                  aria-label={ui('显示大小', 'Display size')}
                  type="range"
                  min="80"
                  max="150"
                  step="1"
                  value={displayScale}
                  aria-valuetext={`${displayScale}%`}
                  disabled={!desktop.ready}
                  onPointerDown={() => setDragScale(displayScale)}
                  onPointerUp={finishScale}
                  onPointerCancel={finishScale}
                  onBlur={finishScale}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    if (dragScale !== null) setDragScale(next)
                    else void desktop.update({ fontScale: next })
                  }}
                />
                <output aria-label={ui('显示比例', 'Display scale')}>{displayScale}%</output>
                <button
                  className="text-btn"
                  disabled={!desktop.ready || info?.preferences.fontScale === 100}
                  onClick={() => desktop.update({ fontScale: 100 })}
                >
                  <RotateCcw size={13} />
                  {ui('恢复默认大小', 'Reset size')}
                </button>
              </div>
            </SettingRow>
            <SettingRow
              className="appearance-color-row"
              icon={Palette}
              title={ui('主题颜色', 'Accent color')}
              description={ui(
                '用于按钮、选中状态和聊天用户名。',
                'Applies to buttons, selections and names in chat.',
              )}
            >
              <div className="setting-control">
                <div
                  className="accent-presets"
                  role="group"
                  aria-label={ui('主题色预设', 'Accent presets')}
                >
                  {ACCENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      style={{ backgroundColor: preset[theme] }}
                      aria-label={ui('主题色：{0}', 'Accent: {0}', preset.name)}
                      title={preset.name}
                      aria-pressed={activePreset?.id === preset.id}
                      disabled={!desktop.ready}
                      onClick={() => desktop.update({ accentColor: preset.dark })}
                    >
                      {activePreset?.id === preset.id && <Check size={13} />}
                    </button>
                  ))}
                </div>
                <input
                  aria-label={ui('主题颜色', 'Accent color')}
                  title={ui('自定义主题颜色', 'Custom accent color')}
                  type="color"
                  value={displayedAccent}
                  disabled={!desktop.ready}
                  onChange={(event) => desktop.update({ accentColor: event.target.value })}
                />
                <output aria-label={ui('当前主题色', 'Current accent color')}>
                  {accent ? displayedAccent : ui('跟随主题', 'Theme default')}
                </output>
                <button
                  className="text-btn"
                  disabled={!desktop.ready || !info?.preferences.accentColor}
                  onClick={() => desktop.update({ accentColor: null })}
                >
                  <RotateCcw size={13} />
                  {ui('默认主题色', 'Reset accent')}
                </button>
              </div>
            </SettingRow>
            <SettingRow
              icon={Image}
              title={ui('播放器背景', 'Player background')}
              description={
                info?.preferences.playerBackground.image
                  ? ui('正在使用自定义壁纸', 'Using a custom image')
                  : ui('正在使用默认背景', 'Using the theme background')
              }
            >
              <button
                className="secondary"
                disabled={!desktop.ready}
                onClick={() => setBackgroundOpen(true)}
              >
                {info?.preferences.playerBackground.image ? (
                  <img
                    className="settings-wallpaper-thumb"
                    src={info.preferences.playerBackground.image}
                    alt=""
                  />
                ) : (
                  <Image size={16} />
                )}
                {ui('编辑背景', 'Edit background')}
              </button>
            </SettingRow>
          </div>
          {info && active === 'appearance' && (
            <WallpaperRows
              desktop={desktop}
              background={info.preferences.playerBackground}
              onPreview={onBackgroundPreview}
            />
          )}
        </div>
        <div className="settings-section" hidden={active !== 'playback'}>
          <div className="settings-group">
            <h2>{ui('窗口与后台播放', 'Window and background playback')}</h2>
            {active === 'playback' && <DesktopSwitches desktop={desktop} />}
            <p className="muted">
              {ui(
                '可以从托盘菜单显示窗口、控制播放或退出应用。重新打开应用时恢复窗口大小和位置。',
                'Use the tray menu to show the player, control playback or quit. Your window size and position are restored when you reopen the app.',
              )}
            </p>
          </div>
          <div className="settings-group">
            <h2>{ui('桌面控制', 'Desktop shortcuts')}</h2>
            <p className="muted">
              {ui(
                '空格：播放/暂停（输入文字时不触发） · Ctrl/Cmd+F 或 K：搜索 · Ctrl/Cmd+,：设置',
                'Space to play or pause when you’re not typing · Ctrl/Cmd+F or Ctrl/Cmd+K to search · Ctrl/Cmd+, for settings',
              )}
            </p>
            <p className="muted">
              {ui(
                '一起听时暂停只影响本机；系统“下一首”会请求房间切歌，上一首与进度跳转不可用。',
                'In a room, pause affects only your player. The system Next command requests a track change for the room. Previous and seeking are unavailable.',
              )}
            </p>
          </div>
        </div>
        <div className="settings-section" hidden={active !== 'account'}>
          <div className="settings-group">
            <h2>{ui('账号', 'Account')}</h2>
            <div className="account-row">
              {party.account?.avatarUrl ? (
                <img className="account-avatar" src={party.account.avatarUrl} alt="" />
              ) : (
                <span className="account-avatar">
                  <UserRound size={22} />
                </span>
              )}
              <span className="account-caption">
                <strong>
                  {party.account?.nickname || ui('网易云音乐', 'NetEase Cloud Music')}
                </strong>
                <small>
                  {party.account ? ui('已登录', 'Signed in') : ui('未登录', 'Signed out')}
                </small>
              </span>
              {party.account ? (
                <button
                  className="secondary"
                  disabled={!!party.room || !!party.busy}
                  onClick={() => party.act(ui('退出账号', 'Sign out'), party.logout)}
                >
                  {ui('退出账号', 'Sign out')}
                </button>
              ) : (
                <button className="primary" onClick={onLogin}>
                  {ui('扫码登录', 'Sign in with QR code')}
                </button>
              )}
            </div>
            {party.account && party.room && (
              <p>{ui('离开一起听房间后可切换账号。', 'Leave your room to switch accounts.')}</p>
            )}
          </div>
        </div>
        <div className="settings-section" hidden={active !== 'updates'}>
          <Updates />
          {onDiagnostics && (
            <div className="settings-group">
              <h2>{ui('帮助与诊断', 'Help and diagnostics')}</h2>
              <p>
                {ui(
                  '遇到播放或房间问题时，可以查看并导出接口记录。',
                  'View or export request logs to troubleshoot playback and room issues.',
                )}
              </p>
              <button className="secondary update-actions" onClick={onDiagnostics}>
                {ui('观测记录', 'Request log')}
              </button>
            </div>
          )}
          <div className="settings-group">
            <h2>{ui('项目与反馈', 'Project and feedback')}</h2>
            <p>
              {ui(
                '源码、版本发布和问题反馈都在 GitHub。',
                'Find the source, releases and issue tracker on GitHub.',
              )}
            </p>
            <div className="row-actions update-actions">
              <button
                className="secondary"
                onClick={() => window.together.openProject('repository')}
              >
                <GitBranch size={16} />
                tabidachinokaze/music-party
              </button>
              <button className="secondary" onClick={() => window.together.openProject('issues')}>
                <ExternalLink size={15} />
                {ui('反馈问题', 'Report an issue')}
              </button>
            </div>
          </div>
          <div className="settings-group settings-about">
            <div>
              <h2>Music Party {party.version}</h2>
              <p>
                {ui(
                  '网易云官方多人一起听 · 桌面预览版',
                  'NetEase Cloud Music Listen Together · Desktop preview',
                )}
              </p>
              <small>{party.session}</small>
            </div>
            <button className="secondary danger" onClick={desktop.quit}>
              <Power size={16} />
              {ui('退出 Music Party', 'Quit Music Party')}
            </button>
          </div>
        </div>
      </div>
      {backgroundOpen && info && (
        <PlayerBackgroundSettings
          onPreview={onBackgroundPreview}
          desktop={desktop}
          song={party.current}
          onClose={() => setBackgroundOpen(false)}
        />
      )}
    </section>
  )
}

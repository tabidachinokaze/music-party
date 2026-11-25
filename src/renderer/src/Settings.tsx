import { t } from '../../shared/ui-language'
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
import type { BackgroundTransparency } from '../../shared/desktop'
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
  const pending = useRef<Partial<BackgroundTransparency> | null>(null)
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
    ['layoutTransparency', t('settings.layoutTransparency')],
    ['componentTransparency', t('settings.componentTransparency')],
    ['popupTransparency', t('settings.popupTransparency')],
  ] as const
  return (
    <div
      className="settings-group transparency-settings"
      role="group"
      aria-labelledby="transparency-title"
    >
      <div className="settings-wallpaper-title">
        <h2 id="transparency-title">{t('settings.interfaceTransparency')}</h2>
        <small>{t('settings.0Opaque100Transparent')}</small>
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
                pending.current = { ...pending.current, [key]: Number(event.currentTarget.value) }
                const next = { ...current, ...pending.current }
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
        title={t('settings.minimizeToTrayOnClose')}
        description={
          info && !info.trayAvailable
            ? t('settings.theSystemTrayIsUnavailable')
            : t('settings.keepPlayingAndStayConnectedToYourRoom')
        }
      >
        <input
          type="checkbox"
          aria-label={t('settings.keepRunningWhenTheWindowCloses')}
          checked={info?.preferences.closeToTray ?? true}
          disabled={!desktop.ready || !info?.trayAvailable}
          onChange={(event) => desktop.update({ closeToTray: event.target.checked })}
        />
      </SettingRow>
      <SettingRow
        label
        icon={Keyboard}
        title={t('common.systemMediaKeys')}
        description={t('settings.useSystemMediaKeysForPlaybackAndTrack')}
      >
        <input
          type="checkbox"
          aria-label={t('common.systemMediaKeys')}
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
      <nav className="settings-menu" aria-label={t('settings.settingsCategories')}>
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
            <h2>{t('common.appearance')}</h2>

            <SettingRow
              icon={Monitor}
              title={t('common.theme')}
              description={t('settings.chooseAThemeOrFollowTheSystemSetting')}
            >
              <div className="theme-options" role="group" aria-label={t('common.theme')}>
                {(
                  [
                    { value: 'dark', label: t('settings.dark'), Icon: Moon },
                    { value: 'light', label: t('settings.light'), Icon: Sun },
                    { value: 'system', label: t('settings.system'), Icon: Monitor },
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
              title={t('common.interfaceLanguage')}
              description={t('settings.chooseTheLanguageForThePlayerAndDesktop')}
            >
              <div
                className="theme-options"
                role="group"
                aria-label={t('common.interfaceLanguage')}
              >
                {(
                  [
                    ['system', t('settings.system')],
                    ['zh-CN', '简体中文'],
                    ['zh-TW', '繁體中文'],
                    ['en', 'English'],
                    ['ja', '日本語'],
                  ] as const
                ).map(([language, label]) => (
                  <button
                    key={language}
                    lang={language === 'system' ? undefined : language}
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
              title={t('common.displaySize')}
              description={t('settings.scaleTextIconsAndControlsThroughoutTheApp')}
            >
              <div className="setting-control">
                <input
                  aria-label={t('common.displaySize')}
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
                <output aria-label={t('settings.displayScale')}>{displayScale}%</output>
                <button
                  className="text-btn"
                  disabled={!desktop.ready || info?.preferences.fontScale === 100}
                  onClick={() => desktop.update({ fontScale: 100 })}
                >
                  <RotateCcw size={13} />
                  {t('settings.resetSize')}
                </button>
              </div>
            </SettingRow>
            <SettingRow
              className="appearance-color-row"
              icon={Palette}
              title={t('common.accentColor')}
              description={t('settings.appliesToButtonsSelectionsAndNamesInChat')}
            >
              <div className="setting-control">
                <div
                  className="accent-presets"
                  role="group"
                  aria-label={t('settings.accentPresets')}
                >
                  {ACCENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      style={{ backgroundColor: preset[theme] }}
                      aria-label={t('settings.accent', { name: preset.name })}
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
                  aria-label={t('common.accentColor')}
                  title={t('settings.customAccentColor')}
                  type="color"
                  value={displayedAccent}
                  disabled={!desktop.ready}
                  onChange={(event) => desktop.update({ accentColor: event.target.value })}
                />
                <output aria-label={t('settings.currentAccentColor')}>
                  {accent ? displayedAccent : t('settings.themeDefault')}
                </output>
                <button
                  className="text-btn"
                  disabled={!desktop.ready || !info?.preferences.accentColor}
                  onClick={() => desktop.update({ accentColor: null })}
                >
                  <RotateCcw size={13} />
                  {t('settings.resetAccent')}
                </button>
              </div>
            </SettingRow>
            <SettingRow
              icon={Image}
              title={t('settings.playerBackground')}
              description={
                info?.preferences.playerBackground.image
                  ? t('settings.usingACustomImage')
                  : t('settings.usingTheThemeBackground')
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
                {t('settings.editBackground')}
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
            <h2>{t('settings.windowAndBackgroundPlayback')}</h2>
            {active === 'playback' && <DesktopSwitches desktop={desktop} />}
            <p className="muted">{t('settings.useTheTrayMenuToShowThePlayer')}</p>
          </div>
          <div className="settings-group">
            <h2>{t('settings.desktopShortcuts')}</h2>
            <p className="muted">{t('settings.spaceToPlayOrPauseWhenYoureNot')}</p>
            <p className="muted">{t('settings.inARoomPauseAffectsOnlyYourPlayer')}</p>
          </div>
        </div>
        <div className="settings-section" hidden={active !== 'account'}>
          <div className="settings-group">
            <h2>{t('common.account')}</h2>
            <div className="account-row">
              {party.account?.avatarUrl ? (
                <img className="account-avatar" src={party.account.avatarUrl} alt="" />
              ) : (
                <span className="account-avatar">
                  <UserRound size={22} />
                </span>
              )}
              <span className="account-caption">
                <strong>{party.account?.nickname || t('settings.neteaseCloudMusic')}</strong>
                <small>{party.account ? t('settings.signedIn') : t('settings.signedOut')}</small>
              </span>
              {party.account ? (
                <button
                  className="secondary"
                  disabled={!!party.room || !!party.busy}
                  onClick={() => party.act(t('common.signOut'), party.logout)}
                >
                  {t('common.signOut')}
                </button>
              ) : (
                <button className="primary" onClick={onLogin}>
                  {t('common.signInWithQrCode')}
                </button>
              )}
            </div>
            {party.account && party.room && <p>{t('settings.leaveYourRoomToSwitchAccounts')}</p>}
          </div>
        </div>
        <div className="settings-section" hidden={active !== 'updates'}>
          <Updates />
          {onDiagnostics && (
            <div className="settings-group">
              <h2>{t('settings.helpAndDiagnostics')}</h2>
              <p>{t('settings.viewOrExportRequestLogsToTroubleshootPlayback')}</p>
              <button className="secondary update-actions" onClick={onDiagnostics}>
                {t('settings.requestLog')}
              </button>
            </div>
          )}
          <div className="settings-group">
            <h2>{t('settings.projectAndFeedback')}</h2>
            <p>{t('settings.findTheSourceReleasesAndIssueTrackerOn')}</p>
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
                {t('settings.reportAnIssue')}
              </button>
            </div>
          </div>
          <div className="settings-group settings-about">
            <div>
              <h2>Music Party {party.version}</h2>
              <p>{t('settings.neteaseCloudMusicListenTogetherDesktopPreview')}</p>
              <small>{party.session}</small>
            </div>
            <button className="secondary danger" onClick={desktop.quit}>
              <Power size={16} />
              {t('common.quitMusicParty')}
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

import type { DesktopInfo } from '../../shared/desktop'
import { setUiLanguage, t } from '../../shared/ui-language'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { watchButtonHints } from './design/button-hints'
import { watchListScrollbars } from './design/list-scrollbars'
import './design/list-scrollbars.css'
import './style.css'
import './player/player.css'
import './interactions.css'
import './chat-messages.css'
import './chat-composer.css'
import './appearance.css'
import './windows/desktop.css'
import './windows/adaptive.css'
import './design/tokens.css'
import './design/chrome.css'
import './player/adaptive-transport.css'
import './design/library-settings.css'
import './design/social.css'
import './player/room-setup.css'
import './player-background.css'

const root = createRoot(document.getElementById('root')!)
let receivedInfo = false
function render(info: DesktopInfo) {
  receivedInfo = true
  setUiLanguage(info.resolvedLanguage)
  document.documentElement.lang = info.resolvedLanguage
  root.render(<App desktopInfo={info} />)
}
const stopDesktopInfo = window.together.onDesktopInfo(render)
window.together.desktopInfo().then(
  (info) => {
    if (!receivedInfo) render(info)
  },
  (error: Error) => {
    if (!receivedInfo)
      root.render(
        <App
          desktopInfo={null}
          startupError={error.message || t('desktop.couldNotLoadDesktopSettings')}
        />,
      )
  },
)
if (import.meta.hot) import.meta.hot.dispose(stopDesktopInfo)
const stopWatchingButtonHints = watchButtonHints()
if (import.meta.hot) import.meta.hot.dispose(stopWatchingButtonHints)
const stopWatchingScrollbars = watchListScrollbars()
if (import.meta.hot) import.meta.hot.dispose(stopWatchingScrollbars)

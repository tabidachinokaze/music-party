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

createRoot(document.getElementById('root')!).render(<App />)
const stopWatchingButtonHints = watchButtonHints()
if (import.meta.hot) import.meta.hot.dispose(stopWatchingButtonHints)
const stopWatchingScrollbars = watchListScrollbars()
if (import.meta.hot) import.meta.hot.dispose(stopWatchingScrollbars)

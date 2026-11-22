import { createRoot } from 'react-dom/client'
import { App } from './App'
import './style.css'
import './player/player.css'
import './interactions.css'
import './chat-messages.css'
import './chat-composer.css'
import './appearance.css'
import './windows/desktop.css'
import './windows/adaptive.css'

createRoot(document.getElementById('root')!).render(<App />)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { adoptScreenFromAddress } from './flash/deviceStore.ts'

// Arriving from the screen's setup page: send to that screen over Wi-Fi from now on.
adoptScreenFromAddress()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

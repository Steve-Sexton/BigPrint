import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

// ── Dark mode bootstrap ───────────────────────────────────────────────────────
// Apply class before first paint to avoid flash of wrong theme. Synchronous —
// no reason to wrap in an async IIFE (original author's habit, not a need).
try {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', prefersDark)
} catch {
  // Ignore — will be set by the theme:changed IPC event
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

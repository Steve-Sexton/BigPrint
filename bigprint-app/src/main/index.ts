import path from 'path'
import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { log } from '../shared/log'
import { registerAllHandlers, setActiveWindow } from './ipc/handlers'
import { isSafeExternalUrl, isSameOrigin, canOpenExternalNow } from './security'

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Preload only uses contextBridge / ipcRenderer / webUtils — all
      // available to sandboxed preloads — so sandbox:true is safe and
      // strictly reduces attack surface if the renderer is ever compromised.
      sandbox: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#f5f5f5',
    show: false,
  })

  // Register IPC handlers exactly once (subsequent calls are no-ops), and
  // keep the active-window reference up to date for dialog parenting.
  registerAllHandlers(mainWindow)
  setActiveWindow(mainWindow)

  mainWindow.on('closed', () => {
    setActiveWindow(null)
    mainWindow = null
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in browser — scheme allowlist prevents file://, javascript:,
  // or custom-protocol abuse from a malicious SVG/PDF or renderer compromise.
  // Rate-limited so a compromised renderer cannot spam the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isSafeExternalUrl(url)) {
      log.warn('main', 'Blocked window-open for unsafe URL:', url)
      return { action: 'deny' }
    }
    if (!canOpenExternalNow()) {
      log.warn('main', 'shell.openExternal rate limit exceeded; dropping:', url)
      return { action: 'deny' }
    }
    shell.openExternal(url).catch(err => log.warn('main', 'shell.openExternal failed:', err))
    return { action: 'deny' }
  })

  // Reject any top-level navigation away from the app's own origin. Compare
  // origins, not full URLs — string equality falls over on trailing slashes,
  // fragments, and reordered query strings.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? ''
    if (!isSameOrigin(url, current)) event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Dark mode sync
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors)
  })
}

// Apply session-level security policies before the first window is created:
//   - Content-Security-Policy via response headers (defence-in-depth vs meta tag),
//   - Deny every permission request/check so a compromised renderer cannot ask
//     for geolocation, notifications, media, clipboard-read, etc.
function installSessionSecurity(): void {
  const ses = session.defaultSession

  const CSP =
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self'; " +
    "worker-src 'self' blob:;"

  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders ?? {}) }
    // Strip any upstream CSP so ours wins unambiguously.
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'content-security-policy') delete headers[k]
    }
    headers['Content-Security-Policy'] = [CSP]
    callback({ responseHeaders: headers })
  })

  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
}

app
  .whenReady()
  .then(() => {
    installSessionSecurity()
    return createWindow()
  })
  .catch(err => {
    log.error('main', 'Fatal error during startup:', err)
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch(err => log.error('main', 'activate createWindow failed:', err))
  }
})

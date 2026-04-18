import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import path from 'path'
import { registerAllHandlers } from './ipc/handlers'
import { isSafeExternalUrl } from './security'

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
      sandbox: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#f5f5f5',
    show: false,
  })

  // Register all IPC handlers
  registerAllHandlers(mainWindow)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in browser — scheme allowlist prevents file://, javascript:,
  // or custom-protocol abuse from a malicious SVG/PDF or renderer compromise.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(() => {})
    } else {
      console.warn('[main] Blocked window-open for unsafe URL:', url)
    }
    return { action: 'deny' }
  })

  // Reject any top-level navigation away from the app's own origin.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? ''
    if (url !== current) event.preventDefault()
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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

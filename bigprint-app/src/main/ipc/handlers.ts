import fs from 'fs/promises'
import path from 'path'
import { ipcMain, dialog, BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { PDFDocument } from 'pdf-lib'
import { log } from '../../shared/log'
import type {
  ExportPDFParams,
  PrintParams,
  SaveProjectParams,
  SaveProjectResult,
  TestGridParams,
  AppPreferences,
} from '../../shared/ipc-types'
import {
  validateAppPreferences,
  validateExportParams,
  validateTiling,
  validateGrid,
  validateFileFilters,
} from '../../shared/ipc-types'
import { getImageMeta, getPreviewDataUrl, getSupportedMimeType } from '../image/ImagePipeline'
import { exportToPDF, exportTestGridPDF } from '../pdf/PDFEngine'
import { printDirect } from '../print/PrintManager'
import { PreferencesStore } from '../preferences/PreferencesStore'
import { saveProject, loadProject } from '../project/ProjectFile'
import {
  SUPPORTED_INPUT_EXTENSIONS,
  MAX_REGISTER_PER_SESSION,
  MAX_REGISTER_BYTES,
} from '../../shared/constants'

// ── Runtime helpers for IPC argument validation ─────────────────────────────
// IPC arguments from the renderer cross a trust boundary. Handler param types
// are declared `unknown` and narrowed through the validators below.
const isFiniteNumberInRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

// ── File path validation ───────────────────────────────────────────────────────
// IPC handlers receive file paths from the renderer. Even with contextIsolation
// the path should be absolute and free of null bytes before we pass it to
// Node.js file APIs. Exported for unit tests — the predicate is pure.
export function isValidFilePath(filePath: unknown): filePath is string {
  return (
    typeof filePath === 'string' &&
    filePath.length > 0 &&
    !filePath.includes('\0') &&
    path.isAbsolute(filePath)
  )
}

export function assertFilePath(filePath: unknown): string {
  if (!isValidFilePath(filePath)) {
    throw new Error(`Invalid file path: ${JSON.stringify(filePath)}`)
  }
  return filePath
}

// Render a PDF page to a PNG data URL via Sharp (requires libvips-poppler).
// Returns '' when unavailable (common on Windows). PreviewCanvas.tsx detects
// the empty URL and switches to the renderer-side PDF.js pipeline via
// usePDFPreview.ts (which fetches raw bytes over pdf:getBytes and rasterises
// in the renderer's own canvas).
// PDF points are 1/72 inch — match the renderer-side pdfRasterize which uses
// the same 72-DPI base so preview and export raster resolutions agree.
async function renderPDFPageDataUrl(filePath: string, pageIndex: number, scale: number): Promise<string> {
  try {
    const sharp = (await import('sharp')).default
    const buf = await sharp(filePath, { page: pageIndex, density: Math.round(72 * scale) })
      .png()
      .toBuffer()
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch (err) {
    // Sharp lacks poppler on this build (Windows) OR the file is unreadable /
    // corrupt / the page doesn't exist. In all cases we return '' so the
    // renderer falls back to its own PDF.js pipeline. Log at warn level so
    // operators debugging "preview unavailable" can see the real cause.
    log.warn('ipc', 'renderPDFPageDataUrl Sharp fallback:', err)
    return ''
  }
}

// Mutable reference to the currently-active window. registerAllHandlers is
// called exactly once at app startup; the window may change across
// open/close/reactivate cycles, and setActiveWindow updates the reference so
// later IPC invocations address whichever window is current.
let activeWindow: BrowserWindow | null = null
export function setActiveWindow(win: BrowserWindow | null): void {
  activeWindow = win
}

// Session-scoped allowlist of paths the renderer is permitted to read back
// verbatim via `pdf:getBytes` / `image:*`.  A path is added only when it has
// entered through a user-initiated flow (open dialog or confirmed dropped
// file).  This blocks a compromised renderer from turning IPC into an
// arbitrary-file-read primitive.
const allowedReadPaths = new Set<string>()
const allowRead = (p: string): void => {
  allowedReadPaths.add(path.normalize(p))
}
const isReadAllowed = (p: string): boolean => allowedReadPaths.has(path.normalize(p))

// Session-lifetime counter for file:register. Hoisted to module scope so
// __resetHandlerStateForTests can reset it — otherwise the closure captured
// inside registerAllHandlers would accumulate across test runs and cause
// flaky ordering-dependent failures.
let registerCount = 0

// Exposed for unit tests that need to reset state between runs.
export function __resetHandlerStateForTests(): void {
  allowedReadPaths.clear()
  activeWindow = null
  pdfBytesFetchTimestamps.clear()
  registerCount = 0
}

// ── Size ceiling for IPC file reads ────────────────────────────────────────
// Shared with file:register via MAX_REGISTER_BYTES in shared/constants.ts so
// pdf:getBytes / pdf:getPageCount enforce the same cap.
const MAX_IPC_FILE_BYTES = MAX_REGISTER_BYTES

// Rolling-window rate limit for pdf:getBytes. A compromised renderer could
// otherwise re-read an admitted file arbitrarily many times to exfiltrate via
// local storage / postMessage. A fixed lifetime cap broke normal UX — the
// window approach blocks abuse loops while letting ordinary flows (preview →
// page-nav → export → print → retry → edit-and-re-export) complete freely.
const PDF_FETCH_WINDOW_MS = 60_000
const PDF_FETCH_MAX_PER_WINDOW = 20
// Entries older than PDF_FETCH_GC_MS with zero timestamps are pruned on each
// call so the map can't grow unbounded across a long session of opening many
// files.
const PDF_FETCH_GC_MS = 5 * 60_000
const pdfBytesFetchTimestamps = new Map<string, number[]>()
function recordAndCheckPdfFetch(p: string, nowMs: number = Date.now()): void {
  // Drop timestamps outside the sliding window for THIS path.
  const windowStart = nowMs - PDF_FETCH_WINDOW_MS
  const prev = pdfBytesFetchTimestamps.get(p) ?? []
  const fresh = prev.filter(t => t > windowStart)
  if (fresh.length >= PDF_FETCH_MAX_PER_WINDOW) {
    throw new Error(
      `Too many pdf:getBytes fetches for this path (${fresh.length + 1} in ${PDF_FETCH_WINDOW_MS}ms)`
    )
  }
  fresh.push(nowMs)
  pdfBytesFetchTimestamps.set(p, fresh)

  // Opportunistic GC: forget any path whose newest timestamp is older than
  // PDF_FETCH_GC_MS. Bounds the map size across a long-running session.
  const gcCutoff = nowMs - PDF_FETCH_GC_MS
  for (const [key, ts] of pdfBytesFetchTimestamps) {
    if (ts.length === 0 || (ts[ts.length - 1] ?? 0) < gcCutoff) {
      pdfBytesFetchTimestamps.delete(key)
    }
  }
}

let handlersRegistered = false

export function registerAllHandlers(win: BrowserWindow): void {
  setActiveWindow(win)
  if (handlersRegistered) return
  handlersRegistered = true

  // Resolve the current window at call time; falls back to the window passed
  // at registration if setActiveWindow hasn't been invoked since.
  const currentWin = (): BrowserWindow => {
    const w = activeWindow ?? win
    if (w.isDestroyed()) throw new Error('No active window for IPC handler')
    return w
  }

  // Reject IPC calls from frames other than the main frame of the active
  // BrowserWindow. Prevents any future nested <webview>/<iframe> from reaching
  // privileged handlers.
  const isTrustedSender = (event: IpcMainInvokeEvent): boolean => {
    const frame = event.senderFrame
    if (frame === null) return false
    try {
      return frame === currentWin().webContents.mainFrame
    } catch {
      return false
    }
  }
  function guard(event: IpcMainInvokeEvent): void {
    if (!isTrustedSender(event)) throw new Error('Unauthorized IPC sender')
  }

  // ── File open ──────────────────────────────────────────────────────────
  ipcMain.handle('file:open', async event => {
    guard(event)
    const result = await dialog.showOpenDialog(currentWin(), {
      title: 'Open Image or PDF',
      properties: ['openFile'],
      filters: [
        { name: 'Supported Files', extensions: SUPPORTED_INPUT_EXTENSIONS.map(e => e.slice(1)) },
        {
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'tiff', 'tif', 'svg', 'avif'],
        },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    allowRead(filePath)
    return { filePath, mimeType: getSupportedMimeType(filePath) }
  })

  // Dropped files and clipboard paths come in through this handler. The
  // renderer is only trusted with the path to a file it obtained from the
  // user's drag-and-drop (via webUtils.getPathForFile). To limit the blast
  // radius if a compromised renderer calls this directly, we:
  //   1. Require the extension to match one we actually support,
  //   2. Require the file to exist, be a regular file, and be below a
  //      reasonable size ceiling (avoids /dev/zero-style DOS and arbitrary
  //      non-media reads),
  //   3. Cap the number of registrations per session.
  // This does not fully replace a trusted-drop channel from the main process
  // but narrows the attack surface materially compared to admitting any
  // absolute path.
  ipcMain.handle('file:register', async (event, filePath: unknown) => {
    guard(event)
    const p = assertFilePath(filePath)
    if (registerCount >= MAX_REGISTER_PER_SESSION) {
      throw new Error('Too many file registrations this session')
    }
    const ext = path.extname(p).toLowerCase()
    if (!SUPPORTED_INPUT_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported file extension: ${ext || '(none)'}`)
    }
    const stat = await fs.stat(p).catch(() => null)
    if (!stat || !stat.isFile()) {
      throw new Error('File does not exist or is not a regular file')
    }
    if (stat.size > MAX_REGISTER_BYTES) {
      throw new Error(`File too large to register (${stat.size} bytes)`)
    }
    registerCount++
    allowRead(p)
    return { filePath: p, mimeType: getSupportedMimeType(p) }
  })

  // ── Save project dialog ────────────────────────────────────────────────
  // Returns a discriminated union so the renderer can distinguish a user
  // cancel (silent) from a genuine error (toast) from a success (confirm the
  // written path). Previous boolean return type swallowed every failure.
  ipcMain.handle('project:save', async (event, rawData: unknown): Promise<SaveProjectResult> => {
    guard(event)
    try {
      if (!rawData || typeof rawData !== 'object') {
        return { ok: false, reason: 'error', errorMessage: 'Invalid params' }
      }
      const data = rawData as SaveProjectParams
      // Basic shape check — validateExportParams covers scale/tiling/grid/inkSaver
      const err = validateExportParams({ ...data, outputPath: data.filePath })
      if (err) return { ok: false, reason: 'error', errorMessage: err }
      let filePath = data.filePath
      if (!filePath) {
        const res = await dialog.showSaveDialog(currentWin(), {
          title: 'Save Project',
          defaultPath: 'project.tilr',
          filters: [{ name: 'BigPrint Project', extensions: ['tilr'] }],
        })
        if (res.canceled || !res.filePath) return { ok: false, reason: 'cancel' }
        filePath = res.filePath
      } else if (!isValidFilePath(filePath)) {
        return { ok: false, reason: 'error', errorMessage: 'Invalid output path' }
      }
      await saveProject(filePath, data)
      return { ok: true, path: filePath }
    } catch (err) {
      return { ok: false, reason: 'error', errorMessage: String(err) }
    }
  })

  // ── Load project dialog ────────────────────────────────────────────────
  ipcMain.handle('project:load', async event => {
    guard(event)
    const res = await dialog.showOpenDialog(currentWin(), {
      title: 'Open Project',
      filters: [{ name: 'BigPrint Project', extensions: ['tilr'] }],
      properties: ['openFile'],
    })
    if (res.canceled || !res.filePaths[0]) return null
    try {
      return await loadProject(res.filePaths[0])
    } catch (err) {
      dialog.showErrorBox('Load Failed', `Could not load project: ${String(err)}`)
      return null
    }
  })

  // ── Image metadata ─────────────────────────────────────────────────────
  ipcMain.handle('image:getMeta', async (event, filePath: unknown) => {
    guard(event)
    const p = assertFilePath(filePath)
    if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
    return getImageMeta(p)
  })

  // ── Preview data URL ───────────────────────────────────────────────────
  ipcMain.handle('image:getPreview', async (event, filePath: unknown, maxSizePx: unknown) => {
    guard(event)
    const p = assertFilePath(filePath)
    if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
    if (!isFiniteNumberInRange(maxSizePx, 1, 16384)) {
      throw new Error(`Invalid maxSizePx: ${JSON.stringify(maxSizePx)}`)
    }
    return getPreviewDataUrl(p, maxSizePx)
  })

  // ── PDF page render ────────────────────────────────────────────────────
  ipcMain.handle('pdf:renderPage', async (event, filePath: unknown, pageIndex: unknown, scale: unknown) => {
    guard(event)
    const p = assertFilePath(filePath)
    if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
    if (!isFiniteNumberInRange(pageIndex, 0, 100000)) {
      throw new Error(`Invalid pageIndex: ${JSON.stringify(pageIndex)}`)
    }
    if (!isFiniteNumberInRange(scale, 0.01, 100)) {
      throw new Error(`Invalid scale: ${JSON.stringify(scale)}`)
    }
    return renderPDFPageDataUrl(p, pageIndex, scale)
  })

  // ── PDF page count ─────────────────────────────────────────────────────
  ipcMain.handle('pdf:getPageCount', async (event, filePath: unknown) => {
    guard(event)
    // assertFilePath and the allowlist check intentionally run OUTSIDE the
    // try/catch below: a guard/assertion failure is a security signal, not an
    // encrypted-PDF fallback case, and must surface to the caller.
    const p = assertFilePath(filePath)
    if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
    const stat = await fs.stat(p)
    if (stat.size > MAX_IPC_FILE_BYTES) {
      throw new Error(`File too large to read (${stat.size} bytes, max ${MAX_IPC_FILE_BYTES})`)
    }
    const bytes = await fs.readFile(p)
    try {
      // ignoreEncryption:true already handles encrypted PDFs — pdf-lib returns
      // a usable document with its page count visible. If that still throws,
      // the PDF structure itself is malformed (truncated, corrupt header,
      // wrong magic) and the caller deserves to see the real error rather
      // than a phantom "1 page" fallback that hides the root cause.
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      return doc.getPageCount()
    } catch (err) {
      throw new Error(`Could not parse PDF: ${String(err)}`)
    }
  })

  // ── PDF raw bytes — lets the renderer run PDF.js without a file:// URL ──
  // Avoids cross-origin security blocks when the renderer is on http://localhost
  // during development (electron-vite dev mode).
  ipcMain.handle('pdf:getBytes', async (event, filePath: unknown) => {
    guard(event)
    const p = assertFilePath(filePath)
    if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
    // Only .pdf paths — this channel streams raw bytes to the renderer for
    // PDF.js, so non-PDF extensions are an anomaly not a legitimate request.
    if (path.extname(p).toLowerCase() !== '.pdf') {
      throw new Error(`pdf:getBytes rejected non-PDF path: ${JSON.stringify(p)}`)
    }
    // Cap repeat fetches to detect loop exfiltration.
    recordAndCheckPdfFetch(p)
    const stat = await fs.stat(p)
    if (stat.size > MAX_IPC_FILE_BYTES) {
      throw new Error(`File too large to read (${stat.size} bytes, max ${MAX_IPC_FILE_BYTES})`)
    }
    const buf = await fs.readFile(p)
    // Copy into a fresh ArrayBuffer (not a Buffer view of ArrayBufferLike) so
    // the static type is unambiguously ArrayBuffer (no SharedArrayBuffer risk)
    // and structured-clone across the context bridge is well-defined.
    const copy = new ArrayBuffer(buf.byteLength)
    new Uint8Array(copy).set(buf)
    return copy
  })

  // ── Export PDF ─────────────────────────────────────────────────────────
  ipcMain.handle('export:pdf', async (event, rawParams: unknown) => {
    guard(event)
    if (!rawParams || typeof rawParams !== 'object') {
      return { success: false, errorMessage: 'Invalid params' }
    }
    const verr = validateExportParams(rawParams)
    if (verr) return { success: false, errorMessage: verr }
    let params = rawParams as ExportPDFParams
    if (!params.outputPath) {
      const res = await dialog.showSaveDialog(currentWin(), {
        title: 'Export PDF',
        defaultPath: 'output.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (res.canceled || !res.filePath) return { success: false, errorMessage: 'Cancelled' }
      params = { ...params, outputPath: res.filePath }
    } else if (!isValidFilePath(params.outputPath)) {
      return { success: false, errorMessage: 'Invalid output path' }
    }
    return exportToPDF(params)
  })

  // ── Export test grid (calibration page — no image source) ──────────────
  ipcMain.handle('export:testgrid', async (event, rawParams: unknown) => {
    guard(event)
    if (!rawParams || typeof rawParams !== 'object') {
      return { success: false, errorMessage: 'Invalid params' }
    }
    let params = rawParams as TestGridParams
    // TestGridParams has no scale/inkSaver — validate tiling/grid only.
    const terr = validateTiling(params.tiling)
    if (terr) return { success: false, errorMessage: terr }
    const gerr = validateGrid(params.grid)
    if (gerr) return { success: false, errorMessage: gerr }
    if (!params.outputPath) {
      const res = await dialog.showSaveDialog(currentWin(), {
        title: 'Save Calibration Grid',
        defaultPath: 'calibration-grid.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (res.canceled || !res.filePath) return { success: false, errorMessage: 'Cancelled' }
      params = { ...params, outputPath: res.filePath }
    } else if (!isValidFilePath(params.outputPath)) {
      return { success: false, errorMessage: 'Invalid output path' }
    }
    return exportTestGridPDF(params)
  })

  // ── Print ──────────────────────────────────────────────────────────────
  ipcMain.handle('print:direct', async (event, rawParams: unknown) => {
    guard(event)
    if (!rawParams || typeof rawParams !== 'object') {
      return { success: false, errorMessage: 'Invalid params' }
    }
    const params = rawParams as PrintParams
    const verr = validateExportParams({ ...params, outputPath: '' })
    if (verr) return { success: false, errorMessage: verr }
    return printDirect(currentWin(), params)
  })

  // ── System printers ────────────────────────────────────────────────────
  // webContents.getPrinters / getPrintersAsync were removed from Electron's
  // public API (deprecated earlier, dropped in Electron 22+). This app
  // targets Electron 40, so the API is unavailable at runtime and we always
  // return the default-printer sentinel. The UI uses `deviceName: ''`
  // against this sentinel to drive the OS default printer.
  ipcMain.handle('print:getPrinters', async event => {
    guard(event)
    return [{ name: '', displayName: 'System default printer' }]
  })

  // ── Preferences ────────────────────────────────────────────────────────────
  ipcMain.handle('preferences:load', async event => {
    guard(event)
    return PreferencesStore.load()
  })
  ipcMain.handle('preferences:save', async (event, prefs: unknown) => {
    guard(event)
    const err = validateAppPreferences(prefs)
    if (err) throw new Error(`Invalid preferences: ${err}`)
    await PreferencesStore.save(prefs as AppPreferences)
  })

  // ── Save dialog (generic) ──────────────────────────────────────────────
  ipcMain.handle('dialog:showSave', async (event, defaultName: unknown, filters: unknown) => {
    guard(event)
    if (typeof defaultName !== 'string') {
      throw new Error(`Invalid defaultName: ${JSON.stringify(defaultName)}`)
    }
    const ferr = validateFileFilters(filters)
    if (ferr) throw new Error(`Invalid filters: ${ferr}`)
    const res = await dialog.showSaveDialog(currentWin(), {
      defaultPath: defaultName,
      filters: filters as { name: string; extensions: string[] }[],
    })
    return res.canceled ? null : res.filePath
  })
}

import { ipcMain, dialog, BrowserWindow, IpcMainInvokeEvent } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import type {
  ExportPDFParams, PrintParams, SaveProjectParams,
  TestGridParams, AppPreferences, FileFilter
} from '../../shared/ipc-types'
import {
  validateAppPreferences, validateExportParams, validateTiling, validateGrid
} from '../../shared/ipc-types'
import { getImageMeta, getPreviewDataUrl, getSupportedMimeType } from '../image/ImagePipeline'
import { exportToPDF, exportTestGridPDF } from '../pdf/PDFEngine'
import { printDirect } from '../print/PrintManager'
import { PreferencesStore } from '../preferences/PreferencesStore'
import { saveProject, loadProject } from '../project/ProjectFile'
import { SUPPORTED_INPUT_EXTENSIONS } from '../../shared/constants'

// ── File path validation ───────────────────────────────────────────────────────
// IPC handlers receive file paths from the renderer. Even with contextIsolation
// the path should be absolute and free of null bytes before we pass it to
// Node.js file APIs.
function isValidFilePath(filePath: unknown): filePath is string {
  return (
    typeof filePath === 'string' &&
    filePath.length > 0 &&
    !filePath.includes('\0') &&
    path.isAbsolute(filePath)
  )
}

function assertFilePath(filePath: unknown): string {
  if (!isValidFilePath(filePath)) {
    throw new Error(`Invalid file path: ${JSON.stringify(filePath)}`)
  }
  return filePath
}

// Render a PDF page to a PNG data URL via Sharp (requires libvips-poppler).
// Returns '' when unavailable (common on Windows), where the renderer falls
// back to PDF.js in usePDFPreview.ts.
// PDF points are 1/72 inch — match the renderer-side pdfRasterize which uses
// the same 72-DPI base so preview and export raster resolutions agree.
async function renderPDFPageDataUrl(filePath: string, pageIndex: number, scale: number): Promise<string> {
  try {
    const sharp = (await import('sharp')).default
    const buf = await sharp(filePath, { page: pageIndex, density: Math.round(72 * scale) })
      .png()
      .toBuffer()
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    // Sharp lacks poppler on this build — signal the renderer to rasterise
    // the page via PDF.js instead (usePDFPreview.ts handles the fallback).
    return ''
  }
}

export function registerAllHandlers(win: BrowserWindow): void {

  // Session-scoped allowlist of paths the renderer is permitted to read back
  // verbatim via `pdf:getBytes` / `image:*`.  A path is added only when it has
  // entered through a user-initiated flow (open dialog or confirmed dropped
  // file).  This blocks a compromised renderer from turning IPC into an
  // arbitrary-file-read primitive.
  const allowedReadPaths = new Set<string>()
  const allowRead = (p: string) => allowedReadPaths.add(path.normalize(p))
  const isReadAllowed = (p: string) => allowedReadPaths.has(path.normalize(p))

  // Reject IPC calls from frames other than the main frame of the BrowserWindow
  // we registered against. Prevents any future nested <webview>/<iframe> from
  // reaching privileged handlers.
  const isTrustedSender = (event: IpcMainInvokeEvent): boolean => {
    const frame = event.senderFrame
    return frame !== null && frame === win.webContents.mainFrame
  }
  function guard(event: IpcMainInvokeEvent): void {
    if (!isTrustedSender(event)) throw new Error('Unauthorized IPC sender')
  }

  // ── File open ──────────────────────────────────────────────────────────
  ipcMain.handle('file:open', async (event) => {
    guard(event)
    const result = await dialog.showOpenDialog(win, {
      title: 'Open Image or PDF',
      properties: ['openFile'],
      filters: [
        { name: 'Supported Files', extensions: SUPPORTED_INPUT_EXTENSIONS.map(e => e.slice(1)) },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'tiff', 'tif', 'svg', 'avif'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    allowRead(filePath)
    return { filePath, mimeType: getSupportedMimeType(filePath) }
  })

  // Dropped files and clipboard paths come in through the metadata handler —
  // register them as allowed before subsequent reads are attempted.
  ipcMain.handle('file:register', async (event, filePath: unknown) => {
    guard(event)
    const p = assertFilePath(filePath)
    allowRead(p)
    return { filePath: p, mimeType: getSupportedMimeType(p) }
  })

  // ── Save project dialog ────────────────────────────────────────────────
  ipcMain.handle('project:save', async (event, data: SaveProjectParams) => {
    guard(event)
    try {
      // Basic shape check — validateExportParams covers scale/tiling/grid/inkSaver
      const err = validateExportParams({ ...data, outputPath: data.filePath })
      if (err) return false
      let filePath = data.filePath
      if (!filePath) {
        const res = await dialog.showSaveDialog(win, {
          title: 'Save Project',
          defaultPath: 'project.tilr',
          filters: [{ name: 'BigPrint Project', extensions: ['tilr'] }]
        })
        if (res.canceled || !res.filePath) return false
        filePath = res.filePath
      } else if (!isValidFilePath(filePath)) {
        return false
      }
      await saveProject(filePath, data)
      return true
    } catch { return false }
  })

  // ── Load project dialog ────────────────────────────────────────────────
  ipcMain.handle('project:load', async (event) => {
    guard(event)
    const res = await dialog.showOpenDialog(win, {
      title: 'Open Project',
      filters: [{ name: 'BigPrint Project', extensions: ['tilr'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths[0]) return null
    try { return await loadProject(res.filePaths[0]) }
    catch (err) {
      dialog.showErrorBox('Load Failed', `Could not load project: ${String(err)}`)
      return null
    }
  })

  // ── Image metadata ─────────────────────────────────────────────────────
  ipcMain.handle('image:getMeta', async (event, filePath: string) => {
    guard(event)
    const p = assertFilePath(filePath)
    if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
    return getImageMeta(p)
  })

  // ── Preview data URL ───────────────────────────────────────────────────
  ipcMain.handle('image:getPreview', async (event, filePath: string, maxSizePx: number) => {
    guard(event)
    const p = assertFilePath(filePath)
    if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
    return getPreviewDataUrl(p, maxSizePx)
  })

  // ── PDF page render ────────────────────────────────────────────────────
  ipcMain.handle('pdf:renderPage', async (event, filePath: string, pageIndex: number, scale: number) => {
    guard(event)
    const p = assertFilePath(filePath)
    if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
    return renderPDFPageDataUrl(p, pageIndex, scale)
  })

  // ── PDF page count ─────────────────────────────────────────────────────
  ipcMain.handle('pdf:getPageCount', async (event, filePath: string) => {
    guard(event)
    try {
      const p = assertFilePath(filePath)
      if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
      const bytes = await fs.readFile(p)
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      return doc.getPageCount()
    } catch {
      return 1  // fallback for encrypted / unreadable PDFs
    }
  })

  // ── PDF raw bytes — lets the renderer run PDF.js without a file:// URL ──
  // Avoids cross-origin security blocks when the renderer is on http://localhost
  // during development (electron-vite dev mode).
  ipcMain.handle('pdf:getBytes', async (event, filePath: string) => {
    guard(event)
    const p = assertFilePath(filePath)
    if (!isReadAllowed(p)) throw new Error('File path is not in the session allowlist')
    const buf = await fs.readFile(p)
    // Return a true ArrayBuffer (not a Buffer/Uint8Array view) so that the
    // structured-clone serialisation across the context bridge is unambiguous.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })

  // ── Export PDF ─────────────────────────────────────────────────────────
  ipcMain.handle('export:pdf', async (event, params: ExportPDFParams) => {
    guard(event)
    const verr = validateExportParams(params)
    if (verr) return { success: false, errorMessage: verr }
    if (!params.outputPath) {
      const res = await dialog.showSaveDialog(win, {
        title: 'Export PDF',
        defaultPath: 'output.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return { success: false, errorMessage: 'Cancelled' }
      params = { ...params, outputPath: res.filePath }
    } else if (!isValidFilePath(params.outputPath)) {
      return { success: false, errorMessage: 'Invalid output path' }
    }
    return exportToPDF(params)
  })

  // ── Export test grid (calibration page — no image source) ──────────────
  ipcMain.handle('export:testgrid', async (event, params: TestGridParams) => {
    guard(event)
    // TestGridParams has no scale/inkSaver — validate tiling/grid only.
    const terr = validateTiling(params?.tiling)
    if (terr) return { success: false, errorMessage: terr }
    const gerr = validateGrid(params?.grid)
    if (gerr) return { success: false, errorMessage: gerr }
    if (!params.outputPath) {
      const res = await dialog.showSaveDialog(win, {
        title: 'Save Calibration Grid',
        defaultPath: 'calibration-grid.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return { success: false, errorMessage: 'Cancelled' }
      params = { ...params, outputPath: res.filePath }
    } else if (!isValidFilePath(params.outputPath)) {
      return { success: false, errorMessage: 'Invalid output path' }
    }
    return exportTestGridPDF(params)
  })

  // ── Print ──────────────────────────────────────────────────────────────
  ipcMain.handle('print:direct', async (event, params: PrintParams) => {
    guard(event)
    const verr = validateExportParams({ ...params, outputPath: '' })
    if (verr) return { success: false, errorMessage: verr }
    return printDirect(win, params)
  })

  // ── System printers ────────────────────────────────────────────────────
  ipcMain.handle('print:getPrinters', async (event) => {
    guard(event)
    const printers = await win.webContents.getPrintersAsync()
    return printers.map(p => ({
      name: p.name,
      displayName: p.displayName ?? p.name
    }))
  })

  // ── Preferences ────────────────────────────────────────────────────────────
  ipcMain.handle('preferences:load', async (event) => {
    guard(event)
    return PreferencesStore.load()
  })
  ipcMain.handle('preferences:save', async (event, prefs: AppPreferences) => {
    guard(event)
    const err = validateAppPreferences(prefs)
    if (err) throw new Error(`Invalid preferences: ${err}`)
    await PreferencesStore.save(prefs)
  })

  // ── Save dialog (generic) ──────────────────────────────────────────────
  ipcMain.handle('dialog:showSave', async (event, defaultName: string, filters: FileFilter[]) => {
    guard(event)
    const res = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters })
    return res.canceled ? null : res.filePath
  })
}

import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import type {
  ExportPDFParams, PrintParams, SaveProjectParams,
  TestGridParams, AppPreferences
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
async function renderPDFPageDataUrl(filePath: string, pageIndex: number, scale: number): Promise<string> {
  try {
    const sharp = (await import('sharp')).default
    const buf = await sharp(filePath, { page: pageIndex, density: Math.round(96 * scale) })
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

  // ── File open ──────────────────────────────────────────────────────────
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Open Image or PDF',
      properties: ['openFile'],
      filters: [
        { name: 'Supported Files', extensions: SUPPORTED_INPUT_EXTENSIONS.map(e => e.slice(1)) },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'tiff', 'tif', 'svg'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    return { filePath, mimeType: getSupportedMimeType(filePath) }
  })

  // ── Save project dialog ────────────────────────────────────────────────
  ipcMain.handle('project:save', async (_event, data: SaveProjectParams) => {
    try {
      let filePath = data.filePath
      if (!filePath) {
        const res = await dialog.showSaveDialog(win, {
          title: 'Save Project',
          defaultPath: 'project.tilr',
          filters: [{ name: 'BigPrint Project', extensions: ['tilr'] }]
        })
        if (res.canceled || !res.filePath) return false
        filePath = res.filePath
      }
      await saveProject(filePath, data)
      return true
    } catch { return false }
  })

  // ── Load project dialog ────────────────────────────────────────────────
  ipcMain.handle('project:load', async () => {
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
  ipcMain.handle('image:getMeta', async (_event, filePath: string) => {
    return getImageMeta(assertFilePath(filePath))
  })

  // ── Preview data URL ───────────────────────────────────────────────────
  ipcMain.handle('image:getPreview', async (_event, filePath: string, maxSizePx: number) => {
    return getPreviewDataUrl(assertFilePath(filePath), maxSizePx)
  })

  // ── PDF page render ────────────────────────────────────────────────────
  ipcMain.handle('pdf:renderPage', async (_event, filePath: string, pageIndex: number, scale: number) => {
    return renderPDFPageDataUrl(assertFilePath(filePath), pageIndex, scale)
  })

  // ── PDF page count ─────────────────────────────────────────────────────
  ipcMain.handle('pdf:getPageCount', async (_event, filePath: string) => {
    try {
      const bytes = await fs.readFile(assertFilePath(filePath))
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      return doc.getPageCount()
    } catch {
      return 1  // fallback for encrypted / unreadable PDFs
    }
  })

  // ── PDF raw bytes — lets the renderer run PDF.js without a file:// URL ──
  // Avoids cross-origin security blocks when the renderer is on http://localhost
  // during development (electron-vite dev mode).
  ipcMain.handle('pdf:getBytes', async (_event, filePath: string) => {
    const buf = await fs.readFile(assertFilePath(filePath))
    // Return a true ArrayBuffer (not a Buffer/Uint8Array view) so that the
    // structured-clone serialisation across the context bridge is unambiguous.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })

  // ── Export PDF ─────────────────────────────────────────────────────────
  ipcMain.handle('export:pdf', async (_event, params: ExportPDFParams) => {
    if (!params.outputPath) {
      const res = await dialog.showSaveDialog(win, {
        title: 'Export PDF',
        defaultPath: 'output.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return { success: false, errorMessage: 'Cancelled' }
      params = { ...params, outputPath: res.filePath }
    }
    return exportToPDF(params)
  })

  // ── Export test grid (calibration page — no image source) ──────────────
  ipcMain.handle('export:testgrid', async (_event, params: TestGridParams) => {
    if (!params.outputPath) {
      const res = await dialog.showSaveDialog(win, {
        title: 'Save Calibration Grid',
        defaultPath: 'calibration-grid.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return { success: false, errorMessage: 'Cancelled' }
      params = { ...params, outputPath: res.filePath }
    }
    return exportTestGridPDF(params)
  })

  // ── Print ──────────────────────────────────────────────────────────────
  ipcMain.handle('print:direct', async (_event, params: PrintParams) => {
    return printDirect(win, params)
  })

  // ── System printers ────────────────────────────────────────────────────
  ipcMain.handle('print:getPrinters', async () => {
    const printers = await win.webContents.getPrintersAsync()
    return printers.map(p => ({
      name: p.name,
      displayName: p.displayName ?? p.name
    }))
  })

  // ── Preferences ────────────────────────────────────────────────────────────
  ipcMain.handle('preferences:load', async () => {
    return PreferencesStore.load()
  })
  ipcMain.handle('preferences:save', async (_event, prefs: AppPreferences) => {
    await PreferencesStore.save(prefs)
  })

  // ── Save dialog (generic) ──────────────────────────────────────────────
  ipcMain.handle('dialog:showSave', async (_event, defaultName: string, filters: Array<{ name: string; extensions: string[] }>) => {
    const res = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters })
    return res.canceled ? null : res.filePath
  })
}

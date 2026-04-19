import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { pathToFileURL } from 'node:url'
import { BrowserWindow } from 'electron'
import type { PrintParams, PrintResult } from '../../shared/ipc-types'
import { exportToPDF } from '../pdf/PDFEngine'

// Upper bound on how long we wait for webContents.print's callback. Without
// this, a stalled native print dialog would keep the hidden print window alive
// forever (the finally block only fires after the print promise settles).
const PRINT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export async function printDirect(win: BrowserWindow, params: PrintParams): Promise<PrintResult> {
  try {
    // Generate the full multi-page tiled PDF into a temp file, then hand it
    // to Electron's webContents.print for the OS print dialog.  Temp file is
    // always deleted (see finally block below).
    const tmpPath = path.join(os.tmpdir(), `bigprint-tmp-${Date.now()}.pdf`)

    const exportResult = await exportToPDF({
      outputPath: tmpPath,
      sourceFile: params.sourceFile,
      scale: params.scale,
      tiling: params.tiling,
      grid: params.grid,
      inkSaver: params.inkSaver,
      enabledPages: params.enabledPages,
      pdfPageIndex: params.pdfPageIndex,
      sourceBuffer: params.sourceBuffer,
      cropRect: params.cropRect,
    })

    if (!exportResult.success) {
      return { success: false, errorMessage: exportResult.errorMessage }
    }

    // Load PDF in a hidden window and print it.
    // Wrap the full loadURL + print flow in try/finally so the window is
    // always destroyed — even if loadURL throws (e.g. temp file unreadable),
    // the print callback never fires, or print throws synchronously.
    // The print window only renders a local PDF in Chromium's built-in viewer,
    // so it does not need Node/preload access — run it sandboxed.
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    let winClosed = false
    const closeWin = () => {
      if (winClosed) return
      winClosed = true
      if (!printWin.isDestroyed()) printWin.close()
    }

    try {
      // pathToFileURL handles Windows backslashes, drive letters, spaces, and
      // non-ASCII characters; naive `file://${tmpPath}` concat does not.
      await printWin.loadURL(pathToFileURL(tmpPath).href)
      const printPromise = new Promise<void>((resolve, reject) => {
        printWin.webContents.print(
          {
            silent: false,
            printBackground: true,
            deviceName: params.printerName ?? '',
            margins: { marginType: 'none' },
          },
          (success, reason) => {
            if (success) resolve()
            else reject(new Error(reason))
          }
        )
      })
      // Race against a timeout so a stalled native print dialog can't keep the
      // hidden print window alive indefinitely. The finally block below still
      // closes the window and removes the temp file on either outcome.
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Print timed out after ${PRINT_TIMEOUT_MS}ms`)),
          PRINT_TIMEOUT_MS
        )
      })
      try {
        await Promise.race([printPromise, timeoutPromise])
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
      }
    } finally {
      closeWin()
      // Always remove the temp file, regardless of whether print succeeded or failed
      await fs.unlink(tmpPath).catch(() => {})
    }

    return { success: true }
  } catch (err) {
    return { success: false, errorMessage: String(err) }
  }
}

import { BrowserWindow } from 'electron'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import type { PrintParams, PrintResult } from '../../shared/ipc-types'
import { exportToPDF } from '../pdf/PDFEngine'

export async function printDirect(
  win: BrowserWindow,
  params: PrintParams
): Promise<PrintResult> {
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
      cropRect: params.cropRect
    })

    if (!exportResult.success) {
      return { success: false, errorMessage: exportResult.errorMessage }
    }

    // Load PDF in a hidden window and print it.
    // Wrap the full loadURL + print flow in try/finally so the window is
    // always destroyed — even if loadURL throws (e.g. temp file unreadable),
    // the print callback never fires, or print throws synchronously.
    const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    let winClosed = false
    const closeWin = () => {
      if (winClosed) return
      winClosed = true
      if (!printWin.isDestroyed()) printWin.close()
    }

    try {
      await printWin.loadURL(`file://${tmpPath}`)
      await new Promise<void>((resolve, reject) => {
        printWin.webContents.print(
          {
            silent: false,
            printBackground: true,
            deviceName: params.printerName ?? '',
            margins: { marginType: 'none' }
          },
          (success, reason) => {
            if (success) resolve()
            else reject(new Error(reason))
          }
        )
      })
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

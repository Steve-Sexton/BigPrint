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
    // Strategy: generate a temp PDF, then print it via webContents.printToPDF
    // For simplicity in MVP, we generate the PDF and open the system print dialog
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

    // Load PDF in a hidden window and print it
    const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    await printWin.loadURL(`file://${tmpPath}`)

    try {
      await new Promise<void>((resolve, reject) => {
        printWin.webContents.print(
          {
            silent: false,
            printBackground: true,
            deviceName: params.printerName ?? '',
            margins: { marginType: 'none' }
          },
          (success, reason) => {
            printWin.close()
            if (success) resolve()
            else reject(new Error(reason))
          }
        )
      })
    } finally {
      // Always remove the temp file, regardless of whether print succeeded or failed
      await fs.unlink(tmpPath).catch(() => {})
    }

    return { success: true }
  } catch (err) {
    return { success: false, errorMessage: String(err) }
  }
}

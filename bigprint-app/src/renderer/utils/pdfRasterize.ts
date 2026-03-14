/**
 * Renderer-side PDF page rasteriser using PDF.js.
 *
 * Sharp cannot read PDF files on Windows (no poppler in the prebuilt binary).
 * Before invoking export:pdf or print:direct for a PDF source, the renderer
 * rasterises the target page at the requested DPI via PDF.js and passes the
 * resulting PNG ArrayBuffer to the main process so PDFEngine can use it with
 * sharp(Buffer.from(sourceBuffer)) instead of sharp(pdfFilePath).
 */

import * as pdfjsLib from 'pdfjs-dist'
import { bridge } from '../ipc/bridge'

// Reuse the same worker URL that usePDFPreview.ts sets.  If this module is
// imported before usePDFPreview, set the workerSrc here; if it is already set
// the assignment is idempotent (same URL).
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()
}

/**
 * Rasterises a single PDF page to a PNG ArrayBuffer.
 *
 * @param filePath   Absolute path to the PDF file (fetched via IPC, no file:// needed).
 * @param pageIndex  0-based page index.
 * @param dpi        Target resolution in pixels-per-inch.
 *                   PDF points are 1/72 inch, so scale = dpi / 72.
 * @returns          PNG image as ArrayBuffer, ready to pass to sharp(Buffer.from(...)).
 */
export async function rasterizePDFPage(
  filePath: string,
  pageIndex: number,
  dpi: number
): Promise<ArrayBuffer> {
  // Fetch raw PDF bytes via IPC (avoids cross-origin block in dev mode)
  const bytes = await bridge.getPDFBytes(filePath)

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) })
  const pdf = await loadingTask.promise

  // PDF.js pages are 1-indexed; clamp to valid range
  const pageNumber = Math.max(1, Math.min(pageIndex + 1, pdf.numPages))
  const page = await pdf.getPage(pageNumber)

  // PDF points → pixels: scale = dpi / 72
  const scale = dpi / 72
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[pdfRasterize] Could not acquire 2D canvas context')

  await page.render({ canvasContext: ctx, viewport }).promise

  page.cleanup()
  await pdf.destroy()

  // Export canvas pixels as a PNG ArrayBuffer
  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('[pdfRasterize] canvas.toBlob returned null')); return }
      blob.arrayBuffer().then(resolve, reject)
    }, 'image/png')
  })
}

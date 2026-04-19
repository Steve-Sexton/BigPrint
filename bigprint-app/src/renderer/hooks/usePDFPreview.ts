import { useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { bridge } from '../ipc/bridge'
import { PDFJS_PREVIEW_SCALE } from '../../shared/constants'
import { log } from '../../shared/log'

// Configure PDF.js worker once at module load.
// Vite's static new URL() analysis will bundle this file as an asset,
// making it available at the resolved URL in both dev and production builds.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

/**
 * Renders the first page of a PDF file to a PNG data URL using PDF.js.
 *
 * This is the renderer-side fallback for when the main process (Sharp/poppler)
 * cannot rasterise PDFs — which is the common case on Windows where Sharp's
 * prebuilt binary does not include libvips-poppler.
 *
 * PDF bytes are fetched via IPC (main process reads the file) rather than
 * using a file:// URL directly.  This avoids a cross-origin security block
 * that Chromium enforces in dev mode, where the renderer is loaded from
 * http://localhost rather than file://.
 *
 * @param filePath  Absolute OS path to the PDF.  Pass null to disable.
 * @returns         PNG data URL, or null while loading / on failure.
 */
export function usePDFPreview(filePath: string | null, pageIndex = 0): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!filePath) {
      setDataUrl(null)
      return
    }

    // Clear immediately so the canvas shows the loading state while the new
    // page renders, rather than lingering on the previous page's image.
    setDataUrl(null)

    const path = filePath
    let cancelled = false
    // Hold a reference outside render() so the cleanup callback can cancel
    // an in-flight load when the component unmounts or deps change quickly.
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null

    async function render() {
      try {
        // Fetch raw bytes through IPC — main process reads the file,
        // so the renderer never needs a file:// URL.
        const bytes = await bridge.getPDFBytes(path)

        // Bail immediately if the effect was already cleaned up while we
        // were waiting for the IPC round-trip (e.g. user changed pages fast).
        if (cancelled) return

        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) })
        const pdf = await loadingTask.promise

        // PDF.js pages are 1-indexed; clamp to valid range
        const pageNumber = Math.max(1, Math.min(pageIndex + 1, pdf.numPages))
        const page = await pdf.getPage(pageNumber)

        // PDFJS_PREVIEW_SCALE (1.5×) gives ~150 dpi for a standard US Letter
        // page (612 × 792 pts) → canvas is ~918 × 1188 px, balancing quality
        // vs. memory. Tune in shared/constants.ts.
        const viewport = page.getViewport({ scale: PDFJS_PREVIEW_SCALE })

        const canvas = document.createElement('canvas')
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          log.warn('usePDFPreview', 'Could not get 2D canvas context')
          return
        }

        await page.render({ canvasContext: ctx, viewport }).promise

        if (!cancelled) {
          setDataUrl(canvas.toDataURL('image/png'))
        }

        // Free PDF.js internal resources
        page.cleanup()
        await pdf.destroy()
      } catch (err) {
        log.warn('usePDFPreview', 'PDF.js render failed:', err)
        if (!cancelled) setDataUrl(null)
      }
    }

    // render() has its own try/catch so rejection paths are already handled;
    // `void` tells the lint rule we intentionally don't await the task here.
    void render()
    return () => {
      cancelled = true
      // Cancel any in-flight PDF.js decode so its worker task is freed.
      // Safe to call even if the promise has already settled.
      void loadingTask?.destroy()
    }
  }, [filePath, pageIndex])

  return dataUrl
}

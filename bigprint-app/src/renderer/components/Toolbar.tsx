import React, { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { bridge } from '../ipc/bridge'
import { rasterizePDFPage } from '../utils/pdfRasterize'
import { MAX_PREVIEW_SIZE_PX, MIN_PRINT_DPI } from '../../shared/constants'

export function Toolbar() {
  const store = useAppStore()
  const { source, scale, tiling, grid, inkSaver, crop, cropMode, selectedPages } = store

  const handleOpen = useCallback(async () => {
    const result = await bridge.openFile()
    if (!result) return

    store.setLoading(true, 'Loading image…')
    try {
      // Both handlers now deal with PDF/SVG gracefully — getImageMeta returns
      // fallback dimensions, getPreviewDataUrl returns '' if format unsupported.
      const isPdf = result.mimeType === 'application/pdf'
      const [meta, previewDataUrl, pdfTotalPages] = await Promise.all([
        bridge.getImageMeta(result.filePath),
        bridge.getPreviewDataUrl(result.filePath, MAX_PREVIEW_SIZE_PX),
        isPdf ? bridge.getPDFPageCount(result.filePath) : Promise.resolve(1),
      ])

      // If Sharp couldn't read the file at all, widthPx comes back 0
      if (meta.widthPx === 0 && meta.heightPx === 0) {
        const ext = result.filePath.split('.').pop()?.toUpperCase() ?? 'this'
        alert(
          `${ext} files are not supported.\n\nSupported formats: JPEG, PNG, TIFF, WebP, BMP, GIF, AVIF, SVG, PDF`
        )
        return
      }

      store.setSource({
        filePath: result.filePath,
        mimeType: result.mimeType,
        naturalWidthPx: meta.widthPx,
        naturalHeightPx: meta.heightPx,
        previewDataUrl: previewDataUrl || '', // '' = no preview; canvas shows placeholder
        pdfPageIndex: 0,
        pdfTotalPages: pdfTotalPages ?? 1,
      })

      // Auto-set DPI from embedded metadata. Raster-image formats carry an
      // honest DPI; PDFs don't (the source is in points — the "DPI" the user
      // cares about is their chosen render density, not a file property), so
      // we leave PDFs to inherit the user's current scale.dpi instead.
      // Reset outputScale to 1.0 on new image: a prior calibration may have
      // rebased outputScale to preserve physical size under a different DPI,
      // and carrying that factor into a fresh file produces incorrect page
      // counts and printed dimensions.
      if (meta.dpiX && meta.dpiX > 10 && meta.format !== 'pdf') {
        store.setScale({ dpi: meta.dpiX, outputScale: 1.0 })
      }
    } catch (err) {
      alert(`Failed to load image: ${err}`)
    } finally {
      store.setLoading(false)
    }
  }, [store])

  const handleExportPDF = useCallback(async () => {
    if (!source) return
    const outputPath = await bridge.showSaveDialog('output.pdf', [{ name: 'PDF', extensions: ['pdf'] }])
    if (!outputPath) return

    store.setLoading(true, 'Generating PDF…')
    try {
      // Sharp cannot read PDFs on Windows (no poppler in prebuilt binary).
      // Rasterise the page here in the renderer via PDF.js and pass the buffer.
      // Use at least MIN_PRINT_DPI (300) for print quality — the default 96 DPI
      // produces ~816×1056px for Letter which upscales ~3× on a 300 DPI printer
      // and looks soft. See shared/constants.ts for the canonical value.
      let sourceBuffer: ArrayBuffer | undefined
      let exportScale = scale
      if (source.mimeType === 'application/pdf') {
        const renderDpi = Math.max(scale.dpi, MIN_PRINT_DPI)
        store.setLoading(true, 'Rasterising PDF page…')
        sourceBuffer = await rasterizePDFPage(source.filePath, source.pdfPageIndex ?? 0, renderDpi)
        store.setLoading(true, 'Generating PDF…')
        // Pass the actual render DPI so tile grid math stays consistent with image dimensions
        exportScale = { ...scale, dpi: renderDpi }
      } else if (source.filePath === '<clipboard>') {
        // Clipboard images have no on-disk path.  Use the raw bytes captured at
        // paste time so Sharp always receives the original full-resolution data,
        // independent of how the canvas preview was generated.
        sourceBuffer = source.clipboardBuffer
      }

      const result = await bridge.exportPDF({
        outputPath,
        sourceFile: source.filePath,
        scale: exportScale,
        tiling,
        grid,
        inkSaver,
        enabledPages: selectedPages,
        pdfPageIndex: source.pdfPageIndex,
        sourceBuffer,
        cropRect: crop ?? undefined,
      })
      if (result.success) {
        alert(`✅ PDF exported: ${result.pagesWritten} pages written to ${result.outputPath}`)
      } else {
        alert(`❌ Export failed: ${result.errorMessage}`)
      }
    } finally {
      store.setLoading(false)
    }
  }, [store, source, scale, tiling, grid, inkSaver, selectedPages, crop])

  const handlePrint = useCallback(async () => {
    if (!source) return
    store.setLoading(true, 'Sending to printer…')
    try {
      let sourceBuffer: ArrayBuffer | undefined
      let printScale = scale
      if (source.mimeType === 'application/pdf') {
        const renderDpi = Math.max(scale.dpi, MIN_PRINT_DPI)
        store.setLoading(true, 'Rasterising PDF page…')
        sourceBuffer = await rasterizePDFPage(source.filePath, source.pdfPageIndex ?? 0, renderDpi)
        store.setLoading(true, 'Sending to printer…')
        printScale = { ...scale, dpi: renderDpi }
      } else if (source.filePath === '<clipboard>') {
        // Same as handleExportPDF: use the raw bytes stored at paste time.
        sourceBuffer = source.clipboardBuffer
      }

      const result = await bridge.print({
        sourceFile: source.filePath,
        scale: printScale,
        tiling,
        grid,
        inkSaver,
        enabledPages: selectedPages,
        pdfPageIndex: source.pdfPageIndex,
        sourceBuffer,
        cropRect: crop ?? undefined,
      })
      if (!result.success) alert(`❌ Print failed: ${result.errorMessage}`)
    } finally {
      store.setLoading(false)
    }
  }, [store, source, scale, tiling, grid, inkSaver, selectedPages, crop])

  const handleSaveProject = useCallback(async () => {
    if (!source) return
    const res = await bridge.saveProject({
      filePath: '',
      scale,
      tiling,
      grid,
      inkSaver,
    })
    // Distinguish the three outcomes — a boolean return would silently drop
    // error cases (EACCES, disk full, invalid path) and leave the user
    // believing the project was saved.
    if (res.ok) {
      alert(`✅ Project saved:\n${res.path}`)
    } else if (res.reason === 'error') {
      alert(`❌ Save failed: ${res.errorMessage}`)
    }
    // 'cancel' → user pressed Cancel in the save dialog — silent, as expected.
  }, [source, scale, tiling, grid, inkSaver])

  // PDF page navigation — updates only pdfPageIndex + previewDataUrl. Uses
  // the narrow setPdfPageIndex action instead of setSource so the user's
  // crop / calibration / measurement state survives page flips within the
  // same PDF.
  const handlePageChange = useCallback(
    (delta: number) => {
      if (!source || source.mimeType !== 'application/pdf') return
      const newIdx = Math.max(0, Math.min(source.pdfTotalPages - 1, source.pdfPageIndex + delta))
      if (newIdx === source.pdfPageIndex) return
      store.setPdfPageIndex(newIdx)
    },
    [source, store]
  )

  const handleLoadProject = useCallback(async () => {
    const data = await bridge.loadProject()
    if (!data) return
    store.setScale(data.scale)
    store.setTiling(data.tiling)
    store.setGrid(data.grid)
    store.setInkSaver(data.inkSaver)
  }, [store])

  // Drag-and-drop on the app level is handled via DOM events in App.tsx
  const btn = 'px-3 py-1.5 rounded text-sm font-medium transition-colors'
  const primary = `${btn} bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40`
  const secondary = `${btn} bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 disabled:opacity-40`

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 select-none">
      <button onClick={handleOpen} className={secondary}>
        📂 Open
      </button>
      <button onClick={handleSaveProject} disabled={!source} className={secondary}>
        💾 Save
      </button>
      <button onClick={handleLoadProject} className={secondary}>
        📂 Load Project
      </button>

      {source && (
        <>
          <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />
          <button
            onClick={() => {
              if (cropMode === 'drawing') {
                store.setCropMode('idle')
                store.resetCropDraw()
              } else {
                store.setCropMode('drawing')
              }
            }}
            className={
              cropMode === 'drawing' ? `${btn} bg-orange-500 hover:bg-orange-600 text-white` : secondary
            }
            title={cropMode === 'drawing' ? 'Cancel crop selection' : 'Select a crop region'}
          >
            {cropMode === 'drawing' ? '✕ Cancel Crop' : '✂ Crop'}
          </button>
          {crop && (
            <button
              onClick={() => store.setCrop(null)}
              className={secondary}
              title="Remove crop — use full image"
            >
              ↩ Full Image
            </button>
          )}
        </>
      )}

      <div className="flex-1" />

      {source && (
        <span className="text-xs text-gray-400 dark:text-gray-500 max-w-48 truncate">
          {source.filePath.split(/[\\/]/).pop()}{' '}
          <span className="text-gray-300 dark:text-gray-600">
            {source.naturalWidthPx}×{source.naturalHeightPx}px
          </span>
        </span>
      )}

      {source?.mimeType === 'application/pdf' && source.pdfTotalPages > 1 && (
        <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
          <button
            onClick={() => handlePageChange(-1)}
            disabled={source.pdfPageIndex <= 0}
            className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40"
            title="Previous page"
          >
            ◀
          </button>
          <span className="min-w-[4rem] text-center">
            p.{source.pdfPageIndex + 1} / {source.pdfTotalPages}
          </span>
          <button
            onClick={() => handlePageChange(1)}
            disabled={source.pdfPageIndex >= source.pdfTotalPages - 1}
            className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40"
            title="Next page"
          >
            ▶
          </button>
        </div>
      )}

      <button onClick={handleExportPDF} disabled={!source} className={primary}>
        ⬇ Export PDF
      </button>
      <button onClick={handlePrint} disabled={!source} className={primary}>
        🖨 Print…
      </button>
    </div>
  )
}

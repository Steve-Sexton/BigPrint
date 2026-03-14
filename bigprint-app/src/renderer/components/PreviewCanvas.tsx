import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { usePreviewRenderer } from '../hooks/usePreviewRenderer'
import { useCalibration } from '../hooks/useCalibration'
import { usePDFPreview } from '../hooks/usePDFPreview'
import { MAX_PREVIEW_SIZE_PX } from '../../shared/constants'

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [previewImg, setPreviewImg] = useState<HTMLImageElement | null>(null)
  const store = useAppStore()
  const { handleCanvasClick } = useCalibration()

  // When the main process can't rasterise a PDF (Sharp has no poppler on Windows),
  // previewDataUrl comes back as ''.  In that case we render it here via PDF.js.
  const isPdfNoPreview =
    store.source?.mimeType === 'application/pdf' && !store.source?.previewDataUrl
  const pdfjsUrl = usePDFPreview(
    isPdfNoPreview ? (store.source?.filePath ?? null) : null,
    store.source?.pdfPageIndex ?? 0
  )

  // The effective preview URL: prefer the main-process result (Sharp/poppler),
  // fall back to the renderer-side PDF.js result, then nothing.
  const effectivePreviewUrl = store.source?.previewDataUrl || pdfjsUrl || null

  // Clear stale preview immediately when file or page changes.
  useEffect(() => {
    setPreviewImg(null)
  }, [store.source?.filePath, store.source?.pdfPageIndex])

  // Load preview image whenever the effective URL changes.
  useEffect(() => {
    if (!effectivePreviewUrl) {
      setPreviewImg(null)
      return
    }
    const img = new Image()
    img.onload = () => setPreviewImg(img)
    img.onerror = () => setPreviewImg(null)
    img.src = effectivePreviewUrl
  }, [effectivePreviewUrl])

  // Render
  usePreviewRenderer(canvasRef, previewImg)

  // Resize canvas to match container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (canvasRef.current && store.source) {
        const rect = el.getBoundingClientRect()
        canvasRef.current.style.width = `${rect.width}px`
        canvasRef.current.style.height = `${rect.height}px`
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [store.source])

  // Initial fit-to-screen when image loads
  useEffect(() => {
    if (!previewImg || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const fitZoom = Math.min(
      (rect.width - 40) / previewImg.naturalWidth,
      (rect.height - 40) / previewImg.naturalHeight,
      1
    )
    const panX = (rect.width - previewImg.naturalWidth * fitZoom) / 2
    const panY = (rect.height - previewImg.naturalHeight * fitZoom) / 2
    store.setZoom(fitZoom)
    store.setPan(panX, panY)
  }, [previewImg])

  // Helper: convert client coordinates → source-image pixel coordinates
  const clientToSrcCoords = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current || !store.source || !previewImg) return null
    const rect = canvasRef.current.getBoundingClientRect()
    const canvasX = (clientX - rect.left - store.panX) / store.zoom
    const canvasY = (clientY - rect.top - store.panY) / store.zoom
    const previewScale = previewImg.naturalWidth / store.source.naturalWidthPx
    return { x: canvasX / previewScale, y: canvasY / previewScale }
  }, [store.source, store.zoom, store.panX, store.panY, previewImg])

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.max(0.05, Math.min(20, store.zoom * delta))
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const newPanX = mx - (mx - store.panX) * (newZoom / store.zoom)
    const newPanY = my - (my - store.panY) * (newZoom / store.zoom)
    store.setZoom(newZoom)
    store.setPan(newPanX, newPanY)
  }, [store.zoom, store.panX, store.panY])

  // Pan dragging (middle or right button)
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  // Whether we're actively drawing a crop rectangle
  const cropDrawRef = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Crop drawing — left button only when in drawing mode
    if (e.button === 0 && store.cropMode === 'drawing' && store.source && previewImg) {
      e.preventDefault()
      const coords = clientToSrcCoords(e.clientX, e.clientY)
      if (coords) {
        store.setCropAnchor(coords)
        store.setCropCurrent(coords)
        cropDrawRef.current = true
      }
      return
    }

    // Pan — middle or right button
    if (e.button === 1 || e.button === 2) {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: store.panX, panY: store.panY }
    }
  }, [store.cropMode, store.source, previewImg, store.panX, store.panY, clientToSrcCoords])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Update live crop rectangle
    if (cropDrawRef.current && store.cropMode === 'drawing') {
      const coords = clientToSrcCoords(e.clientX, e.clientY)
      if (coords) store.setCropCurrent(coords)
      return
    }

    // Pan
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    store.setPan(dragRef.current.panX + dx, dragRef.current.panY + dy)
  }, [store.cropMode, clientToSrcCoords])

  const handleMouseUp = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    // Commit crop rectangle on mouse-up
    if (cropDrawRef.current && store.cropMode === 'drawing' && store.cropAnchor && store.cropCurrent && store.source) {
      cropDrawRef.current = false
      const anchor = store.cropAnchor
      const current = store.cropCurrent

      const minX = Math.max(0, Math.round(Math.min(anchor.x, current.x)))
      const minY = Math.max(0, Math.round(Math.min(anchor.y, current.y)))
      const maxX = Math.min(store.source.naturalWidthPx, Math.round(Math.max(anchor.x, current.x)))
      const maxY = Math.min(store.source.naturalHeightPx, Math.round(Math.max(anchor.y, current.y)))
      const w = maxX - minX
      const h = maxY - minY

      // Require at least 10×10 px to avoid accidental single-click crops
      if (w >= 10 && h >= 10) {
        store.setCrop({ srcX: minX, srcY: minY, srcW: w, srcH: h })
        store.resetCropDraw()   // clears anchor/current + sets cropMode='idle'
      } else {
        // Too small — clear the drag rect but stay in drawing mode so the user
        // can try again (resetCropDraw would exit crop mode, so do it manually)
        store.setCropAnchor(null)
        store.setCropCurrent(null)
      }
      return
    }

    cropDrawRef.current = false
    dragRef.current = null
  }, [store.cropMode, store.cropAnchor, store.cropCurrent, store.source])

  // Left-click: calibration or measure points (not crop — that's mouse-up)
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    if (!store.source || !previewImg) return

    // Crop drawing consumes all left-button events through mouse-down/up
    if (store.cropMode === 'drawing') return

    const coords = clientToSrcCoords(e.clientX, e.clientY)
    if (!coords) return

    // Measure mode: record points
    if (store.measureMode !== 'idle') {
      if (!store.measurePoint1) {
        store.setMeasurePoint1({ xPx: coords.x, yPx: coords.y })
        store.setMeasureMode('point2')
      } else if (!store.measurePoint2) {
        store.setMeasurePoint2({ xPx: coords.x, yPx: coords.y })
      } else {
        // Both set — restart from this new point
        store.setMeasurePoint1({ xPx: coords.x, yPx: coords.y })
        store.setMeasurePoint2(null)
        store.setMeasureMode('point2')
      }
      return
    }

    // Calibration mode
    if (store.calibrationMode !== 'idle') {
      handleCanvasClick(coords.x, coords.y)
    }
  }, [
    store.cropMode, store.measureMode, store.measurePoint1, store.measurePoint2,
    store.calibrationMode, store.source, previewImg,
    clientToSrcCoords, handleCanvasClick
  ])

  const cursor =
    store.cropMode === 'drawing' || store.measureMode !== 'idle' || store.calibrationMode !== 'idle'
      ? 'crosshair'
      : (dragRef.current ? 'grabbing' : 'grab')

  return (
    <div
      ref={containerRef}
      className="h-full relative overflow-hidden bg-gray-200 dark:bg-gray-900"
    >
      {!store.source && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-gray-400 dark:text-gray-600">
          <div className="text-6xl">🖼️</div>
          <p className="text-lg font-medium">Drop an image or PDF here</p>
          <p className="text-sm">or click Open in the toolbar</p>
        </div>
      )}
      {store.source && !previewImg && !store.isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-600 pointer-events-none">
          <div className="text-4xl">📄</div>
          <p className="text-sm">Preview unavailable — settings and export still work</p>
        </div>
      )}
      {store.cropMode === 'drawing' && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs px-3 py-1 rounded-full shadow pointer-events-none z-10">
          Drag to select crop region • press ✂ again to cancel
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor, display: store.source ? 'block' : 'none' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onContextMenu={e => e.preventDefault()}
      />
      {store.isLoading && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 rounded-lg px-6 py-4 shadow-xl">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{store.loadingMessage || 'Working…'}</p>
          </div>
        </div>
      )}
    </div>
  )
}

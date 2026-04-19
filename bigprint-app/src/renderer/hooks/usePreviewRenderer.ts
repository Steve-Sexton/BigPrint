import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import type { AppState } from '../store/types'
import { computeTileGrid } from '../../shared/TilingCalculator'
import { getPaperSize } from '../../shared/constants'

// The exact subset of AppState that drawPreview reads. Kept as a named type so
// the selector below and the drawPreview parameter stay in sync.
type PreviewSlice = Pick<
  AppState,
  | 'source'
  | 'zoom'
  | 'panX'
  | 'panY'
  | 'tiling'
  | 'scale'
  | 'grid'
  | 'calibrationPoint1'
  | 'calibrationPoint2'
  | 'calibrationMode'
  | 'crop'
  | 'cropAnchor'
  | 'cropCurrent'
  | 'measurePoint1'
  | 'measurePoint2'
  | 'measureMode'
  | 'selectedPages'
  | 'isDarkMode'
>

export function usePreviewRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  previewImg: HTMLImageElement | null,
  resizeTick = 0
) {
  // Shallow-selected slice so unrelated store updates (isLoading, showCalibrationDialog,
  // etc.) do not re-render the host component. useShallow returns a stable reference
  // when each selected field shallow-equals the previous.
  const state = useAppStore(
    useShallow(
      (s): PreviewSlice => ({
        source: s.source,
        zoom: s.zoom,
        panX: s.panX,
        panY: s.panY,
        tiling: s.tiling,
        scale: s.scale,
        grid: s.grid,
        calibrationPoint1: s.calibrationPoint1,
        calibrationPoint2: s.calibrationPoint2,
        calibrationMode: s.calibrationMode,
        crop: s.crop,
        cropAnchor: s.cropAnchor,
        cropCurrent: s.cropCurrent,
        measurePoint1: s.measurePoint1,
        measurePoint2: s.measurePoint2,
        measureMode: s.measureMode,
        selectedPages: s.selectedPages,
        isDarkMode: s.isDarkMode,
      })
    )
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !previewImg || !state.source) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    // Explicit identity reset before scale. Assigning canvas.width already
    // clears context state, but being explicit guards against a future change
    // that skips the size assignment (e.g. bailing out when dimensions match).
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)

    drawPreview(ctx, rect.width, rect.height, previewImg, state)
  }, [
    state.source,
    state.zoom,
    state.panX,
    state.panY,
    state.tiling,
    state.scale,
    state.grid,
    state.calibrationPoint1,
    state.calibrationPoint2,
    state.calibrationMode,
    state.crop,
    state.cropAnchor,
    state.cropCurrent,
    state.measurePoint1,
    state.measurePoint2,
    state.measureMode,
    state.selectedPages,
    previewImg,
    resizeTick,
  ])
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  img: HTMLImageElement,
  state: PreviewSlice
) {
  ctx.clearRect(0, 0, canvasW, canvasH)

  // Checkerboard background (shows transparency)
  const bg1 = state.isDarkMode ? '#2a2a2a' : '#e8e8e8'
  const bg2 = state.isDarkMode ? '#222222' : '#f0f0f0'
  const cSize = 16
  for (let y = 0; y < canvasH; y += cSize) {
    for (let x = 0; x < canvasW; x += cSize) {
      ctx.fillStyle = (Math.floor(x / cSize) + Math.floor(y / cSize)) % 2 === 0 ? bg1 : bg2
      ctx.fillRect(x, y, cSize, cSize)
    }
  }

  ctx.save()
  ctx.translate(state.panX, state.panY)
  ctx.scale(state.zoom, state.zoom)

  // Draw image
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight)

  // ── Committed crop: dim everything outside the crop rect ────────────────
  if (state.crop) {
    const previewScale = img.naturalWidth / (state.source?.naturalWidthPx ?? img.naturalWidth)
    const cx = state.crop.srcX * previewScale
    const cy = state.crop.srcY * previewScale
    const cw = state.crop.srcW * previewScale
    const ch = state.crop.srcH * previewScale
    const imgW = img.naturalWidth
    const imgH = img.naturalHeight

    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    // Top strip
    ctx.fillRect(0, 0, imgW, cy)
    // Bottom strip
    ctx.fillRect(0, cy + ch, imgW, imgH - (cy + ch))
    // Left strip (full height to avoid corner overlap)
    ctx.fillRect(0, cy, cx, ch)
    // Right strip
    ctx.fillRect(cx + cw, cy, imgW - (cx + cw), ch)

    // Crop border highlight
    ctx.strokeStyle = '#FFD700'
    ctx.lineWidth = 1.5 / state.zoom
    ctx.setLineDash([])
    ctx.strokeRect(cx, cy, cw, ch)
    ctx.restore()
  }

  // ── Active crop selection while dragging ─────────────────────────────────
  if (state.cropAnchor && state.cropCurrent) {
    const previewScale = img.naturalWidth / (state.source?.naturalWidthPx ?? img.naturalWidth)
    const ax = state.cropAnchor.x * previewScale
    const ay = state.cropAnchor.y * previewScale
    const bx = state.cropCurrent.x * previewScale
    const by = state.cropCurrent.y * previewScale
    const rx = Math.min(ax, bx)
    const ry = Math.min(ay, by)
    const rw = Math.abs(bx - ax)
    const rh = Math.abs(by - ay)

    ctx.save()
    ctx.fillStyle = 'rgba(255,170,0,0.15)'
    ctx.fillRect(rx, ry, rw, rh)
    ctx.strokeStyle = '#FFAA00'
    ctx.lineWidth = 1.5 / state.zoom
    ctx.setLineDash([6 / state.zoom, 3 / state.zoom])
    ctx.strokeRect(rx, ry, rw, rh)
    ctx.setLineDash([])
    ctx.restore()
  }

  // Compute tile grid — use computeTileGrid (the same function PDFEngine uses)
  // so that rows/cols are always identical to the actual export output.
  // Previously this was computed inline, which silently ignored printerScaleX/Y
  // when counting tiles, causing the preview to show a different grid than
  // what the PDF engine would actually produce after calibration.
  const previewScale = img.naturalWidth / (state.source?.naturalWidthPx ?? img.naturalWidth)
  const paper = getPaperSize(state.tiling.paperSizeId, state.tiling.orientation)
  const mmPerPx = (25.4 / state.scale.dpi) * state.scale.outputScale
  const pxPerMm = 1 / mmPerPx

  const pageWPx = paper.widthMm * pxPerMm * previewScale
  const pageHPx = paper.heightMm * pxPerMm * previewScale
  const strideXPx =
    (paper.widthMm - state.tiling.overlapMmLeft - state.tiling.overlapMmRight) * pxPerMm * previewScale
  const strideYPx =
    (paper.heightMm - state.tiling.overlapMmTop - state.tiling.overlapMmBottom) * pxPerMm * previewScale

  // When a crop is committed, draw the grid over the crop region
  const gridOriginX = state.crop ? state.crop.srcX * previewScale : 0
  const gridOriginY = state.crop ? state.crop.srcY * previewScale : 0

  if (pageWPx <= 0 || pageHPx <= 0 || strideXPx <= 0 || strideYPx <= 0) {
    ctx.restore()
    return
  }

  const imageSrcW = state.crop ? state.crop.srcW : (state.source?.naturalWidthPx ?? img.naturalWidth)
  const imageSrcH = state.crop ? state.crop.srcH : (state.source?.naturalHeightPx ?? img.naturalHeight)
  const { cols, rows } = computeTileGrid({
    imageWidthPx: imageSrcW,
    imageHeightPx: imageSrcH,
    dpi: state.scale.dpi,
    outputScale: state.scale.outputScale,
    printerScaleX: state.scale.printerScaleX,
    printerScaleY: state.scale.printerScaleY,
    paperSizeId: state.tiling.paperSizeId,
    orientation: state.tiling.orientation,
    overlapMmTop: state.tiling.overlapMmTop,
    overlapMmRight: state.tiling.overlapMmRight,
    overlapMmBottom: state.tiling.overlapMmBottom,
    overlapMmLeft: state.tiling.overlapMmLeft,
  })

  // ── Center-image offset in preview pixels (mirrors PDFEngine centering logic) ──
  let cOffXPrev = 0
  let cOffYPrev = 0
  if (state.tiling.centerImage) {
    // imageSrcW/H already declared above for the computeTileGrid call
    const strideXMm = Math.max(paper.widthMm - state.tiling.overlapMmLeft - state.tiling.overlapMmRight, 1)
    const strideYMm = Math.max(paper.heightMm - state.tiling.overlapMmTop - state.tiling.overlapMmBottom, 1)
    const assembledWMm = (cols - 1) * strideXMm + paper.widthMm
    const assembledHMm = (rows - 1) * strideYMm + paper.heightMm
    // Divide by printerScale (mirrors PDFEngine.ts and TilingCalculator.ts) —
    // printerScaleX/Y is a compensation factor (measured ÷ expected); dividing
    // shrinks the logical image size so the centering offset matches what the
    // PDF engine actually renders.
    const imageWMm = (imageSrcW * mmPerPx) / state.scale.printerScaleX
    const imageHMm = (imageSrcH * mmPerPx) / state.scale.printerScaleY
    cOffXPrev = ((assembledWMm - imageWMm) / 2) * pxPerMm * previewScale
    cOffYPrev = ((assembledHMm - imageHMm) / 2) * pxPerMm * previewScale
  }

  const gridSpacingPx = state.grid.diagonalSpacingMm * pxPerMm * previewScale

  // ── Overlap-area shading (drawn below the grid) ──────────────────────────
  if (state.tiling.showOverlapArea) {
    ctx.save()
    ctx.fillStyle = 'rgba(255, 230, 140, 0.25)'
    const oLmm = state.tiling.overlapMmLeft
    const oRmm = state.tiling.overlapMmRight
    const oTmm = state.tiling.overlapMmTop
    const oBmm = state.tiling.overlapMmBottom
    const oLpx = oLmm * pxPerMm * previewScale
    const oRpx = oRmm * pxPerMm * previewScale
    const oTpx = oTmm * pxPerMm * previewScale
    const oBpx = oBmm * pxPerMm * previewScale
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tx = gridOriginX - cOffXPrev + col * strideXPx
        const ty = gridOriginY - cOffYPrev + row * strideYPx
        if (col > 0 && oLpx > 0) ctx.fillRect(tx, ty, oLpx, pageHPx)
        if (col < cols - 1 && oRpx > 0) ctx.fillRect(tx + pageWPx - oRpx, ty, oRpx, pageHPx)
        if (row > 0 && oTpx > 0) ctx.fillRect(tx, ty, pageWPx, oTpx)
        if (row < rows - 1 && oBpx > 0) ctx.fillRect(tx, ty + pageHPx - oBpx, pageWPx, oBpx)
      }
    }
    ctx.restore()
  }

  // The "image rect" in canvas coords for grid clipping: the crop rect when
  // cropped, else the full image at natural size.  Kept axis-aligned so canvas
  // clip is straightforward.
  const imgClipX = state.crop ? state.crop.srcX * previewScale : 0
  const imgClipY = state.crop ? state.crop.srcY * previewScale : 0
  const imgClipW = imageSrcW * previewScale
  const imgClipH = imageSrcH * previewScale
  const needGridClip = !state.grid.extendBeyondImage || state.grid.suppressOverImage

  // Bundle grid + diagonals inside a single graphics state so both obey
  // the same clip region.
  if (state.grid.showGrid || state.grid.showGridDiagonals) {
    ctx.save()
    if (needGridClip) {
      ctx.beginPath()
      if (state.grid.suppressOverImage) {
        // Even-odd: outer (whole drawn canvas region) minus image rect = draw outside only
        const outerX = gridOriginX - cOffXPrev - pageWPx
        const outerY = gridOriginY - cOffYPrev - pageHPx
        const outerW = cols * strideXPx + pageWPx * 2
        const outerH = rows * strideYPx + pageHPx * 2
        ctx.rect(outerX, outerY, outerW, outerH)
        ctx.rect(imgClipX, imgClipY, imgClipW, imgClipH)
        ctx.clip('evenodd')
      } else {
        ctx.rect(imgClipX, imgClipY, imgClipW, imgClipH)
        ctx.clip()
      }
    }
    ctx.strokeStyle = 'rgba(40,40,40,0.65)'
    ctx.lineWidth = 1.0 / state.zoom
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tx = gridOriginX - cOffXPrev + col * strideXPx
        const ty = gridOriginY - cOffYPrev + row * strideYPx
        if (state.grid.showGrid)
          drawHorizontalGridPreview(ctx, tx, ty, pageWPx, pageHPx, gridSpacingPx, state.grid.alignToImage)
        if (state.grid.showGridDiagonals)
          drawDiagonalGridPreview(ctx, tx, ty, pageWPx, pageHPx, gridSpacingPx, state.grid.alignToImage)
      }
    }
    ctx.restore()
  }

  // Draw page boundary lines (red)
  ctx.strokeStyle = '#FF3333'
  ctx.lineWidth = 1.5 / state.zoom
  ctx.setLineDash([])

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = gridOriginX - cOffXPrev + col * strideXPx
      const y = gridOriginY - cOffYPrev + row * strideYPx
      ctx.strokeRect(x, y, pageWPx, pageHPx)
    }
  }

  // ── Dim deselected pages ─────────────────────────────────────────────────
  if (state.selectedPages) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (state.selectedPages[row]?.[col] !== false) continue
        const x = gridOriginX - cOffXPrev + col * strideXPx
        const y = gridOriginY - cOffYPrev + row * strideYPx
        ctx.fillRect(x, y, pageWPx, pageHPx)
      }
    }
  }

  // Draw calibration annotation (solid blue arrow + dimension label)
  if (state.calibrationPoint1) {
    const p1x = state.calibrationPoint1.xPx * previewScale
    const p1y = state.calibrationPoint1.yPx * previewScale
    drawCrosshair(ctx, p1x, p1y, '#2563EB', state.zoom)

    if (state.calibrationPoint2) {
      const p2x = state.calibrationPoint2.xPx * previewScale
      const p2y = state.calibrationPoint2.yPx * previewScale
      drawCrosshair(ctx, p2x, p2y, '#2563EB', state.zoom)

      // Solid blue double-headed arrow
      drawCalibrationArrow(ctx, p1x, p1y, p2x, p2y, state.zoom)

      // Dimension label at midpoint (mm and inches using current scale)
      const dx = (state.calibrationPoint2.xPx - state.calibrationPoint1.xPx) * mmPerPx
      const dy = (state.calibrationPoint2.yPx - state.calibrationPoint1.yPx) * mmPerPx
      const distMm = Math.sqrt(dx * dx + dy * dy)
      const distIn = distMm / 25.4
      const calLabel = `${distMm.toFixed(1)} mm  /  ${distIn.toFixed(3)} in`

      const mx = (p1x + p2x) / 2
      const my = (p1y + p2y) / 2
      ctx.save()
      ctx.scale(1 / state.zoom, 1 / state.zoom)
      const lx = mx * state.zoom
      const ly = my * state.zoom
      const fontSize = 11
      ctx.font = `bold ${fontSize}px sans-serif`
      const tw = ctx.measureText(calLabel).width
      const pad = 4
      ctx.fillStyle = 'rgba(37,99,235,0.90)'
      ctx.beginPath()
      ctx.roundRect(lx - tw / 2 - pad, ly - fontSize / 2 - pad - 14, tw + pad * 2, fontSize + pad * 2, 3)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(calLabel, lx, ly - 14)
      ctx.restore()
    }
  }

  // ── Measure points and line ───────────────────────────────────────────────
  if (state.measurePoint1) {
    drawCrosshair(
      ctx,
      state.measurePoint1.xPx * previewScale,
      state.measurePoint1.yPx * previewScale,
      '#9333EA',
      state.zoom
    )
  }
  if (state.measurePoint2) {
    drawCrosshair(
      ctx,
      state.measurePoint2.xPx * previewScale,
      state.measurePoint2.yPx * previewScale,
      '#9333EA',
      state.zoom
    )
    if (state.measurePoint1) {
      const x1 = state.measurePoint1.xPx * previewScale
      const y1 = state.measurePoint1.yPx * previewScale
      const x2 = state.measurePoint2.xPx * previewScale
      const y2 = state.measurePoint2.yPx * previewScale

      // Line
      ctx.beginPath()
      ctx.strokeStyle = '#9333EA'
      ctx.lineWidth = 1.5 / state.zoom
      ctx.setLineDash([4 / state.zoom, 4 / state.zoom])
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])

      // Distance label at midpoint
      const mx = (x1 + x2) / 2
      const my = (y1 + y2) / 2
      const dx = (state.measurePoint2.xPx - state.measurePoint1.xPx) * mmPerPx
      const dy = (state.measurePoint2.yPx - state.measurePoint1.yPx) * mmPerPx
      const distMm = Math.sqrt(dx * dx + dy * dy)
      const distIn = distMm / 25.4
      const label = `${distMm.toFixed(1)} mm  /  ${distIn.toFixed(3)} in`

      ctx.save()
      ctx.scale(1 / state.zoom, 1 / state.zoom)
      const lx = mx * state.zoom
      const ly = my * state.zoom
      const fontSize = 11
      ctx.font = `bold ${fontSize}px sans-serif`
      const tw = ctx.measureText(label).width
      const pad = 4
      ctx.fillStyle = 'rgba(147,51,234,0.85)'
      ctx.beginPath()
      ctx.roundRect(lx - tw / 2 - pad, ly - fontSize / 2 - pad - 12, tw + pad * 2, fontSize + pad * 2, 3)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, lx, ly - 12)
      ctx.restore()
    }
  }

  ctx.restore()
}

/**
 * Draw horizontal + vertical grid lines for a single tile.
 * When alignToImage=true, lines are phase-locked to the absolute image origin
 * so they run continuously across all tiles.
 */
function drawHorizontalGridPreview(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  w: number,
  h: number,
  spacingPx: number,
  alignToImage: boolean
) {
  if (spacingPx < 2) return

  // Phase offsets ensure lines align to the image origin (0,0) when alignToImage=true.
  // The extra +spacingPx before modulo guards against negative tx/ty (centering offset).
  const phaseX = alignToImage ? (spacingPx - (((tx % spacingPx) + spacingPx) % spacingPx)) % spacingPx : 0
  const phaseY = alignToImage ? (spacingPx - (((ty % spacingPx) + spacingPx) % spacingPx)) % spacingPx : 0

  ctx.beginPath()
  // Horizontal lines
  for (let y = phaseY; y <= h; y += spacingPx) {
    ctx.moveTo(tx, ty + y)
    ctx.lineTo(tx + w, ty + y)
  }
  // Vertical lines
  for (let x = phaseX; x <= w; x += spacingPx) {
    ctx.moveTo(tx + x, ty)
    ctx.lineTo(tx + x, ty + h)
  }
  ctx.stroke()
}

/**
 * Draw the diagonal grid for a single tile in the preview canvas.
 * @param alignToImage when true, the pattern phase is continuous across all tiles
 *                     (anchored to absolute image coords); when false, each tile
 *                     gets its own fresh grid from its local (0,0).
 */
function drawDiagonalGridPreview(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  w: number,
  h: number,
  spacingPx: number,
  alignToImage: boolean
) {
  if (spacingPx < 2) return
  // spacingC is the step size for the line intercept c in y = ±x + c.
  // Setting spacingC = spacingPx guarantees that every diagonal line passes
  // through a corner of the H/V grid (whose lines are also spaced spacingPx
  // apart). Using spacingPx * SQRT2 was the perpendicular distance between
  // lines, which caused diagonals to skip alternating grid corners.
  const spacingC = spacingPx
  const diag = Math.sqrt(w * w + h * h)

  ctx.beginPath()
  for (const slope of [1, -1] as const) {
    // Phase center: when alignToImage, use tile absolute coords so the pattern
    // is seamlessly continuous; when not aligned, start fresh from tile's (0,0).
    const cCenter = alignToImage ? (slope === 1 ? ty - tx : ty + tx) : 0

    const cStart = Math.floor((cCenter - diag * 1.5) / spacingC) * spacingC
    const cEnd = cCenter + diag * 1.5

    for (let c = cStart; c <= cEnd; c += spacingC) {
      if (slope === 1) {
        // alignToImage=true: formula uses tx for y so cCenter=(ty-tx) compensates → passes through (tx,ty).
        // alignToImage=false: cCenter=0, so use ty directly as the y-anchor for the tile origin.
        const y1 = alignToImage ? tx + c : ty + c
        const y2 = alignToImage ? tx + w + c : ty + w + c
        ctx.moveTo(tx, y1)
        ctx.lineTo(tx + w, y2)
      } else {
        const y1 = alignToImage ? -tx + c : ty + c
        const y2 = alignToImage ? -(tx + w) + c : ty - w + c
        ctx.moveTo(tx, y1)
        ctx.lineTo(tx + w, y2)
      }
    }
  }
  ctx.stroke()
}

/**
 * Draw a solid blue double-headed arrow between two canvas points.
 * Used to annotate the calibration baseline on the preview canvas.
 */
function drawCalibrationArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  zoom: number
) {
  const headLen = 12 / zoom
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const revAngle = angle + Math.PI

  ctx.save()
  ctx.strokeStyle = '#2563EB'
  ctx.lineWidth = 2 / zoom
  ctx.setLineDash([])

  ctx.beginPath()
  // Main line
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)

  // Arrowhead at p2 (pointing toward p2)
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))

  // Arrowhead at p1 (pointing toward p1 = reversed direction)
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - headLen * Math.cos(revAngle - Math.PI / 6), y1 - headLen * Math.sin(revAngle - Math.PI / 6))
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - headLen * Math.cos(revAngle + Math.PI / 6), y1 - headLen * Math.sin(revAngle + Math.PI / 6))

  ctx.stroke()
  ctx.restore()
}

function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, zoom: number) {
  const size = 10 / zoom
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5 / zoom
  ctx.beginPath()
  ctx.moveTo(x - size, y)
  ctx.lineTo(x + size, y)
  ctx.moveTo(x, y - size)
  ctx.lineTo(x, y + size)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, size / 2, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

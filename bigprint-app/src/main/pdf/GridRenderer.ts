import { PDFPage, PDFFont, rgb, LineCapStyle } from 'pdf-lib'
import type { GridSettings } from '../../shared/ipc-types'
import type { TileRect } from '../../shared/TilingCalculator'
import { getLabelForTile } from '../../shared/TilingCalculator'

const MM_TO_PT = 2.8346456

export interface GridRenderParams {
  page: PDFPage
  tile: TileRect
  mmPerPx: number
  grid: GridSettings
  paperWidthMm: number
  paperHeightMm: number
  row: number
  col: number
  totalRows: number
  totalCols: number
  labelFont?: PDFFont   // must be embedded in the parent PDFDocument before use
}

export function renderGridOnPage(params: GridRenderParams): void {
  const { grid } = params

  // Horizontal and diagonal grids are independent — either or both may be on
  if (grid.showGrid) renderHorizontalGrid(params)
  if (grid.showGridDiagonals) renderDiagonalGrid(params)

  if (grid.showCutMarks) renderCutMarks(params)
  if (grid.showPageLabels) renderPageLabel(params)
  if (grid.showScaleAnnotation) renderScaleAnnotation(params)
}

function renderDiagonalGrid(params: GridRenderParams): void {
  const { page, tile, mmPerPx, grid, paperWidthMm, paperHeightMm } = params
  const spacingMm = grid.diagonalSpacingMm
  // spacingC is the intercept step in y = ±x + c (image-mm coords).
  // Must equal spacingMm (not spacingMm * SQRT2) so diagonal lines land on
  // every H/V grid corner rather than every other one.
  const spacingC = spacingMm

  const pageWidthPt = paperWidthMm * MM_TO_PT
  const pageHeightPt = paperHeightMm * MM_TO_PT

  // Grid origin: when alignToImage=true the diagonal pattern is continuous across
  // all tiles (aligned to the image coordinate system). When false, each page
  // gets its own fresh grid (aligned to page top-left).
  const tileOriginXMm = grid.alignToImage ? tile.srcX * mmPerPx : 0
  const tileOriginYMm = grid.alignToImage ? tile.srcY * mmPerPx : 0

  const pageDiagonalMm = Math.sqrt(paperWidthMm ** 2 + paperHeightMm ** 2)

  for (const slope of [1, -1] as const) {
    const cCenter = slope === 1
      ? tileOriginYMm - tileOriginXMm
      : tileOriginYMm + tileOriginXMm

    const cMin = cCenter - pageDiagonalMm * 1.5
    const cMax = cCenter + pageDiagonalMm * 1.5
    const startC = Math.ceil(cMin / spacingC) * spacingC

    for (let c = startC; c <= cMax; c += spacingC) {
      const x0mm = tileOriginXMm
      const x1mm = tileOriginXMm + paperWidthMm
      let y0mm: number, y1mm: number

      if (slope === 1) {
        y0mm = x0mm + c
        y1mm = x1mm + c
      } else {
        y0mm = -x0mm + c
        y1mm = -x1mm + c
      }

      // Convert to page-local coordinates
      const localX0 = 0
      const localY0 = y0mm - tileOriginYMm
      const localX1 = paperWidthMm
      const localY1 = y1mm - tileOriginYMm

      // pdf-lib: (0,0) = bottom-left, y increases upward
      const ptX0 = localX0 * MM_TO_PT
      const ptY0 = (paperHeightMm - localY0) * MM_TO_PT
      const ptX1 = localX1 * MM_TO_PT
      const ptY1 = (paperHeightMm - localY1) * MM_TO_PT

      page.drawLine({
        start: { x: ptX0, y: ptY0 },
        end: { x: ptX1, y: ptY1 },
        thickness: 0.4,
        color: rgb(0.25, 0.25, 0.25),
        lineCap: LineCapStyle.Butt,
        opacity: 0.6
      })
    }
  }
}

function renderHorizontalGrid(params: GridRenderParams): void {
  const { page, tile, mmPerPx, grid, paperWidthMm, paperHeightMm } = params
  const spacingMm = grid.diagonalSpacingMm
  const w = paperWidthMm * MM_TO_PT
  const h = paperHeightMm * MM_TO_PT

  // When alignToImage, phase the grid origin so lines are continuous across tiles.
  // tileOriginXMm / tileOriginYMm are the tile's top-left in image-mm coordinates.
  const tileOriginXMm = grid.alignToImage ? tile.srcX * mmPerPx : 0
  const tileOriginYMm = grid.alignToImage ? tile.srcY * mmPerPx : 0

  // First line position (relative to page top-left) that keeps the global grid aligned
  const phaseXmm = ((spacingMm - (tileOriginXMm % spacingMm + spacingMm)) % spacingMm)
  const phaseYmm = ((spacingMm - (tileOriginYMm % spacingMm + spacingMm)) % spacingMm)

  const lineColor = rgb(0.25, 0.25, 0.25)

  // Horizontal lines
  for (let ymm = phaseYmm; ymm <= paperHeightMm; ymm += spacingMm) {
    const y = (paperHeightMm - ymm) * MM_TO_PT
    page.drawLine({ start: { x: 0, y }, end: { x: w, y }, thickness: 0.4, color: lineColor, opacity: 0.6 })
  }
  // Vertical lines
  for (let xmm = phaseXmm; xmm <= paperWidthMm; xmm += spacingMm) {
    const x = xmm * MM_TO_PT
    page.drawLine({ start: { x, y: 0 }, end: { x, y: h }, thickness: 0.4, color: lineColor, opacity: 0.6 })
  }
}

function renderCutMarks(params: GridRenderParams): void {
  const { page, paperWidthMm, paperHeightMm } = params
  const markPt = 5 * MM_TO_PT
  const gapPt = 2 * MM_TO_PT
  const w = paperWidthMm * MM_TO_PT
  const h = paperHeightMm * MM_TO_PT
  const t = 0.5
  const c = rgb(0, 0, 0)

  // Top-left
  page.drawLine({ start: { x: gapPt, y: h }, end: { x: gapPt + markPt, y: h }, thickness: t, color: c })
  page.drawLine({ start: { x: 0, y: h - gapPt }, end: { x: 0, y: h - gapPt - markPt }, thickness: t, color: c })
  // Top-right
  page.drawLine({ start: { x: w - gapPt, y: h }, end: { x: w - gapPt - markPt, y: h }, thickness: t, color: c })
  page.drawLine({ start: { x: w, y: h - gapPt }, end: { x: w, y: h - gapPt - markPt }, thickness: t, color: c })
  // Bottom-left
  page.drawLine({ start: { x: gapPt, y: 0 }, end: { x: gapPt + markPt, y: 0 }, thickness: t, color: c })
  page.drawLine({ start: { x: 0, y: gapPt }, end: { x: 0, y: gapPt + markPt }, thickness: t, color: c })
  // Bottom-right
  page.drawLine({ start: { x: w - gapPt, y: 0 }, end: { x: w - gapPt - markPt, y: 0 }, thickness: t, color: c })
  page.drawLine({ start: { x: w, y: gapPt }, end: { x: w, y: gapPt + markPt }, thickness: t, color: c })
}

function renderPageLabel(params: GridRenderParams): void {
  const { page, row, col, totalRows, totalCols, grid, labelFont } = params
  const label = getLabelForTile(row, col, totalRows, totalCols, grid.labelStyle)
  const marginPt = 3 * MM_TO_PT

  // pdf-lib silently drops drawText when no font is embedded in the document.
  // Always pass the pre-embedded labelFont so the text renders reliably across
  // all PDF viewers and printers.
  page.drawText(label, {
    x: marginPt,
    y: marginPt,
    size: 8,
    color: rgb(0.3, 0.3, 0.3),
    ...(labelFont ? { font: labelFont } : {})
  })
}

/**
 * Draw a small reference scale bar at the bottom-right of each page so the
 * user can verify physical accuracy after printing.  The bar spans exactly
 * one grid-spacing distance (diagonalSpacingMm) and is annotated with that
 * measurement.  This lets the user place a ruler on the printout and confirm
 * the printer-scale calibration is correct.
 */
function renderScaleAnnotation(params: GridRenderParams): void {
  const { page, grid, paperWidthMm, paperHeightMm, labelFont } = params
  const spacingMm = grid.diagonalSpacingMm
  const spacingPt = spacingMm * MM_TO_PT

  // Position: bottom-right corner, with a small margin
  const marginPt = 4 * MM_TO_PT
  const barY = marginPt + 4 * MM_TO_PT
  const barX1 = paperWidthMm * MM_TO_PT - marginPt - spacingPt
  const barX2 = paperWidthMm * MM_TO_PT - marginPt

  // Main bar line
  page.drawLine({
    start: { x: barX1, y: barY },
    end: { x: barX2, y: barY },
    thickness: 0.6,
    color: rgb(0.15, 0.15, 0.15)
  })

  // End ticks
  const tickH = 2 * MM_TO_PT
  for (const x of [barX1, barX2]) {
    page.drawLine({
      start: { x, y: barY - tickH / 2 },
      end: { x, y: barY + tickH / 2 },
      thickness: 0.6,
      color: rgb(0.15, 0.15, 0.15)
    })
  }

  // Label centred above the bar
  const label = `${spacingMm} mm`
  page.drawText(label, {
    x: barX1 + spacingPt / 2 - (label.length * 1.8),   // rough centering
    y: barY + 2 * MM_TO_PT,
    size: 5,
    color: rgb(0.15, 0.15, 0.15),
    ...(labelFont ? { font: labelFont } : {})
  })
}

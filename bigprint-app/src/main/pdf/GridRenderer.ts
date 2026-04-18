import {
  PDFPage,
  PDFFont,
  rgb,
  LineCapStyle,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  clipEvenOdd,
  endPath,
} from 'pdf-lib'
import type { GridSettings } from '../../shared/ipc-types'
import type { TileRect } from '../../shared/TilingCalculator'
import { getLabelForTile } from '../../shared/TilingCalculator'
import { MM_TO_PT } from '../../shared/constants'

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
  labelFont: PDFFont // must be embedded in the parent PDFDocument before use
  /** Image area on this tile in page-mm-from-top-left.  Required when
   *  extendBeyondImage=false or suppressOverImage=true (otherwise ignored). */
  imageRectMm?: { xMm: number; yMm: number; wMm: number; hMm: number }
  /** Overlap margins in mm — used only when showOverlapArea=true. */
  overlapMm?: { top: number; right: number; bottom: number; left: number }
  /** From TilingSettings.showOverlapArea — enables margin-strip shading. */
  showOverlapArea?: boolean
}

export function renderGridOnPage(params: GridRenderParams): void {
  const { grid } = params

  // Overlap shading (below grid lines so the grid remains visible on top).
  if (params.showOverlapArea) renderOverlapShading(params)

  // Horizontal and diagonal grids are independent — either or both may be on.
  // Both honour extendBeyondImage / suppressOverImage via graphics-state clip.
  if (grid.showGrid || grid.showGridDiagonals) {
    const pushedClip = pushGridClip(params)
    if (grid.showGrid) renderHorizontalGrid(params)
    if (grid.showGridDiagonals) renderDiagonalGrid(params)
    if (pushedClip) params.page.pushOperators(popGraphicsState())
  }

  if (grid.showCutMarks) renderCutMarks(params)
  if (grid.showPageLabels) renderPageLabel(params)
  if (grid.showScaleAnnotation) renderScaleAnnotation(params)
}

/**
 * Push a graphics-state clip around the image rect when a relevant flag is set.
 * Returns true when a clip (and matching q) was pushed, so the caller can Q.
 *
 * - extendBeyondImage=false → clip TO the image rect (non-zero winding).
 * - suppressOverImage=true  → clip AROUND the image rect (even-odd, image becomes a hole).
 */
function pushGridClip(params: GridRenderParams): boolean {
  const { page, grid, imageRectMm, paperWidthMm, paperHeightMm } = params
  const clipToImage = !grid.extendBeyondImage
  const clipAwayFromImg = grid.suppressOverImage
  if (!clipToImage && !clipAwayFromImg) return false
  if (!imageRectMm) return false
  // A zero-area image rect means the tile is entirely off-image.
  //  - For clipToImage: nothing should render → push an empty clip.
  //  - For clipAwayFromImg: everything should render → skip the clip.
  if (imageRectMm.wMm <= 0 || imageRectMm.hMm <= 0) {
    if (clipAwayFromImg) return false
    // clipToImage with zero area: push a degenerate clip so nothing draws
    page.pushOperators(pushGraphicsState(), rectangle(0, 0, 0, 0), clip(), endPath())
    return true
  }

  const imgXpt = imageRectMm.xMm * MM_TO_PT
  // pdf-lib origin = bottom-left; we store rects top-left origin, so flip y.
  const imgYpt = (paperHeightMm - imageRectMm.yMm - imageRectMm.hMm) * MM_TO_PT
  const imgWpt = imageRectMm.wMm * MM_TO_PT
  const imgHpt = imageRectMm.hMm * MM_TO_PT

  page.pushOperators(pushGraphicsState())
  if (clipAwayFromImg) {
    // Outer rect + inner rect with even-odd fill rule → image rect is a hole.
    page.pushOperators(
      rectangle(0, 0, paperWidthMm * MM_TO_PT, paperHeightMm * MM_TO_PT),
      rectangle(imgXpt, imgYpt, imgWpt, imgHpt),
      clipEvenOdd(),
      endPath()
    )
  } else {
    page.pushOperators(rectangle(imgXpt, imgYpt, imgWpt, imgHpt), clip(), endPath())
  }
  return true
}

/**
 * Shade the overlap margin strips on this tile so users can see where
 * adjacent tiles meet.  Strips are only drawn on edges that actually have a
 * neighbouring tile (e.g. the leftmost column has no left-overlap).
 */
function renderOverlapShading(params: GridRenderParams): void {
  const { page, paperWidthMm, paperHeightMm, overlapMm, row, col, totalRows, totalCols } = params
  if (!overlapMm) return
  const shade = rgb(1.0, 0.9, 0.55) // soft amber
  const op = 0.25
  const pageWpt = paperWidthMm * MM_TO_PT
  const pageHpt = paperHeightMm * MM_TO_PT

  if (col > 0 && overlapMm.left > 0) {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: overlapMm.left * MM_TO_PT,
      height: pageHpt,
      color: shade,
      opacity: op,
      borderWidth: 0,
    })
  }
  if (col < totalCols - 1 && overlapMm.right > 0) {
    page.drawRectangle({
      x: pageWpt - overlapMm.right * MM_TO_PT,
      y: 0,
      width: overlapMm.right * MM_TO_PT,
      height: pageHpt,
      color: shade,
      opacity: op,
      borderWidth: 0,
    })
  }
  if (row > 0 && overlapMm.top > 0) {
    // In pdf-lib coords the top strip is at the top of the page (high y).
    page.drawRectangle({
      x: 0,
      y: pageHpt - overlapMm.top * MM_TO_PT,
      width: pageWpt,
      height: overlapMm.top * MM_TO_PT,
      color: shade,
      opacity: op,
      borderWidth: 0,
    })
  }
  if (row < totalRows - 1 && overlapMm.bottom > 0) {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageWpt,
      height: overlapMm.bottom * MM_TO_PT,
      color: shade,
      opacity: op,
      borderWidth: 0,
    })
  }
}

function renderDiagonalGrid(params: GridRenderParams): void {
  const { page, tile, mmPerPx, grid, paperWidthMm, paperHeightMm } = params
  const spacingMm = grid.diagonalSpacingMm
  // spacingC is the intercept step in y = ±x + c (image-mm coords).
  // Must equal spacingMm (not spacingMm * SQRT2) so diagonal lines land on
  // every H/V grid corner rather than every other one.
  const spacingC = spacingMm

  // Grid origin: when alignToImage=true the diagonal pattern is continuous across
  // all tiles (aligned to the image coordinate system). When false, each page
  // gets its own fresh grid (aligned to page top-left).
  const tileOriginXMm = grid.alignToImage ? tile.srcX * mmPerPx : 0
  const tileOriginYMm = grid.alignToImage ? tile.srcY * mmPerPx : 0

  const pageDiagonalMm = Math.sqrt(paperWidthMm ** 2 + paperHeightMm ** 2)

  for (const slope of [1, -1] as const) {
    const cCenter = slope === 1 ? tileOriginYMm - tileOriginXMm : tileOriginYMm + tileOriginXMm

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
        opacity: 0.6,
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
  const phaseXmm = (spacingMm - ((tileOriginXMm % spacingMm) + spacingMm)) % spacingMm
  const phaseYmm = (spacingMm - ((tileOriginYMm % spacingMm) + spacingMm)) % spacingMm

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
  page.drawLine({
    start: { x: 0, y: h - gapPt },
    end: { x: 0, y: h - gapPt - markPt },
    thickness: t,
    color: c,
  })
  // Top-right
  page.drawLine({
    start: { x: w - gapPt, y: h },
    end: { x: w - gapPt - markPt, y: h },
    thickness: t,
    color: c,
  })
  page.drawLine({
    start: { x: w, y: h - gapPt },
    end: { x: w, y: h - gapPt - markPt },
    thickness: t,
    color: c,
  })
  // Bottom-left
  page.drawLine({ start: { x: gapPt, y: 0 }, end: { x: gapPt + markPt, y: 0 }, thickness: t, color: c })
  page.drawLine({ start: { x: 0, y: gapPt }, end: { x: 0, y: gapPt + markPt }, thickness: t, color: c })
  // Bottom-right
  page.drawLine({
    start: { x: w - gapPt, y: 0 },
    end: { x: w - gapPt - markPt, y: 0 },
    thickness: t,
    color: c,
  })
  page.drawLine({ start: { x: w, y: gapPt }, end: { x: w, y: gapPt + markPt }, thickness: t, color: c })
}

function renderPageLabel(params: GridRenderParams): void {
  const { page, row, col, totalRows, totalCols, grid, labelFont } = params
  const label = getLabelForTile(row, col, totalRows, totalCols, grid.labelStyle)
  const marginPt = 3 * MM_TO_PT

  // pdf-lib silently drops drawText when no font is embedded in the document.
  // labelFont is required so text renders reliably across all PDF viewers.
  page.drawText(label, {
    x: marginPt,
    y: marginPt,
    size: 8,
    color: rgb(0.3, 0.3, 0.3),
    font: labelFont,
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
  const { page, grid, paperWidthMm, labelFont } = params
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
    color: rgb(0.15, 0.15, 0.15),
  })

  // End ticks
  const tickH = 2 * MM_TO_PT
  for (const x of [barX1, barX2]) {
    page.drawLine({
      start: { x, y: barY - tickH / 2 },
      end: { x, y: barY + tickH / 2 },
      thickness: 0.6,
      color: rgb(0.15, 0.15, 0.15),
    })
  }

  // Label centred above the bar using actual font metrics
  const label = `${spacingMm} mm`
  const size = 5
  const textWidthPt = labelFont.widthOfTextAtSize(label, size)
  page.drawText(label, {
    x: barX1 + spacingPt / 2 - textWidthPt / 2,
    y: barY + 2 * MM_TO_PT,
    size,
    color: rgb(0.15, 0.15, 0.15),
    font: labelFont,
  })
}

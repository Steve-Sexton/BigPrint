import { getPaperSize } from './constants'

export type TileRect = {
  srcX: number
  srcY: number
  srcW: number
  srcH: number
  row: number
  col: number
}

export type TileGridResult = {
  cols: number
  rows: number
  tiles: TileRect[][]
  imageWidthMm: number
  imageHeightMm: number
}

export type TilingCalcParams = {
  imageWidthPx: number
  imageHeightPx: number
  dpi: number
  outputScale: number
  printerScaleX: number
  printerScaleY: number
  paperSizeId: string
  orientation: 'portrait' | 'landscape'
  overlapMmTop: number
  overlapMmRight: number
  overlapMmBottom: number
  overlapMmLeft: number
}

export function computeTileGrid(params: TilingCalcParams): TileGridResult {
  const {
    imageWidthPx,
    imageHeightPx,
    dpi,
    outputScale,
    printerScaleX,
    printerScaleY,
    paperSizeId,
    orientation,
    overlapMmTop,
    overlapMmRight,
    overlapMmBottom,
    overlapMmLeft,
  } = params

  // Image physical dimensions in mm.
  // Divide by printerScale (not multiply) because printerScaleX/Y is a compensation
  // factor: measured ÷ expected × 100.  A printer that stretches 2% gives 1.02;
  // dividing shrinks the tiled content by 2% so after the printer's own stretch
  // it lands at the correct physical size.
  const mmPerPx = (25.4 / dpi) * outputScale
  const imageWidthMm = (imageWidthPx * mmPerPx) / printerScaleX
  const imageHeightMm = (imageHeightPx * mmPerPx) / printerScaleY

  // Paper dimensions
  const paper = getPaperSize(paperSizeId, orientation)
  const { widthMm, heightMm } = paper

  // Stride: how far each subsequent page advances into the image.
  // Subtract the overlap on BOTH opposing edges — tile N's right overlap and
  // tile N+1's left overlap form one shared stitching seam, so both count.
  const strideXMm = widthMm - overlapMmLeft - overlapMmRight
  const strideYMm = heightMm - overlapMmTop - overlapMmBottom

  // Clamp stride to positive value
  const safeStrideX = Math.max(strideXMm, 1)
  const safeStrideY = Math.max(strideYMm, 1)

  // Grid dimensions
  const cols = Math.max(1, Math.ceil((imageWidthMm - widthMm) / safeStrideX) + 1)
  const rows = Math.max(1, Math.ceil((imageHeightMm - heightMm) / safeStrideY) + 1)

  const pxPerMm = 1 / mmPerPx

  const tiles: TileRect[][] = []
  for (let row = 0; row < rows; row++) {
    const tileRow: TileRect[] = []
    for (let col = 0; col < cols; col++) {
      const imageMmX = col * safeStrideX
      const imageMmY = row * safeStrideY

      // Divide tile pixel dimensions and positions by printerScaleX/Y so that
      // each tile embeds fewer source pixels; when the printer stretches by the
      // same factor the output lands at exactly the correct physical dimensions.
      const srcX = Math.max(0, Math.round((imageMmX / printerScaleX) * pxPerMm))
      const srcY = Math.max(0, Math.round((imageMmY / printerScaleY) * pxPerMm))
      const srcW = Math.round((widthMm / printerScaleX) * pxPerMm)
      const srcH = Math.round((heightMm / printerScaleY) * pxPerMm)

      tileRow.push({ srcX, srcY, srcW, srcH, row, col })
    }
    tiles.push(tileRow)
  }

  return { cols, rows, tiles, imageWidthMm, imageHeightMm }
}

/**
 * Given a tile's offset into the image (in source pixels, possibly negative
 * when the tile starts before the image origin) and the source image
 * dimensions, return the rectangle in PAGE-mm coordinates (0,0 = top-left of
 * the page) where the actual image content lives on this tile. Whitespace
 * padding around the image is excluded.
 *
 * Used by:
 *   - GridRenderer (PDF) to clip the grid to / away from the image.
 *   - usePreviewRenderer to shade overlap zones on the preview canvas.
 *
 * For degenerate tiles (srcW/srcH === 0, e.g. the standalone calibration
 * grid), returns the full page so flags behave as no-ops.
 */
export function computeImageRectOnTile(params: {
  tileImageX: number // tile's top-left in src-px coords (can be <0 or ≥imageWidthPx)
  tileImageY: number
  tileSrcW: number
  tileSrcH: number
  imageWidthPx: number
  imageHeightPx: number
  paperWidthMm: number
  paperHeightMm: number
}): { xMm: number; yMm: number; wMm: number; hMm: number } {
  const {
    tileImageX,
    tileImageY,
    tileSrcW,
    tileSrcH,
    imageWidthPx,
    imageHeightPx,
    paperWidthMm,
    paperHeightMm,
  } = params

  if (tileSrcW === 0 || tileSrcH === 0) {
    return { xMm: 0, yMm: 0, wMm: paperWidthMm, hMm: paperHeightMm }
  }

  const padLeft = Math.max(0, -tileImageX)
  const padTop = Math.max(0, -tileImageY)
  const cropLeft = Math.min(Math.max(0, tileImageX), imageWidthPx)
  const cropTop = Math.min(Math.max(0, tileImageY), imageHeightPx)
  const cropW = Math.max(0, Math.min(tileSrcW - padLeft, imageWidthPx - cropLeft))
  const cropH = Math.max(0, Math.min(tileSrcH - padTop, imageHeightPx - cropTop))

  return {
    xMm: (padLeft * paperWidthMm) / tileSrcW,
    yMm: (padTop * paperHeightMm) / tileSrcH,
    wMm: (cropW * paperWidthMm) / tileSrcW,
    hMm: (cropH * paperHeightMm) / tileSrcH,
  }
}

export function getLabelForTile(
  row: number,
  col: number,
  totalRows: number,
  totalCols: number,
  style: 'sequential' | 'grid'
): string {
  if (style === 'grid') {
    // Support unlimited rows: A–Z, then AA, AB, …, AZ, BA, … (like spreadsheet columns)
    let rowLabel = ''
    let r = row
    do {
      rowLabel = String.fromCharCode(65 + (r % 26)) + rowLabel
      r = Math.floor(r / 26) - 1
    } while (r >= 0)
    return `${rowLabel}${col + 1}`
  }
  const pageNum = row * totalCols + col + 1
  const totalPages = totalRows * totalCols
  return `${pageNum} / ${totalPages}`
}

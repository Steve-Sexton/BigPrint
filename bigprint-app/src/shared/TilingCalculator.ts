import { getPaperSize } from './constants'

export type TileRect = {
  srcX: number
  srcY: number
  srcW: number
  srcH: number
  row: number
  col: number
  isBlank: boolean
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
    imageWidthPx, imageHeightPx,
    dpi, outputScale, printerScaleX, printerScaleY,
    paperSizeId, orientation,
    overlapMmTop, overlapMmLeft
  } = params

  // Image physical dimensions in mm.
  // Divide by printerScale (not multiply) because printerScaleX/Y is a compensation
  // factor: measured ÷ expected × 100.  A printer that stretches 2% gives 1.02;
  // dividing shrinks the tiled content by 2% so after the printer's own stretch
  // it lands at the correct physical size.
  const mmPerPx = (25.4 / dpi) * outputScale
  const imageWidthMm = imageWidthPx * mmPerPx / printerScaleX
  const imageHeightMm = imageHeightPx * mmPerPx / printerScaleY

  // Paper dimensions
  const paper = getPaperSize(paperSizeId, orientation)
  const { widthMm, heightMm } = paper

  // Stride: how far each subsequent page advances into the image
  const strideXMm = widthMm - overlapMmLeft
  const strideYMm = heightMm - overlapMmTop

  // Clamp stride to positive value
  const safeStrideX = Math.max(strideXMm, 1)
  const safeStrideY = Math.max(strideYMm, 1)

  // Grid dimensions
  const cols = Math.max(1, Math.ceil((imageWidthMm - widthMm) / safeStrideX) + 1)
  const rows = Math.max(1, Math.ceil((imageHeightMm - heightMm) / safeStrideY) + 1)

  const pxPerMm = 1 / mmPerPx

  const tiles: TileRect[][] = []
  for (let row = 0; row < rows; row++) {
    tiles[row] = []
    for (let col = 0; col < cols; col++) {
      const imageMmX = col * safeStrideX
      const imageMmY = row * safeStrideY

      // Divide tile pixel dimensions and positions by printerScaleX/Y so that
      // each tile embeds fewer source pixels; when the printer stretches by the
      // same factor the output lands at exactly the correct physical dimensions.
      const srcX = Math.max(0, Math.round(imageMmX / printerScaleX * pxPerMm))
      const srcY = Math.max(0, Math.round(imageMmY / printerScaleY * pxPerMm))
      const srcW = Math.round(widthMm / printerScaleX * pxPerMm)
      const srcH = Math.round(heightMm / printerScaleY * pxPerMm)

      const isBlank = srcX >= imageWidthPx || srcY >= imageHeightPx

      tiles[row][col] = { srcX, srcY, srcW, srcH, row, col, isBlank }
    }
  }

  return { cols, rows, tiles, imageWidthMm, imageHeightMm }
}

export function getLabelForTile(row: number, col: number, totalRows: number, totalCols: number, style: 'sequential' | 'grid'): string {
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

import fs from 'fs/promises'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'
import type { ExportPDFParams, ExportResult, TestGridParams } from '../../shared/ipc-types'
import { computeTileGrid, computeImageRectOnTile, type TileRect } from '../../shared/TilingCalculator'
import { getPaperSize, MM_TO_PT, JPEG_TILE_QUALITY } from '../../shared/constants'
import { applyInkSaver } from '../image/InkSaver'
import { renderGridOnPage } from './GridRenderer'

export async function exportToPDF(params: ExportPDFParams): Promise<ExportResult> {
  try {
    const pdfDoc = await PDFDocument.create()
    // Embed Helvetica once per document so every drawText call in this export
    // shares a single font object. pdf-lib otherwise embeds its implicit
    // default on each drawText invocation, which bloats the output PDF and
    // slows export on multi-page tile grids.
    const labelFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const paper = getPaperSize(params.tiling.paperSizeId, params.tiling.orientation)

    // When a pre-rasterised or in-memory buffer is provided, use it directly.
    // Two flows hit this path:
    //   1. PDF source on Windows (Sharp lacks poppler there, so the renderer
    //      rasterises via PDF.js and passes the PNG bytes).
    //   2. Clipboard image (no on-disk path — the raw bytes captured at paste
    //      time are forwarded verbatim so the full-resolution original is
    //      preserved regardless of the preview pipeline).
    // Otherwise fall back to Sharp's native PDF/image file read (available on
    // Linux/macOS with libvips-poppler for PDFs).
    const isPdfSource = params.sourceFile.toLowerCase().endsWith('.pdf')
    const sharpSourceOpts = isPdfSource
      ? { page: params.pdfPageIndex ?? 0, density: Math.round(params.scale.dpi) }
      : {}
    const sharpInput = (): sharp.Sharp =>
      params.sourceBuffer
        ? sharp(Buffer.from(params.sourceBuffer))
        : sharp(params.sourceFile, sharpSourceOpts)

    const meta = await sharpInput().metadata()
    const fullWidthPx = meta.width ?? 0
    const fullHeightPx = meta.height ?? 0

    if (fullWidthPx === 0 || fullHeightPx === 0) {
      return { success: false, errorMessage: 'Could not read image dimensions.' }
    }

    // When a crop is active, tile the cropped region only.
    // The extract coordinates are then offset by the crop origin.
    const cropOffsetX = params.cropRect ? params.cropRect.srcX : 0
    const cropOffsetY = params.cropRect ? params.cropRect.srcY : 0
    const imageWidthPx = params.cropRect ? params.cropRect.srcW : fullWidthPx
    const imageHeightPx = params.cropRect ? params.cropRect.srcH : fullHeightPx

    // Compute tile grid
    const { cols, rows, tiles } = computeTileGrid({
      imageWidthPx,
      imageHeightPx,
      dpi: params.scale.dpi,
      outputScale: params.scale.outputScale,
      printerScaleX: params.scale.printerScaleX,
      printerScaleY: params.scale.printerScaleY,
      paperSizeId: params.tiling.paperSizeId,
      orientation: params.tiling.orientation,
      overlapMmTop: params.tiling.overlapMmTop,
      overlapMmRight: params.tiling.overlapMmRight,
      overlapMmBottom: params.tiling.overlapMmBottom,
      overlapMmLeft: params.tiling.overlapMmLeft,
    })

    const mmPerPx = (25.4 / params.scale.dpi) * params.scale.outputScale
    const pxPerMm = 1 / mmPerPx

    // ── Center image: compute how many pixels of whitespace precede the image ──
    // The assembled grid is (cols-1)*strideX + paperWidth mm wide.  Centering
    // shifts the image rightward/downward so it sits in the middle of that grid.
    let centerOffsetXPx = 0
    let centerOffsetYPx = 0
    if (params.tiling.centerImage) {
      const strideXMm = Math.max(
        paper.widthMm - params.tiling.overlapMmLeft - params.tiling.overlapMmRight,
        1
      )
      const strideYMm = Math.max(
        paper.heightMm - params.tiling.overlapMmTop - params.tiling.overlapMmBottom,
        1
      )
      const assembledWidthMm = (cols - 1) * strideXMm + paper.widthMm
      const assembledHeightMm = (rows - 1) * strideYMm + paper.heightMm
      const imageWidthMm = (imageWidthPx * mmPerPx) / params.scale.printerScaleX
      const imageHeightMm = (imageHeightPx * mmPerPx) / params.scale.printerScaleY
      centerOffsetXPx = Math.round(((assembledWidthMm - imageWidthMm) / 2) * pxPerMm)
      centerOffsetYPx = Math.round(((assembledHeightMm - imageHeightMm) / 2) * pxPerMm)
    }

    let pagesWritten = 0

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = tiles[row]?.[col]
        // computeTileGrid fills every cell, so this is defensive — but under
        // noUncheckedIndexedAccess TS demands the guard, and if a future
        // refactor ever violates the invariant we'd rather skip than crash.
        if (!tile) continue

        if (params.enabledPages && !params.enabledPages[row]?.[col]) continue

        // ── Tile position in source-image pixel space with centering + crop ──
        // Positive tileImageX/Y → reading from inside the image.
        // Negative → the tile starts in whitespace before the image begins.
        const tileImageX = tile.srcX - centerOffsetXPx + cropOffsetX
        const tileImageY = tile.srcY - centerOffsetYPx + cropOffsetY

        // Leading whitespace (when tile starts before the image)
        const padLeft = Math.max(0, -tileImageX)
        const padTop = Math.max(0, -tileImageY)

        // Start coordinates inside the source image (always ≥ 0).
        // Clamp to fullWidthPx / fullHeightPx so that a tile starting exactly at
        // the right/bottom edge produces cropW/cropH = 0 (⇒ isTileBlank),
        // not 1 pixel (which would leak a stripe of the rightmost column into
        // off-image tiles when skipBlankPages is off).
        const cropLeft = Math.min(Math.max(0, tileImageX), fullWidthPx)
        const cropTop = Math.min(Math.max(0, tileImageY), fullHeightPx)

        // How much image content fits in this tile (after leading padding)
        const cropW = Math.min(tile.srcW - padLeft, fullWidthPx - cropLeft)
        const cropH = Math.min(tile.srcH - padTop, fullHeightPx - cropTop)

        // Trailing whitespace (when tile extends beyond the image edge)
        const padRight = Math.max(0, tile.srcW - padLeft - Math.max(0, cropW))
        const padBottom = Math.max(0, tile.srcH - padTop - Math.max(0, cropH))

        // A tile is blank when it contains no image pixels at all
        const isTileBlank = cropW <= 0 || cropH <= 0
        if (isTileBlank && params.tiling.skipBlankPages) continue

        let tileBuffer: Buffer
        if (isTileBlank) {
          // All-white page — generate without touching the source image
          tileBuffer = await sharp({
            create: {
              width: tile.srcW,
              height: tile.srcH,
              channels: 3,
              background: { r: 255, g: 255, b: 255 },
            },
          })
            .jpeg({ quality: JPEG_TILE_QUALITY })
            .toBuffer()
        } else {
          tileBuffer = await sharpInput()
            .extract({ left: cropLeft, top: cropTop, width: Math.max(1, cropW), height: Math.max(1, cropH) })
            .extend({
              top: padTop,
              bottom: padBottom,
              left: padLeft,
              right: padRight,
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .jpeg({ quality: JPEG_TILE_QUALITY })
            .toBuffer()
        }

        // Apply ink saver if enabled
        if (params.inkSaver.enabled) {
          const inkMeta = await sharp(tileBuffer).metadata()
          const tileWidthPx = inkMeta.width ?? tile.srcW
          // The tile image spans paper.widthMm on the final print, so compute
          // the buffer's pixels-per-mm from that — not from scale.dpi which is
          // the *output* DPI in image coordinates, not tile coordinates.
          const tilePxPerMm = tileWidthPx / paper.widthMm
          tileBuffer = await applyInkSaver({
            inputBuffer: tileBuffer,
            widthPx: tileWidthPx,
            heightPx: inkMeta.height ?? tile.srcH,
            pxPerMm: tilePxPerMm,
            settings: params.inkSaver,
          })
        }

        // Add PDF page at exact paper dimensions (in points)
        const pageWidthPt = paper.widthMm * MM_TO_PT
        const pageHeightPt = paper.heightMm * MM_TO_PT
        const pdfPage = pdfDoc.addPage([pageWidthPt, pageHeightPt])

        // Embed image
        let embeddedImage
        if (tileBuffer[0] === 0xff && tileBuffer[1] === 0xd8) {
          embeddedImage = await pdfDoc.embedJpg(tileBuffer)
        } else {
          embeddedImage = await pdfDoc.embedPng(tileBuffer)
        }

        pdfPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: pageWidthPt,
          height: pageHeightPt,
        })

        // Compute the image rect on this tile (used by grid clipping flags).
        // tileImageX/Y can be negative (image starts inside the page) or past
        // the image bounds (fully blank tile) — computeImageRectOnTile handles
        // both and returns a zero-area rect for blank tiles.
        const imageRectMm = computeImageRectOnTile({
          tileImageX,
          tileImageY,
          tileSrcW: tile.srcW,
          tileSrcH: tile.srcH,
          imageWidthPx: fullWidthPx,
          imageHeightPx: fullHeightPx,
          paperWidthMm: paper.widthMm,
          paperHeightMm: paper.heightMm,
        })

        // Render grid / marks / labels as vector PDF content on top
        renderGridOnPage({
          page: pdfPage,
          tile,
          mmPerPx,
          grid: params.grid,
          paperWidthMm: paper.widthMm,
          paperHeightMm: paper.heightMm,
          row,
          col,
          totalRows: rows,
          totalCols: cols,
          labelFont,
          imageRectMm,
          overlapMm: {
            top: params.tiling.overlapMmTop,
            right: params.tiling.overlapMmRight,
            bottom: params.tiling.overlapMmBottom,
            left: params.tiling.overlapMmLeft,
          },
          showOverlapArea: params.tiling.showOverlapArea,
        })

        pagesWritten++
      }
    }

    if (pagesWritten === 0) {
      return { success: false, errorMessage: 'No pages were selected to export.' }
    }

    const pdfBytes = await pdfDoc.save()
    await fs.writeFile(params.outputPath, pdfBytes)

    return { success: true, outputPath: params.outputPath, pagesWritten }
  } catch (err) {
    return { success: false, errorMessage: String(err) }
  }
}

/**
 * Export a calibration test grid — a single white page with only the
 * grid overlay drawn on it. Used by the printer-scale calibration workflow:
 * print this page, measure 10 grid lines with a ruler, then enter the
 * measured distance in the printer-compensation fields.
 */
export async function exportTestGridPDF(params: TestGridParams): Promise<ExportResult> {
  try {
    const pdfDoc = await PDFDocument.create()
    const labelFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const paper = getPaperSize(params.tiling.paperSizeId, params.tiling.orientation)

    const pageWidthPt = paper.widthMm * MM_TO_PT
    const pageHeightPt = paper.heightMm * MM_TO_PT
    const pdfPage = pdfDoc.addPage([pageWidthPt, pageHeightPt])

    // White background
    pdfPage.drawRectangle({ x: 0, y: 0, width: pageWidthPt, height: pageHeightPt, color: rgb(1, 1, 1) })

    // Draw a ruler annotation at the top so the user knows what to measure
    const spacingMm = params.grid.diagonalSpacingMm
    const spacingPt = spacingMm * MM_TO_PT
    const nLines = Math.floor(paper.widthMm / spacingMm)
    const annotY = pageHeightPt - 12 * MM_TO_PT

    pdfPage.drawText(
      `Measure ${nLines} grid spaces (should be ${(nLines * spacingMm).toFixed(0)} mm). ` +
        `Enter: printed mm ÷ ${(nLines * spacingMm).toFixed(0)} mm × 100 = printer scale %`,
      { x: 4 * MM_TO_PT, y: annotY + 3 * MM_TO_PT, size: 5.5, font: labelFont, color: rgb(0.35, 0.35, 0.35) }
    )

    // Render horizontal+vertical grid only (no diagonals) — a square grid is
    // required for accurate ruler measurement on the calibration sheet.
    const gridForTest = { ...params.grid, showGrid: true, showGridDiagonals: false, showPageLabels: false }
    const fakeTile: TileRect = { srcX: 0, srcY: 0, srcW: 0, srcH: 0, row: 0, col: 0 }

    renderGridOnPage({
      page: pdfPage,
      tile: fakeTile,
      mmPerPx: 1, // irrelevant for square grid (no image-origin offset)
      grid: gridForTest,
      paperWidthMm: paper.widthMm,
      paperHeightMm: paper.heightMm,
      row: 0,
      col: 0,
      totalRows: 1,
      totalCols: 1,
      labelFont,
    })

    // Tick marks at top edge so user can count spacings quickly
    for (let i = 0; i <= nLines; i++) {
      const x = i * spacingPt
      const tickH = i % 5 === 0 ? 4 * MM_TO_PT : 2 * MM_TO_PT
      pdfPage.drawLine({
        start: { x, y: pageHeightPt },
        end: { x, y: pageHeightPt - tickH },
        thickness: i % 5 === 0 ? 0.6 : 0.3,
        color: rgb(0.2, 0.2, 0.2),
      })
      if (i % 5 === 0 && i > 0) {
        pdfPage.drawText(`${i * spacingMm}`, {
          x: x - 3,
          y: pageHeightPt - 9 * MM_TO_PT,
          size: 5,
          font: labelFont,
          color: rgb(0.2, 0.2, 0.2),
        })
      }
    }

    const pdfBytes = await pdfDoc.save()
    await fs.writeFile(params.outputPath, pdfBytes)

    return { success: true, outputPath: params.outputPath, pagesWritten: 1 }
  } catch (err) {
    return { success: false, errorMessage: String(err) }
  }
}

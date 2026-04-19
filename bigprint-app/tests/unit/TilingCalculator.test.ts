import { describe, it, expect } from 'vitest'
import { computeTileGrid, computeImageRectOnTile } from '../../src/shared/TilingCalculator'

// Letter portrait: 215.9 × 279.4 mm
const LETTER_PORTRAIT_BASE = {
  paperSizeId: 'letter',
  orientation: 'portrait' as const,
  dpi: 96,
  outputScale: 1,
  printerScaleX: 1,
  printerScaleY: 1,
  overlapMmTop: 0,
  overlapMmRight: 0,
  overlapMmBottom: 0,
  overlapMmLeft: 0
}

describe('computeTileGrid', () => {
  it('computes the expected image physical dimensions at 96 DPI', () => {
    const result = computeTileGrid({
      ...LETTER_PORTRAIT_BASE,
      imageWidthPx: 3000,
      imageHeightPx: 2000
    })
    // 3000 px / 96 DPI * 25.4 mm/in = 793.75 mm
    expect(result.imageWidthMm).toBeCloseTo(793.75, 2)
    expect(result.imageHeightMm).toBeCloseTo(529.17, 2)
  })

  it('counts enough tiles to cover an image larger than one page', () => {
    const result = computeTileGrid({
      ...LETTER_PORTRAIT_BASE,
      imageWidthPx: 3000, // ≈ 793 mm — needs 4 Letter columns (215.9 mm each)
      imageHeightPx: 2000 // ≈ 529 mm — needs 2 Letter rows (279.4 mm each)
    })
    expect(result.cols).toBe(4)
    expect(result.rows).toBe(2)
    expect(result.tiles.length).toBe(2)
    expect(result.tiles[0].length).toBe(4)
  })

  it('honours all four overlap edges in stride (regression for finding 2.1)', () => {
    // Asymmetric: left=0, right=50 should shrink horizontal stride by 50 mm
    const noOverlap = computeTileGrid({
      ...LETTER_PORTRAIT_BASE,
      imageWidthPx: 3000,
      imageHeightPx: 100
    })
    const rightOverlap = computeTileGrid({
      ...LETTER_PORTRAIT_BASE,
      overlapMmRight: 50,
      imageWidthPx: 3000,
      imageHeightPx: 100
    })
    // Fewer mm per stride ⇒ strictly MORE columns needed to cover the same image
    expect(rightOverlap.cols).toBeGreaterThan(noOverlap.cols)
  })

  it('applies printerScaleX as a compensation factor on imageWidthMm', () => {
    const base = computeTileGrid({
      ...LETTER_PORTRAIT_BASE,
      imageWidthPx: 1000,
      imageHeightPx: 1000
    })
    const stretched = computeTileGrid({
      ...LETTER_PORTRAIT_BASE,
      printerScaleX: 1.02,
      imageWidthPx: 1000,
      imageHeightPx: 1000
    })
    // printerScaleX=1.02 means the printer stretches 2% wider than asked, so
    // we feed it a 2% narrower image to compensate.
    expect(stretched.imageWidthMm).toBeCloseTo(base.imageWidthMm / 1.02, 4)
  })

  it('clamps stride to at least 1 mm when overlap exceeds paper size', () => {
    // With overlap larger than paper, stride would otherwise go ≤0 and produce
    // an infinite grid or division artifacts.
    const result = computeTileGrid({
      ...LETTER_PORTRAIT_BASE,
      overlapMmLeft: 500, // way larger than Letter's 215.9 mm width
      imageWidthPx: 1000,
      imageHeightPx: 100
    })
    expect(result.cols).toBeGreaterThan(0)
    expect(Number.isFinite(result.cols)).toBe(true)
  })

  it('returns the full page for a degenerate (srcW=0) tile — calibration-grid path', () => {
    const rect = computeImageRectOnTile({
      tileImageX: 0, tileImageY: 0,
      tileSrcW: 0, tileSrcH: 0,
      imageWidthPx: 100, imageHeightPx: 100,
      paperWidthMm: 215.9, paperHeightMm: 279.4
    })
    expect(rect.xMm).toBe(0)
    expect(rect.yMm).toBe(0)
    expect(rect.wMm).toBe(215.9)
    expect(rect.hMm).toBe(279.4)
  })

  it('returns zero-area rect when tile is fully past the image right edge', () => {
    const rect = computeImageRectOnTile({
      tileImageX: 500, tileImageY: 0,   // image only 100 px wide — tile starts past it
      tileSrcW: 100, tileSrcH: 100,
      imageWidthPx: 100, imageHeightPx: 100,
      paperWidthMm: 100, paperHeightMm: 100
    })
    expect(rect.wMm).toBe(0)
  })

  it('translates leading whitespace padding into image-rect offset (mm)', () => {
    // Tile starts 10 src-px BEFORE the image origin (padLeft=10).
    // tileSrcW=100 → 100 mm wide page. 10 px of padding = 10 mm offset.
    const rect = computeImageRectOnTile({
      tileImageX: -10, tileImageY: 0,
      tileSrcW: 100, tileSrcH: 100,
      imageWidthPx: 1000, imageHeightPx: 1000,
      paperWidthMm: 100, paperHeightMm: 100
    })
    expect(rect.xMm).toBe(10)
    expect(rect.yMm).toBe(0)
    // 90 image px of 100 total → 90 mm wide on the page
    expect(rect.wMm).toBe(90)
  })

  it('symmetric top/bottom overlap affects row count the same way as left/right', () => {
    const topOnly = computeTileGrid({
      ...LETTER_PORTRAIT_BASE,
      overlapMmTop: 50,
      imageWidthPx: 100,
      imageHeightPx: 3000
    })
    const bottomOnly = computeTileGrid({
      ...LETTER_PORTRAIT_BASE,
      overlapMmBottom: 50,
      imageWidthPx: 100,
      imageHeightPx: 3000
    })
    // Both should produce the same row count — the stride formula must be
    // symmetric across opposing edges (regression for finding 2.1).
    expect(topOnly.rows).toBe(bottomOnly.rows)
  })

  it('returns zero-area rect when tile is fully past the image bottom edge', () => {
    const rect = computeImageRectOnTile({
      tileImageX: 0, tileImageY: 500,
      tileSrcW: 100, tileSrcH: 100,
      imageWidthPx: 100, imageHeightPx: 100,
      paperWidthMm: 100, paperHeightMm: 100
    })
    expect(rect.hMm).toBe(0)
  })
})

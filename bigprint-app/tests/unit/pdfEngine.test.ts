import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { exportToPDF } from '../../src/main/pdf/PDFEngine'
import type { ExportPDFParams } from '../../src/shared/ipc-types'

let tmpRoot = ''
let sourcePath = ''

async function writePng(widthPx: number, heightPx: number): Promise<string> {
  const p = path.join(tmpRoot, 'src.png')
  await sharp({
    create: { width: widthPx, height: heightPx, channels: 3, background: { r: 180, g: 50, b: 50 } },
  })
    .png()
    .toBuffer()
    .then(buf => fs.writeFile(p, buf))
  return p
}

function paramsFor(outputPath: string, overrides: Partial<ExportPDFParams> = {}): ExportPDFParams {
  return {
    outputPath,
    sourceFile: sourcePath,
    scale: { dpi: 96, outputScale: 1, printerScaleX: 1, printerScaleY: 1 },
    tiling: {
      paperSizeId: 'letter', orientation: 'portrait',
      overlapMmTop: 0, overlapMmRight: 0, overlapMmBottom: 0, overlapMmLeft: 0,
      showOverlapArea: false, skipBlankPages: false, centerImage: false,
    },
    grid: {
      showGrid: false, showGridDiagonals: false, diagonalSpacingMm: 50,
      showCutMarks: false, showPageLabels: false, labelStyle: 'grid',
      alignToImage: false, extendBeyondImage: true, suppressOverImage: false,
      showScaleAnnotation: false,
    },
    inkSaver: { enabled: false, brightness: 100, gamma: 1, edgeFadeStrength: 0, edgeFadeRadiusMm: 0 },
    enabledPages: null,
    ...overrides,
  }
}

describe('exportToPDF', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bigprint-pdf-'))
    // 3000×2000 at 96 DPI ≈ 794×529 mm → 4×2 Letter grid
    sourcePath = await writePng(3000, 2000)
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('includes every blank tile when skipBlankPages is false', async () => {
    const outPath = path.join(tmpRoot, 'out.pdf')
    const res = await exportToPDF(paramsFor(outPath, {
      tiling: {
        ...paramsFor(outPath).tiling,
        skipBlankPages: false,
      },
    }))
    expect(res.success).toBe(true)
    // 4 cols × 2 rows, no skipping = 8
    expect(res.pagesWritten).toBe(8)
    const bytes = await fs.readFile(outPath)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(8)
  })

  it('honours partial enabledPages selection', async () => {
    const outPath = path.join(tmpRoot, 'out.pdf')
    // 4×2 grid — enable 5 of 8 tiles
    const enabled = [
      [true, false, true, true],
      [false, true, false, true],
    ]
    const res = await exportToPDF(paramsFor(outPath, {
      enabledPages: enabled,
      tiling: { ...paramsFor(outPath).tiling, skipBlankPages: false },
    }))
    expect(res.success).toBe(true)
    expect(res.pagesWritten).toBe(5)
  })

  it('returns an error when no pages would be exported', async () => {
    const outPath = path.join(tmpRoot, 'out.pdf')
    const enabled = [[false, false, false, false], [false, false, false, false]]
    const res = await exportToPDF(paramsFor(outPath, { enabledPages: enabled }))
    expect(res.success).toBe(false)
    expect(res.errorMessage).toMatch(/no pages/i)
  })

  it('centerImage=true produces the same page count as centerImage=false (regression)', async () => {
    // The center-image offset shifts image content rightward/downward within
    // the assembled grid, but must NOT change the number of tiles produced —
    // the grid dimensions are determined by image × printer scale, not by
    // where the image sits on the grid.
    const outPathA = path.join(tmpRoot, 'noncenter.pdf')
    const outPathB = path.join(tmpRoot, 'centered.pdf')
    const baseParams = paramsFor(outPathA, { tiling: { ...paramsFor(outPathA).tiling, skipBlankPages: false } })
    const noCenter = await exportToPDF(baseParams)
    const centered = await exportToPDF({
      ...baseParams,
      outputPath: outPathB,
      tiling: { ...baseParams.tiling, centerImage: true },
    })
    expect(noCenter.success).toBe(true)
    expect(centered.success).toBe(true)
    expect(centered.pagesWritten).toBe(noCenter.pagesWritten)
  })

  it('skipBlankPages=true drops every tile that does not contain image pixels', async () => {
    // Switch to a tiny 200×200 source so only tile [0,0] contains image data.
    // At Letter portrait / 96 DPI the 4×2 grid has 8 total tiles; only the
    // first is non-blank. skipBlankPages should write exactly 1 page.
    sourcePath = await writePng(200, 200)
    const outPath = path.join(tmpRoot, 'out.pdf')
    const res = await exportToPDF(paramsFor(outPath, {
      tiling: { ...paramsFor(outPath).tiling, skipBlankPages: true },
    }))
    expect(res.success).toBe(true)
    expect(res.pagesWritten).toBe(1)
    const bytes = await fs.readFile(outPath)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })
})

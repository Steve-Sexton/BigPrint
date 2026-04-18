import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

// ── Electron mock ──────────────────────────────────────────────────────────
// printDirect instantiates a BrowserWindow and drives webContents.print. The
// stub captures every touch point so tests can assert on lifecycle + print-
// option propagation without an actual Electron runtime.

type PrintCallback = (success: boolean, reason?: string) => void
type PrintOpts = { deviceName?: string; silent?: boolean; printBackground?: boolean }

const printBehaviour = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'fail' | 'throw',
  reason: 'ERR_PRINTER',
}))
const lifecycle = vi.hoisted(() => ({
  loadURLs: [] as string[],
  printedOpts: [] as PrintOpts[],
  closed: 0,
  destroyed: false,
}))

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = {
      loadURL: (u: string) => Promise.resolve(lifecycle.loadURLs.push(u)),
      print: (opts: PrintOpts, cb: PrintCallback) => {
        lifecycle.printedOpts.push(opts)
        if (printBehaviour.mode === 'throw') throw new Error('sync print throw')
        setImmediate(() => {
          if (printBehaviour.mode === 'success') cb(true)
          else cb(false, printBehaviour.reason)
        })
      },
    }
    loadURL = this.webContents.loadURL
    isDestroyed = () => lifecycle.destroyed
    close = () => { lifecycle.closed++ }
    constructor(_opts: unknown) { /* noop */ }
  }
  return { BrowserWindow }
})

// Mock the PDF engine so we don't need to actually generate a PDF.
const exportBehaviour = vi.hoisted(() => ({
  success: true as boolean,
  errorMessage: '',
}))
vi.mock('../../src/main/pdf/PDFEngine', () => ({
  exportToPDF: vi.fn(async () => ({
    success: exportBehaviour.success,
    errorMessage: exportBehaviour.errorMessage || undefined,
    outputPath: '',
  })),
}))

import { printDirect } from '../../src/main/print/PrintManager'
import { BrowserWindow as MockBW } from 'electron'

let tmpFileDir = ''

const PARAMS = {
  sourceFile: 'src.png',
  scale: { dpi: 96, outputScale: 1, printerScaleX: 1, printerScaleY: 1 },
  tiling: {
    paperSizeId: 'letter', orientation: 'portrait' as const,
    overlapMmTop: 0, overlapMmRight: 0, overlapMmBottom: 0, overlapMmLeft: 0,
    showOverlapArea: false, skipBlankPages: false, centerImage: false,
  },
  grid: {
    showGrid: false, showGridDiagonals: false, diagonalSpacingMm: 50,
    showCutMarks: false, showPageLabels: false, labelStyle: 'grid' as const,
    alignToImage: false, extendBeyondImage: true, suppressOverImage: false,
    showScaleAnnotation: false,
  },
  inkSaver: { enabled: false, brightness: 100, gamma: 1, edgeFadeStrength: 0, edgeFadeRadiusMm: 0 },
  enabledPages: null,
}

describe('printDirect', () => {
  beforeEach(async () => {
    tmpFileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigprint-print-'))
    lifecycle.loadURLs = []
    lifecycle.printedOpts = []
    lifecycle.closed = 0
    lifecycle.destroyed = false
    printBehaviour.mode = 'success'
    exportBehaviour.success = true
    exportBehaviour.errorMessage = ''
  })
  afterEach(async () => {
    await fs.rm(tmpFileDir, { recursive: true, force: true })
    // Clean any temp PDFs PrintManager created in os.tmpdir()
    const leftovers = (await fs.readdir(os.tmpdir())).filter(f => f.startsWith('bigprint-tmp-'))
    for (const f of leftovers) await fs.rm(path.join(os.tmpdir(), f), { force: true })
  })

  it('removes the temp PDF and closes the print window on a successful print', async () => {
    const result = await printDirect(new MockBW({}) as unknown as Parameters<typeof printDirect>[0], { ...PARAMS })
    expect(result.success).toBe(true)
    expect(lifecycle.closed).toBeGreaterThan(0)
    // Temp file is bigprint-tmp-<ts>.pdf; PrintManager should have unlinked it.
    const leftovers = (await fs.readdir(os.tmpdir())).filter(f => f.startsWith('bigprint-tmp-'))
    expect(leftovers.length).toBe(0)
  })

  it('surfaces the print driver failure reason and still cleans up', async () => {
    printBehaviour.mode = 'fail'
    printBehaviour.reason = 'ERR_DRIVER_FAULT'
    const result = await printDirect(new MockBW({}) as unknown as Parameters<typeof printDirect>[0], { ...PARAMS })
    expect(result.success).toBe(false)
    // PrintManager wraps thrown errors via String(err) which yields "Error: X"
    // for a thrown Error instance. The reason text must appear somewhere in
    // the message so users can see it.
    expect(result.errorMessage ?? '').toMatch(/ERR_DRIVER_FAULT/)
    expect(lifecycle.closed).toBeGreaterThan(0)
    const leftovers = (await fs.readdir(os.tmpdir())).filter(f => f.startsWith('bigprint-tmp-'))
    expect(leftovers.length).toBe(0)
  })

  it('propagates the export error verbatim and never opens a print window', async () => {
    exportBehaviour.success = false
    exportBehaviour.errorMessage = 'Simulated PDF write failure'
    const result = await printDirect(new MockBW({}) as unknown as Parameters<typeof printDirect>[0], { ...PARAMS })
    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('Simulated PDF write failure')
    expect(lifecycle.loadURLs.length).toBe(0)
    expect(lifecycle.printedOpts.length).toBe(0)
  })

  it('passes the deviceName from PrintParams through to webContents.print', async () => {
    await printDirect(new MockBW({}) as unknown as Parameters<typeof printDirect>[0], {
      ...PARAMS,
      printerName: 'HP LaserJet Pro',
    })
    expect(lifecycle.printedOpts[0]?.deviceName).toBe('HP LaserJet Pro')
  })

  it('uses a file URL (not raw path) when loading the temp PDF', async () => {
    await printDirect(new MockBW({}) as unknown as Parameters<typeof printDirect>[0], { ...PARAMS })
    const url = lifecycle.loadURLs[0] ?? ''
    expect(url.startsWith('file://')).toBe(true)
    // No raw backslashes slipped through (Windows path handling regression guard).
    expect(url.includes('\\')).toBe(false)
  })
})

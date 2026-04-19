import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { PDFDocument } from 'pdf-lib'

// Regression guard for the error-surfacing fix: pdf:getPageCount no longer
// swallows malformed-PDF errors by returning a phantom "1 page" fallback.
// Real encrypted PDFs (loaded with ignoreEncryption:true) still return their
// actual page count — that branch was the original reason for the catch.

const mainFrameSentinel = Symbol('mainFrame') as unknown as object
const registeredHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const fakeWindow = {
  webContents: { mainFrame: mainFrameSentinel },
  isDestroyed: () => false,
}

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, fn)
    },
  },
  BrowserWindow: class {},
  dialog: {
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true }),
    showErrorBox: vi.fn(),
  },
}))

vi.mock('../../src/main/image/ImagePipeline', () => ({
  getImageMeta: vi.fn(),
  getPreviewDataUrl: vi.fn(),
  getSupportedMimeType: () => 'application/pdf',
}))
vi.mock('../../src/main/pdf/PDFEngine', () => ({
  exportToPDF: vi.fn(),
  exportTestGridPDF: vi.fn(),
}))
vi.mock('../../src/main/print/PrintManager', () => ({
  printDirect: vi.fn(),
}))
vi.mock('../../src/main/preferences/PreferencesStore', () => ({
  PreferencesStore: { load: vi.fn(), save: vi.fn() },
}))
vi.mock('../../src/main/project/ProjectFile', () => ({
  saveProject: vi.fn(),
  loadProject: vi.fn(),
}))

import { registerAllHandlers, __resetHandlerStateForTests } from '../../src/main/ipc/handlers'

function ensureRegistered() {
  if (registeredHandlers.size === 0) {
    registerAllHandlers(fakeWindow as unknown as Parameters<typeof registerAllHandlers>[0])
  }
}

const event = { senderFrame: mainFrameSentinel }

let tmpDir = ''

describe('pdf:getPageCount', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigprint-pagecount-'))
    __resetHandlerStateForTests()
    ensureRegistered()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns the actual page count for a well-formed PDF', async () => {
    // Build a 3-page PDF
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    doc.addPage([100, 100])
    doc.addPage([100, 100])
    const pdfPath = path.join(tmpDir, 'three.pdf')
    await fs.writeFile(pdfPath, await doc.save())

    const register = registeredHandlers.get('file:register')!
    const getPageCount = registeredHandlers.get('pdf:getPageCount')!
    await register(event, pdfPath)
    await expect(getPageCount(event, pdfPath)).resolves.toBe(3)
  })

  it('rejects on garbage bytes with a parse-error message (no silent "1 page" fallback)', async () => {
    // An all-zeros file has no %PDF header — pdf-lib will refuse to parse.
    // Pre-fix behavior returned 1; post-fix must raise so the renderer can
    // surface the real cause to the user.
    const badPath = path.join(tmpDir, 'garbage.pdf')
    await fs.writeFile(badPath, Buffer.alloc(256))

    const register = registeredHandlers.get('file:register')!
    const getPageCount = registeredHandlers.get('pdf:getPageCount')!
    await register(event, badPath)
    await expect(getPageCount(event, badPath)).rejects.toThrow(/Could not parse PDF/)
  })
})

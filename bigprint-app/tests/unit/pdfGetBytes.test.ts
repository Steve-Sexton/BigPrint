import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { PDFDocument } from 'pdf-lib'

// Covers three distinct behaviours on the pdf:getBytes channel:
//   1. Rolling-window rate limit — the 21st call inside a 60s window for a
//      single path is rejected; the counter decays so calls succeed again
//      once the window slides past.
//   2. Non-PDF extension rejection — an allowlisted .jpg path cannot be
//      streamed over pdf:getBytes.
//   3. Happy path — an admitted PDF returns its raw bytes copied into a
//      fresh ArrayBuffer that pdf-lib can re-parse.

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
  getSupportedMimeType: (p: string) =>
    p.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
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

async function writeTinyPdf(dir: string, name = 'tiny.pdf'): Promise<string> {
  const doc = await PDFDocument.create()
  doc.addPage([100, 100])
  const bytes = await doc.save()
  const p = path.join(dir, name)
  await fs.writeFile(p, bytes)
  return p
}

const event = { senderFrame: mainFrameSentinel }

let tmpDir = ''

describe('pdf:getBytes', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigprint-getbytes-'))
    __resetHandlerStateForTests()
    ensureRegistered()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('admits a registered PDF and returns its bytes', async () => {
    const p = await writeTinyPdf(tmpDir)
    const register = registeredHandlers.get('file:register')!
    const getBytes = registeredHandlers.get('pdf:getBytes')!

    await register(event, p)
    const result = await getBytes(event, p)
    expect(result).toBeInstanceOf(ArrayBuffer)
    // Round-trip via pdf-lib to confirm the bytes are a valid PDF
    const reparsed = await PDFDocument.load(new Uint8Array(result as ArrayBuffer))
    expect(reparsed.getPageCount()).toBe(1)
  })

  it('rejects a non-PDF extension even if the path is allowlisted', async () => {
    // Register a .jpg (admits it to the allowlist), then call pdf:getBytes.
    // Extension check must reject — pdf:getBytes is a PDF-only channel.
    const jpgPath = path.join(tmpDir, 'not-a-pdf.jpg')
    await fs.writeFile(jpgPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))
    const register = registeredHandlers.get('file:register')!
    const getBytes = registeredHandlers.get('pdf:getBytes')!

    await register(event, jpgPath)
    await expect(getBytes(event, jpgPath)).rejects.toThrow(/rejected non-PDF path/)
  })

  it('rate-limits repeated fetches for the same path within a window', async () => {
    const p = await writeTinyPdf(tmpDir)
    const register = registeredHandlers.get('file:register')!
    const getBytes = registeredHandlers.get('pdf:getBytes')!
    await register(event, p)

    // 20 back-to-back fetches must all succeed under the 20/60s window.
    for (let i = 0; i < 20; i++) {
      const out = await getBytes(event, p)
      expect(out).toBeInstanceOf(ArrayBuffer)
    }
    // The 21st within the same window is the first that trips the guard.
    await expect(getBytes(event, p)).rejects.toThrow(/Too many pdf:getBytes fetches/)
  })
})

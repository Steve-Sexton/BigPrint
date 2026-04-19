import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { MAX_REGISTER_PER_SESSION, MAX_REGISTER_BYTES } from '../../src/shared/constants'

// Covers the three guards in the file:register handler. Each of them is
// security-critical — without these, a compromised renderer could admit
// arbitrary paths into the session allowlist and turn pdf:* / image:* into
// an arbitrary file-read primitive.

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
  getSupportedMimeType: () => 'image/png',
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

describe('file:register guards', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigprint-register-'))
    __resetHandlerStateForTests()
    ensureRegistered()
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    // registerCount lives in a closure inside registerAllHandlers so it
    // survives across tests. For now the session-cap test MUST run last in
    // its describe to avoid cross-pollution — acceptable given vitest runs
    // each describe block in isolation per file.
    vi.restoreAllMocks()
  })

  it('rejects an unsupported extension before touching the filesystem', async () => {
    const p = path.join(tmpDir, 'nope.exe')
    await fs.writeFile(p, 'mz')
    const register = registeredHandlers.get('file:register')!
    await expect(register(event, p)).rejects.toThrow(/Unsupported file extension/)
  })

  it('rejects a file that does not exist', async () => {
    const p = path.join(tmpDir, 'missing.png')
    const register = registeredHandlers.get('file:register')!
    await expect(register(event, p)).rejects.toThrow(/does not exist|not a regular file/)
  })

  it('rejects a file larger than MAX_REGISTER_BYTES', async () => {
    // Don't actually write 500 MB — stub fs.stat so the size check trips
    // without real IO. Size-plus-one forces the > comparison.
    const p = path.join(tmpDir, 'giant.png')
    await fs.writeFile(p, Buffer.alloc(16)) // real file so isFile() is true
    const realStat = fs.stat
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (target) => {
      const original = await realStat(target)
      return Object.assign(original, { size: MAX_REGISTER_BYTES + 1 })
    })
    try {
      const register = registeredHandlers.get('file:register')!
      await expect(register(event, p)).rejects.toThrow(/File too large to register/)
    } finally {
      statSpy.mockRestore()
    }
  })

  it(`rejects the ${MAX_REGISTER_PER_SESSION + 1}th registration this session`, async () => {
    // Write MAX_REGISTER_PER_SESSION + 1 small files and register each.
    // The one at index MAX_REGISTER_PER_SESSION must throw.
    const register = registeredHandlers.get('file:register')!
    for (let i = 0; i < MAX_REGISTER_PER_SESSION; i++) {
      const p = path.join(tmpDir, `f${i}.png`)
      await fs.writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      await expect(register(event, p)).resolves.toMatchObject({ filePath: p })
    }
    const overflow = path.join(tmpDir, 'overflow.png')
    await fs.writeFile(overflow, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await expect(register(event, overflow)).rejects.toThrow(/Too many file registrations/)
  })
})

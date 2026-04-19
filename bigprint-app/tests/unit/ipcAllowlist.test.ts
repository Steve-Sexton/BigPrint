import { describe, it, expect, beforeEach, vi } from 'vitest'
import path from 'path'

// ── Electron mock ──────────────────────────────────────────────────────────
// Exercises the session-scoped read allowlist: image:/pdf: channels must
// reject any absolute path that wasn't admitted through file:open or
// file:register first. Without this defense, a compromised renderer could
// turn IPC into an arbitrary-file-read primitive.

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
  getSupportedMimeType: () => 'application/octet-stream',
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

describe('IPC session read-allowlist', () => {
  beforeEach(() => {
    __resetHandlerStateForTests()
    ensureRegistered()
  })

  const event = { senderFrame: mainFrameSentinel }
  // OS-appropriate absolute path so the earlier isValidFilePath check passes
  // and the allowlist guard is the actual failure point being exercised.
  const unadmittedPath = path.resolve('/tmp/definitely-not-admitted.pdf')

  it('image:getMeta rejects a path that was never admitted', async () => {
    const handler = registeredHandlers.get('image:getMeta')!
    await expect(handler(event, unadmittedPath)).rejects.toThrow(/not in the session allowlist/)
  })

  it('image:getPreview rejects a path that was never admitted', async () => {
    const handler = registeredHandlers.get('image:getPreview')!
    await expect(handler(event, unadmittedPath, 1024)).rejects.toThrow(/not in the session allowlist/)
  })

  it('pdf:renderPage rejects a path that was never admitted', async () => {
    const handler = registeredHandlers.get('pdf:renderPage')!
    await expect(handler(event, unadmittedPath, 0, 1)).rejects.toThrow(/not in the session allowlist/)
  })

  it('pdf:getPageCount rejects a path that was never admitted', async () => {
    const handler = registeredHandlers.get('pdf:getPageCount')!
    await expect(handler(event, unadmittedPath)).rejects.toThrow(/not in the session allowlist/)
  })

  it('pdf:getBytes rejects a path that was never admitted', async () => {
    const handler = registeredHandlers.get('pdf:getBytes')!
    await expect(handler(event, unadmittedPath)).rejects.toThrow(/not in the session allowlist/)
  })
})

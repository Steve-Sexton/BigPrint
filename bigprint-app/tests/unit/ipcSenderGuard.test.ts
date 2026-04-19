import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Electron mock ──────────────────────────────────────────────────────────
// We capture every handler registered via ipcMain.handle so each test can
// invoke it directly with a forged IpcMainInvokeEvent. The window mock exposes
// a stable mainFrame sentinel used by isTrustedSender to compare against
// event.senderFrame.

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

// Block transitive imports that would load heavy native modules.
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

import {
  registerAllHandlers,
  __resetHandlerStateForTests,
} from '../../src/main/ipc/handlers'

// Register once per test run — registerAllHandlers() guards against re-entry.
// We trigger registration lazily on the first test.
function ensureRegistered() {
  if (registeredHandlers.size === 0) {
    registerAllHandlers(fakeWindow as unknown as Parameters<typeof registerAllHandlers>[0])
  }
}

describe('IPC sender-frame guard', () => {
  beforeEach(() => {
    __resetHandlerStateForTests()
    ensureRegistered()
  })

  it('rejects when event.senderFrame is null', async () => {
    const handler = registeredHandlers.get('image:getMeta')!
    const event = { senderFrame: null }
    await expect(handler(event, '/tmp/foo.png')).rejects.toThrow(/Unauthorized IPC sender/)
  })

  it('rejects when event.senderFrame is a different frame than the active window mainFrame', async () => {
    const handler = registeredHandlers.get('image:getMeta')!
    const event = { senderFrame: Symbol('iframe') }
    await expect(handler(event, '/tmp/foo.png')).rejects.toThrow(/Unauthorized IPC sender/)
  })

  it('accepts main-frame senders (does not throw the guard error)', async () => {
    // Using a handler whose next step is assertFilePath so we can distinguish
    // "guard accepted" from "handler validated args". The call should fail at
    // assertFilePath for a non-absolute path, NOT at the guard.
    const handler = registeredHandlers.get('image:getMeta')!
    const event = { senderFrame: mainFrameSentinel }
    await expect(handler(event, 'not-absolute')).rejects.toThrow(/Invalid file path/)
  })
})

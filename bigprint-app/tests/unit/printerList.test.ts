import { describe, it, expect, beforeEach, vi } from 'vitest'

// The print:getPrinters handler returns the default-printer sentinel on
// Electron 28+ where webContents.getPrintersAsync was removed. This test
// registers the handlers against a minimal mock and invokes the channel,
// asserting the exact sentinel shape the renderer's printer dropdown depends on.

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

describe('print:getPrinters', () => {
  beforeEach(() => {
    __resetHandlerStateForTests()
    if (registeredHandlers.size === 0) {
      registerAllHandlers(fakeWindow as unknown as Parameters<typeof registerAllHandlers>[0])
    }
  })

  it('returns the default-printer sentinel array — exactly one entry with empty name', async () => {
    const handler = registeredHandlers.get('print:getPrinters')!
    const result = await handler({ senderFrame: mainFrameSentinel })
    // The renderer's Toolbar uses `deviceName: ''` against this sentinel to
    // drive the OS default printer. Changing the shape breaks the UI silently.
    expect(result).toEqual([{ name: '', displayName: 'System default printer' }])
  })
})

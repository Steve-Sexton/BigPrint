// Type-safe wrappers around window.electronAPI
import type {
  OpenFileResult, ImageMetaResult, ExportPDFParams, ExportResult,
  PrintParams, PrintResult, PrinterInfo,
  SaveProjectParams, LoadProjectResult, TestGridParams, AppPreferences,
  FileFilter
} from '../../shared/ipc-types'

export const bridge = {
  openFile: (): Promise<OpenFileResult | null> =>
    window.electronAPI.openFile(),

  registerFile: (filePath: string): Promise<OpenFileResult> =>
    window.electronAPI.registerFile(filePath),

  getPathForFile: (file: File): string =>
    window.electronAPI.getPathForFile(file),

  saveProject: (data: SaveProjectParams): Promise<boolean> =>
    window.electronAPI.saveProjectDialog(data),

  loadProject: (): Promise<LoadProjectResult | null> =>
    window.electronAPI.loadProjectDialog(),

  getImageMeta: (filePath: string): Promise<ImageMetaResult> =>
    window.electronAPI.getImageMeta(filePath),

  getPreviewDataUrl: (filePath: string, maxSizePx = 2048): Promise<string> =>
    window.electronAPI.getPreviewDataUrl(filePath, maxSizePx),

  renderPDFPage: (filePath: string, pageIndex: number, scale = 1): Promise<string> =>
    window.electronAPI.renderPDFPageDataUrl(filePath, pageIndex, scale),

  getPDFPageCount: (filePath: string): Promise<number> =>
    window.electronAPI.getPDFPageCount(filePath),

  getPDFBytes: (filePath: string): Promise<ArrayBuffer> =>
    window.electronAPI.getPDFBytes(filePath),

  exportPDF: (params: ExportPDFParams): Promise<ExportResult> =>
    window.electronAPI.exportPDF(params),

  exportTestGrid: (params: TestGridParams): Promise<ExportResult> =>
    window.electronAPI.exportTestGrid(params),

  print: (params: PrintParams): Promise<PrintResult> =>
    window.electronAPI.printDirect(params),

  getPrinters: (): Promise<PrinterInfo[]> =>
    window.electronAPI.getSystemPrinters(),

  showSaveDialog: (defaultName: string, filters: FileFilter[]): Promise<string | null> =>
    window.electronAPI.showSaveDialog(defaultName, filters),

  onThemeChange: (cb: (isDark: boolean) => void) =>
    window.electronAPI.onThemeChange(cb),

  loadPreferences: (): Promise<AppPreferences | null> =>
    window.electronAPI.loadPreferences(),

  savePreferences: (prefs: AppPreferences): Promise<void> =>
    window.electronAPI.savePreferences(prefs)
}

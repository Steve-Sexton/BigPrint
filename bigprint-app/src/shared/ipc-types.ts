// Shared IPC type definitions — imported by main, preload, and renderer
// MUST NOT import from 'electron', 'sharp', or any Node.js/browser-only module

export interface ScaleSettings {
  dpi: number
  outputScale: number
  printerScaleX: number
  printerScaleY: number
}

export interface TilingSettings {
  paperSizeId: string
  orientation: 'portrait' | 'landscape'
  overlapMmTop: number
  overlapMmRight: number
  overlapMmBottom: number
  overlapMmLeft: number
  showOverlapArea: boolean
  skipBlankPages: boolean
  centerImage: boolean   // center the image within the assembled page grid
}

export interface GridSettings {
  showGrid: boolean           // draw square (horizontal + vertical) grid lines
  showGridDiagonals: boolean  // draw 45° diagonal alignment lines
  diagonalSpacingMm: number
  showCutMarks: boolean
  showPageLabels: boolean
  labelStyle: 'sequential' | 'grid'
  alignToImage: boolean       // true = grid origin at image top-left; false = page top-left
  extendBeyondImage: boolean  // extend grid into page margins past image edge
  suppressOverImage: boolean  // only draw grid in overlap strips, not over image content
  showScaleAnnotation: boolean // print a reference scale bar on each page
}

export interface InkSaverSettings {
  enabled: boolean
  brightness: number
  gamma: number
  edgeFadeStrength: number
  edgeFadeRadiusMm: number   // physical radius in mm (was px — converted at runtime using calibrated DPI)
}

export interface OpenFileResult {
  filePath: string
  mimeType: string
}

export interface ImageMetaResult {
  widthPx: number
  heightPx: number
  dpiX: number | null
  dpiY: number | null
  format: string
  hasAlpha: boolean
}

// Crop region in source-image pixel coordinates
export interface CropRect {
  srcX: number
  srcY: number
  srcW: number
  srcH: number
}

export interface ExportPDFParams {
  outputPath: string
  sourceFile: string
  scale: ScaleSettings
  tiling: TilingSettings
  grid: GridSettings
  inkSaver: InkSaverSettings
  enabledPages: boolean[][] | null
  pdfPageIndex?: number      // for PDF source files
  sourceBuffer?: ArrayBuffer // pre-rasterized image from renderer (used when Sharp can't read PDFs)
  cropRect?: CropRect        // virtual crop — offsets tile extraction without modifying the file
}

// Standalone test-grid export (no image source — used for printer scale calibration)
export interface TestGridParams {
  outputPath: string
  tiling: TilingSettings
  grid: GridSettings
}

export interface ExportResult {
  success: boolean
  outputPath?: string
  errorMessage?: string
  pagesWritten?: number
}

export interface PrinterInfo {
  name: string
  displayName: string
  isDefault: boolean
}

export interface PrintParams {
  sourceFile: string
  scale: ScaleSettings
  tiling: TilingSettings
  grid: GridSettings
  inkSaver: InkSaverSettings
  enabledPages: boolean[][] | null
  printerName?: string
  pdfPageIndex?: number      // for PDF source files
  sourceBuffer?: ArrayBuffer // pre-rasterized image from renderer
  cropRect?: CropRect        // virtual crop
}

export interface PrintResult {
  success: boolean
  errorMessage?: string
}

export interface PrinterCalibration {
  scaleX: number
  scaleY: number
  updatedAt: string
}

export interface SaveProjectParams {
  filePath: string
  scale: ScaleSettings
  tiling: TilingSettings
  grid: GridSettings
  inkSaver: InkSaverSettings
  lastSourceFile?: string
}

// ── Persisted user preferences ────────────────────────────────────────────────
// Saved to userData/preferences.json between sessions.
// Does NOT include per-image state (dpi, outputScale, crop, selectedPages).
// printerScaleX/Y are included here as "last used" values; per-printer
// corrections are also persisted separately in CalibrationStore.
export interface AppPreferences {
  tiling: TilingSettings
  grid: GridSettings
  inkSaver: InkSaverSettings
  inkSaverPreset: 'light' | 'heavy' | 'custom'
  printerScaleX: number
  printerScaleY: number
}

export interface LoadProjectResult {
  scale: ScaleSettings
  tiling: TilingSettings
  grid: GridSettings
  inkSaver: InkSaverSettings
  lastSourceFile?: string
}

// The API exposed by the preload script to the renderer
export interface ElectronAPI {
  openFile: () => Promise<OpenFileResult | null>
  saveProjectDialog: (data: SaveProjectParams) => Promise<boolean>
  loadProjectDialog: () => Promise<LoadProjectResult | null>
  getImageMeta: (filePath: string) => Promise<ImageMetaResult>
  getPreviewDataUrl: (filePath: string, maxSizePx: number) => Promise<string>
  renderPDFPageDataUrl: (filePath: string, pageIndex: number, scale: number) => Promise<string>
  getPDFPageCount: (filePath: string) => Promise<number>
  getPDFBytes: (filePath: string) => Promise<ArrayBuffer>
  exportPDF: (params: ExportPDFParams) => Promise<ExportResult>
  exportTestGrid: (params: TestGridParams) => Promise<ExportResult>
  printDirect: (params: PrintParams) => Promise<PrintResult>
  getSystemPrinters: () => Promise<PrinterInfo[]>
  saveCalibration: (printerId: string, cal: PrinterCalibration) => Promise<void>
  loadCalibration: (printerId: string) => Promise<PrinterCalibration | null>
  loadPreferences: () => Promise<AppPreferences | null>
  savePreferences: (prefs: AppPreferences) => Promise<void>
  onThemeChange: (cb: (isDark: boolean) => void) => () => void
  showSaveDialog: (defaultName: string, filters: Array<{ name: string; extensions: string[] }>) => Promise<string | null>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

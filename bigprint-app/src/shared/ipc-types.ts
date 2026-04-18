// Shared IPC type definitions — imported by main, preload, and renderer
// MUST NOT import from 'electron', 'sharp', or any Node.js/browser-only module

export interface FileFilter {
  name: string
  extensions: string[]
}

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
  centerImage: boolean // center the image within the assembled page grid
}

export interface GridSettings {
  showGrid: boolean // draw square (horizontal + vertical) grid lines
  showGridDiagonals: boolean // draw 45° diagonal alignment lines
  diagonalSpacingMm: number
  showCutMarks: boolean
  showPageLabels: boolean
  labelStyle: 'sequential' | 'grid'
  alignToImage: boolean // true = grid origin at image top-left; false = page top-left
  extendBeyondImage: boolean // extend grid into page margins past image edge
  suppressOverImage: boolean // only draw grid in overlap strips, not over image content
  showScaleAnnotation: boolean // print a reference scale bar on each page
}

export interface InkSaverSettings {
  enabled: boolean
  brightness: number
  gamma: number
  edgeFadeStrength: number
  edgeFadeRadiusMm: number // physical radius in mm (was px — converted at runtime using calibrated DPI)
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
  pdfPageIndex?: number // for PDF source files
  sourceBuffer?: ArrayBuffer // pre-rasterized image from renderer (used when Sharp can't read PDFs)
  cropRect?: CropRect // virtual crop — offsets tile extraction without modifying the file
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
}

export interface PrintParams {
  sourceFile: string
  scale: ScaleSettings
  tiling: TilingSettings
  grid: GridSettings
  inkSaver: InkSaverSettings
  enabledPages: boolean[][] | null
  printerName?: string
  pdfPageIndex?: number // for PDF source files
  sourceBuffer?: ArrayBuffer // pre-rasterized image from renderer
  cropRect?: CropRect // virtual crop
}

export interface PrintResult {
  success: boolean
  errorMessage?: string
}

export interface SaveProjectParams {
  filePath: string
  scale: ScaleSettings
  tiling: TilingSettings
  grid: GridSettings
  inkSaver: InkSaverSettings
}

// ── Persisted user preferences ────────────────────────────────────────────────
// Saved to userData/preferences.json between sessions.
// Does NOT include per-image state (dpi, outputScale, crop, selectedPages).
// printerScaleX/Y are persisted here as the globally "last used" values.
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
}

// The API exposed by the preload script to the renderer.
// DOM-typed members (accepting `File`, augmenting `Window`) live in the
// renderer-side declaration file so this shared module stays DOM-free and
// safely compiles under tsconfig.node.json.
export interface ElectronAPICore {
  openFile: () => Promise<OpenFileResult | null>
  /** Admits an externally-supplied absolute path (drop / clipboard) to the
   *  session allowlist and returns the same shape as openFile. */
  registerFile: (filePath: string) => Promise<OpenFileResult>
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
  loadPreferences: () => Promise<AppPreferences | null>
  savePreferences: (prefs: AppPreferences) => Promise<void>
  onThemeChange: (cb: (isDark: boolean) => void) => () => void
  showSaveDialog: (defaultName: string, filters: FileFilter[]) => Promise<string | null>
}

// ── Runtime validators (shared between main and renderer) ────────────────────
// These check structural correctness of data that crosses a trust boundary
// (JSON on disk for preferences / projects, IPC-sent payloads).  They return
// a human-readable error string on failure, or null when the value is valid.

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function validateScale(v: unknown): string | null {
  if (!isObject(v)) return 'scale must be an object'
  if (!isNumber(v['dpi']) || v['dpi'] < 1 || v['dpi'] > 9600)
    return `Invalid scale.dpi (${v['dpi']}) — must be 1–9600`
  if (!isNumber(v['outputScale']) || v['outputScale'] <= 0 || v['outputScale'] > 10)
    return `Invalid scale.outputScale (${v['outputScale']}) — must be > 0 and ≤ 10`
  if (!isNumber(v['printerScaleX']) || v['printerScaleX'] <= 0) return 'Invalid scale.printerScaleX'
  if (!isNumber(v['printerScaleY']) || v['printerScaleY'] <= 0) return 'Invalid scale.printerScaleY'
  return null
}

export function validateTiling(v: unknown): string | null {
  if (!isObject(v)) return 'tiling must be an object'
  if (typeof v['paperSizeId'] !== 'string' || !v['paperSizeId']) return 'Missing tiling.paperSizeId'
  if (v['orientation'] !== 'portrait' && v['orientation'] !== 'landscape') return 'Invalid tiling.orientation'
  for (const edge of ['overlapMmTop', 'overlapMmRight', 'overlapMmBottom', 'overlapMmLeft'] as const) {
    if (!isNumber(v[edge]) || (v[edge] as number) < 0) return `Invalid tiling.${edge}`
  }
  if (typeof v['showOverlapArea'] !== 'boolean') return 'Invalid tiling.showOverlapArea'
  if (typeof v['skipBlankPages'] !== 'boolean') return 'Invalid tiling.skipBlankPages'
  if (typeof v['centerImage'] !== 'boolean') return 'Invalid tiling.centerImage'
  return null
}

export function validateGrid(v: unknown): string | null {
  if (!isObject(v)) return 'grid must be an object'
  for (const bk of [
    'showGrid',
    'showGridDiagonals',
    'showCutMarks',
    'showPageLabels',
    'alignToImage',
    'extendBeyondImage',
    'suppressOverImage',
    'showScaleAnnotation',
  ] as const) {
    if (typeof v[bk] !== 'boolean') return `Invalid grid.${bk}`
  }
  if (!isNumber(v['diagonalSpacingMm']) || (v['diagonalSpacingMm'] as number) <= 0)
    return 'Invalid grid.diagonalSpacingMm'
  if (v['labelStyle'] !== 'sequential' && v['labelStyle'] !== 'grid') return 'Invalid grid.labelStyle'
  return null
}

export function validateInkSaver(v: unknown): string | null {
  if (!isObject(v)) return 'inkSaver must be an object'
  if (typeof v['enabled'] !== 'boolean') return 'Invalid inkSaver.enabled'
  for (const nk of ['brightness', 'gamma', 'edgeFadeStrength', 'edgeFadeRadiusMm'] as const) {
    if (!isNumber(v[nk])) return `Invalid inkSaver.${nk}`
  }
  return null
}

export function validateAppPreferences(data: unknown): string | null {
  if (!isObject(data)) return 'Not a JSON object'
  const t = validateTiling(data['tiling'])
  if (t) return t
  const g = validateGrid(data['grid'])
  if (g) return g
  const i = validateInkSaver(data['inkSaver'])
  if (i) return i
  if (
    data['inkSaverPreset'] !== 'light' &&
    data['inkSaverPreset'] !== 'heavy' &&
    data['inkSaverPreset'] !== 'custom'
  )
    return 'Invalid inkSaverPreset'
  if (!isNumber(data['printerScaleX']) || (data['printerScaleX'] as number) <= 0)
    return 'Invalid printerScaleX'
  if (!isNumber(data['printerScaleY']) || (data['printerScaleY'] as number) <= 0)
    return 'Invalid printerScaleY'
  return null
}

// Validates ExportPDFParams / PrintParams / TestGridParams outputPath + nested
// settings blocks before they are used by the main process. outputPath may be
// empty — in that case the handler opens a save dialog.
export function validateExportParams(v: unknown, requireOutputPath = false): string | null {
  if (!isObject(v)) return 'params must be an object'
  if (requireOutputPath || v['outputPath']) {
    if (typeof v['outputPath'] !== 'string' || v['outputPath'].includes('\0')) return 'Invalid outputPath'
  }
  const s = validateScale(v['scale'])
  if (s) return s
  const t = validateTiling(v['tiling'])
  if (t) return t
  const g = validateGrid(v['grid'])
  if (g) return g
  const i = validateInkSaver(v['inkSaver'])
  if (i) return i
  return null
}

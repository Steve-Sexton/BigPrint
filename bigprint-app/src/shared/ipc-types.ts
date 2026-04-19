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

// Discriminated result for project:save. Distinguishes cancel (user pressed
// Cancel in the save dialog — silent) from error (path invalid, EACCES, disk
// full — the UI should surface this) from success (show the written path).
export type SaveProjectResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'cancel' }
  | { ok: false; reason: 'error'; errorMessage: string }

// ── Persisted user preferences ────────────────────────────────────────────────
// Saved to userData/preferences.json between sessions.
// Does NOT include per-image state (dpi, outputScale, crop, selectedPages).
//
// Note on printerScaleX/Y: these live in TWO places at runtime.
//   1. AppPreferences (here) — the persisted "last used" baseline, reloaded on
//      app start and written back on debounced save.
//   2. AppState.scale.printerScaleX/Y (per-image) — edited in the UI; may be
//      temporarily swapped by an orientation flip (see TilingSettings.tsx) and
//      only written back to preferences at app-wide debounce time, not on
//      every edit. A per-image experiment therefore does not pollute the
//      persisted default until the user settles.
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
  saveProjectDialog: (data: SaveProjectParams) => Promise<SaveProjectResult>
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

// Safety bounds on printer-scale compensation. The UI clamps to 90–110%; the
// validator is deliberately wider (50–200%) to cover even an exotic printer
// without letting a crafted .tilr or corrupt preferences file push the value
// to ~0 (which would make imageWidthMm ≈ imageWidthPx / 0 → ~Infinity and
// blow up computeTileGrid with a billion tiles) or ~huge.
export const PRINTER_SCALE_MIN = 0.5
export const PRINTER_SCALE_MAX = 2.0

export function validateScale(v: unknown): string | null {
  if (!isObject(v)) return 'scale must be an object'
  if (!isNumber(v['dpi']) || v['dpi'] < 1 || v['dpi'] > 9600)
    return `Invalid scale.dpi (${v['dpi']}) — must be 1–9600`
  if (!isNumber(v['outputScale']) || v['outputScale'] <= 0 || v['outputScale'] > 10)
    return `Invalid scale.outputScale (${v['outputScale']}) — must be > 0 and ≤ 10`
  if (
    !isNumber(v['printerScaleX']) ||
    (v['printerScaleX'] as number) < PRINTER_SCALE_MIN ||
    (v['printerScaleX'] as number) > PRINTER_SCALE_MAX
  )
    return `Invalid scale.printerScaleX — must be in [${PRINTER_SCALE_MIN}, ${PRINTER_SCALE_MAX}]`
  if (
    !isNumber(v['printerScaleY']) ||
    (v['printerScaleY'] as number) < PRINTER_SCALE_MIN ||
    (v['printerScaleY'] as number) > PRINTER_SCALE_MAX
  )
    return `Invalid scale.printerScaleY — must be in [${PRINTER_SCALE_MIN}, ${PRINTER_SCALE_MAX}]`
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
  // Bounds mirror the UI sliders in InkSaverSettings.tsx so a malicious or
  // corrupt project / preference file cannot push extreme values into Sharp
  // (which rejects/NaNs them) or produce non-printable output.
  const bounds = {
    brightness: [10, 200],
    gamma: [1, 3],
    edgeFadeStrength: [0, 100],
    edgeFadeRadiusMm: [0.5, 20],
  } as const
  for (const nk of ['brightness', 'gamma', 'edgeFadeStrength', 'edgeFadeRadiusMm'] as const) {
    const n = v[nk]
    if (!isNumber(n)) return `Invalid inkSaver.${nk}`
    const [lo, hi] = bounds[nk]
    if (n < lo || n > hi) return `Invalid inkSaver.${nk} (${n}) — must be in [${lo}, ${hi}]`
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
  if (
    !isNumber(data['printerScaleX']) ||
    (data['printerScaleX'] as number) < PRINTER_SCALE_MIN ||
    (data['printerScaleX'] as number) > PRINTER_SCALE_MAX
  )
    return `Invalid printerScaleX — must be in [${PRINTER_SCALE_MIN}, ${PRINTER_SCALE_MAX}]`
  if (
    !isNumber(data['printerScaleY']) ||
    (data['printerScaleY'] as number) < PRINTER_SCALE_MIN ||
    (data['printerScaleY'] as number) > PRINTER_SCALE_MAX
  )
    return `Invalid printerScaleY — must be in [${PRINTER_SCALE_MIN}, ${PRINTER_SCALE_MAX}]`
  return null
}

export function validateFileFilters(v: unknown): string | null {
  if (!Array.isArray(v)) return 'filters must be an array'
  for (let i = 0; i < v.length; i++) {
    const f = v[i]
    if (!isObject(f)) return `filters[${i}] must be an object`
    if (typeof f['name'] !== 'string' || !f['name']) return `filters[${i}].name must be a non-empty string`
    if (!Array.isArray(f['extensions'])) return `filters[${i}].extensions must be an array`
    for (let j = 0; j < (f['extensions'] as unknown[]).length; j++) {
      const ext = (f['extensions'] as unknown[])[j]
      if (typeof ext !== 'string') return `filters[${i}].extensions[${j}] must be a string`
    }
  }
  return null
}

// Maximum pixel dimensions accepted on a cropRect. Mirrors MAX_SOURCE_IMAGE_PX
// in shared/constants.ts without the import cycle — keep the two in sync if
// the source-image ceiling ever changes.
const MAX_CROP_DIMENSION_PX = 20000

// Maximum byte size accepted on an inline sourceBuffer (PDF-on-Windows
// rasterisation and clipboard images). Mirrors MAX_REGISTER_BYTES.
const MAX_SOURCE_BUFFER_BYTES = 500 * 1024 * 1024

export function validateEnabledPages(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (!Array.isArray(v)) return 'enabledPages must be an array or null'
  // Every row must itself be an array of booleans. Jagged rows are rejected
  // so PDFEngine's row/col iteration doesn't have to defend against non-array
  // rows or non-boolean cells at runtime.
  const firstLen = Array.isArray(v[0]) ? (v[0] as unknown[]).length : null
  for (let r = 0; r < v.length; r++) {
    const row = v[r]
    if (!Array.isArray(row)) return `enabledPages[${r}] must be an array`
    if (firstLen !== null && row.length !== firstLen)
      return `enabledPages[${r}] length ${row.length} differs from row 0 (${firstLen})`
    for (let c = 0; c < row.length; c++) {
      if (typeof row[c] !== 'boolean') return `enabledPages[${r}][${c}] must be a boolean`
    }
  }
  return null
}

export function validateCropRect(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (!isObject(v)) return 'cropRect must be an object'
  for (const k of ['srcX', 'srcY', 'srcW', 'srcH'] as const) {
    const n = v[k]
    if (!isNumber(n) || n < 0 || n > MAX_CROP_DIMENSION_PX)
      return `Invalid cropRect.${k} — must be in [0, ${MAX_CROP_DIMENSION_PX}]`
  }
  const srcW = v['srcW'] as number
  const srcH = v['srcH'] as number
  if (srcW <= 0 || srcH <= 0) return 'cropRect.srcW/srcH must be > 0'
  return null
}

export function validateSourceBuffer(v: unknown): string | null {
  if (v === null || v === undefined) return null
  // Accept only an ArrayBuffer — not a SharedArrayBuffer, not a TypedArray,
  // not a Node Buffer. Structured-clone across the context bridge produces a
  // plain ArrayBuffer, so anything else crossing the IPC boundary is anomalous.
  if (!(v instanceof ArrayBuffer)) return 'sourceBuffer must be an ArrayBuffer'
  if (v.byteLength === 0) return 'sourceBuffer must not be empty'
  if (v.byteLength > MAX_SOURCE_BUFFER_BYTES)
    return `sourceBuffer too large (${v.byteLength} bytes, max ${MAX_SOURCE_BUFFER_BYTES})`
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
  const e = validateEnabledPages(v['enabledPages'])
  if (e) return e
  const cr = validateCropRect(v['cropRect'])
  if (cr) return cr
  const sb = validateSourceBuffer(v['sourceBuffer'])
  if (sb) return sb
  if (v['pdfPageIndex'] !== undefined) {
    if (!isNumber(v['pdfPageIndex']) || (v['pdfPageIndex'] as number) < 0 || (v['pdfPageIndex'] as number) > 100000)
      return 'Invalid pdfPageIndex'
  }
  return null
}

import type { ScaleSettings, TilingSettings, GridSettings, InkSaverSettings, CropRect } from '../../shared/ipc-types'

export type { ScaleSettings, TilingSettings, GridSettings, InkSaverSettings, CropRect }

export interface ImageSource {
  filePath: string
  mimeType: string
  naturalWidthPx: number
  naturalHeightPx: number
  previewDataUrl: string
  pdfPageIndex: number
  pdfTotalPages: number
  /**
   * Raw image bytes captured at paste time for clipboard sources
   * (filePath === '<clipboard>').  Stored separately from previewDataUrl so
   * that export always uses the original full-resolution data regardless of
   * any future changes to how the canvas preview is generated or scaled.
   * Undefined for all non-clipboard sources.
   */
  clipboardBuffer?: ArrayBuffer
}

export interface AppState {
  source: ImageSource | null
  scale: ScaleSettings
  tiling: TilingSettings
  grid: GridSettings
  inkSaver: InkSaverSettings
  // UI state
  zoom: number
  panX: number
  panY: number
  isDarkMode: boolean
  isLoading: boolean
  loadingMessage: string
  // Calibration
  calibrationMode: 'idle' | 'point1' | 'point2'
  calibrationPoint1: { xPx: number; yPx: number } | null
  calibrationPoint2: { xPx: number; yPx: number } | null
  showCalibrationDialog: boolean
  // Crop
  crop: CropRect | null            // committed crop (null = full image)
  cropMode: 'idle' | 'drawing'    // active selection drag in progress
  cropAnchor: { xPx: number; yPx: number } | null   // first drag corner
  cropCurrent: { xPx: number; yPx: number } | null  // live drag corner
  // Measurement
  measureMode: 'idle' | 'point1' | 'point2'
  measurePoint1: { xPx: number; yPx: number } | null
  measurePoint2: { xPx: number; yPx: number } | null
  // Ink saver
  inkSaverPreset: 'light' | 'heavy' | 'custom'  // which ink-saver mode is active
  // Page selection: null = all enabled; boolean[row][col] = per-tile override
  selectedPages: boolean[][] | null
}

export interface AppActions {
  setSource: (source: ImageSource | null) => void
  setScale: (s: Partial<ScaleSettings>) => void
  setTiling: (t: Partial<TilingSettings>) => void
  setGrid: (g: Partial<GridSettings>) => void
  setInkSaver: (i: Partial<InkSaverSettings>) => void
  setZoom: (z: number) => void
  setPan: (x: number, y: number) => void
  setDarkMode: (dark: boolean) => void
  setLoading: (loading: boolean, message?: string) => void
  // Calibration
  setCalibrationMode: (mode: AppState['calibrationMode']) => void
  setCalibrationPoint1: (pt: { xPx: number; yPx: number } | null) => void
  setCalibrationPoint2: (pt: { xPx: number; yPx: number } | null) => void
  setShowCalibrationDialog: (show: boolean) => void
  resetCalibration: () => void
  // Crop
  setCrop: (r: CropRect | null) => void
  setCropMode: (m: AppState['cropMode']) => void
  setCropAnchor: (pt: AppState['cropAnchor']) => void
  setCropCurrent: (pt: AppState['cropCurrent']) => void
  resetCropDraw: () => void
  // Measurement
  setMeasureMode: (m: AppState['measureMode']) => void
  setMeasurePoint1: (pt: AppState['measurePoint1']) => void
  setMeasurePoint2: (pt: AppState['measurePoint2']) => void
  resetMeasure: () => void
  // Ink saver mode
  setInkSaverPreset: (preset: AppState['inkSaverPreset']) => void
  // Page selection
  setSelectedPages: (pages: boolean[][] | null) => void
  toggleSelectedPage: (row: number, col: number, totalRows: number, totalCols: number) => void
}

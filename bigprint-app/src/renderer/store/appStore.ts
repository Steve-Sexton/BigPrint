import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { AppState, AppActions } from './types'

// "Lighten areas" — mild ink reduction, preserves most colour
export const INK_SAVER_LIGHT_PRESET = {
  enabled: true,
  brightness: 130,
  gamma: 1.5,
  edgeFadeStrength: 25,
  edgeFadeRadiusMm: 1.5,
}

// "Lighten more" — heavy ink reduction (original "Auto" preset)
export const INK_SAVER_HEAVY_PRESET = {
  enabled: true,
  brightness: 160,
  gamma: 2.2,
  edgeFadeStrength: 55,
  edgeFadeRadiusMm: 2, // 2mm ≈ 24px at 300dpi, ~8px at 96dpi
}

const DEFAULT_STATE: AppState = {
  source: null,
  scale: {
    dpi: 96,
    outputScale: 1.0,
    printerScaleX: 1.0,
    printerScaleY: 1.0,
  },
  tiling: {
    paperSizeId: 'letter',
    orientation: 'portrait',
    overlapMmTop: 10,
    overlapMmRight: 10,
    overlapMmBottom: 10,
    overlapMmLeft: 10,
    showOverlapArea: true,
    skipBlankPages: true,
    centerImage: false,
  },
  grid: {
    showGrid: true, // ← default: both grid + diagonals on (matches original BigPrint)
    showGridDiagonals: true,
    diagonalSpacingMm: 50, // ← default 50 mm ≈ original's 5.00 cm
    showCutMarks: true,
    showPageLabels: true,
    labelStyle: 'grid',
    alignToImage: true,
    extendBeyondImage: true, // ← original default is checked
    suppressOverImage: false,
    showScaleAnnotation: false,
  },
  inkSaver: {
    enabled: false,
    brightness: 100,
    gamma: 1.8, // > 1.0 lightens midtones, preserves pure black
    edgeFadeStrength: 0,
    edgeFadeRadiusMm: 2,
  },
  inkSaverPreset: 'heavy' as const,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  isDarkMode: false,
  isLoading: false,
  loadingMessage: '',
  calibrationMode: 'idle',
  calibrationPoint1: null,
  calibrationPoint2: null,
  showCalibrationDialog: false,
  crop: null,
  cropMode: 'idle',
  cropAnchor: null,
  cropCurrent: null,
  measureMode: 'idle',
  measurePoint1: null,
  measurePoint2: null,
  selectedPages: null,
}

export const useAppStore = create<AppState & AppActions>()(
  immer(set => ({
    ...DEFAULT_STATE,

    setSource: source =>
      set(s => {
        s.source = source
        // Clear crop and page selection when a new image is loaded
        s.crop = null
        s.cropMode = 'idle'
        s.cropAnchor = null
        s.cropCurrent = null
        s.selectedPages = null
      }),
    setScale: scale =>
      set(s => {
        Object.assign(s.scale, scale)
      }),
    setTiling: tiling =>
      set(s => {
        Object.assign(s.tiling, tiling)
      }),
    setGrid: grid =>
      set(s => {
        Object.assign(s.grid, grid)
      }),
    setInkSaver: inkSaver =>
      set(s => {
        Object.assign(s.inkSaver, inkSaver)
      }),
    setZoom: z =>
      set(s => {
        s.zoom = Math.max(0.05, Math.min(20, z))
      }),
    setPan: (x, y) =>
      set(s => {
        s.panX = x
        s.panY = y
      }),
    setDarkMode: dark =>
      set(s => {
        s.isDarkMode = dark
      }),
    setLoading: (loading, message = '') =>
      set(s => {
        s.isLoading = loading
        s.loadingMessage = message
      }),

    // Calibration
    setCalibrationMode: mode =>
      set(s => {
        s.calibrationMode = mode
      }),
    setCalibrationPoint1: pt =>
      set(s => {
        s.calibrationPoint1 = pt
      }),
    setCalibrationPoint2: pt =>
      set(s => {
        s.calibrationPoint2 = pt
      }),
    setShowCalibrationDialog: show =>
      set(s => {
        s.showCalibrationDialog = show
      }),
    resetCalibration: () =>
      set(s => {
        s.calibrationMode = 'idle'
        s.calibrationPoint1 = null
        s.calibrationPoint2 = null
        s.showCalibrationDialog = false
      }),

    // Crop
    setCrop: r =>
      set(s => {
        s.crop = r
      }),
    setCropMode: m =>
      set(s => {
        s.cropMode = m
      }),
    setCropAnchor: pt =>
      set(s => {
        s.cropAnchor = pt
      }),
    setCropCurrent: pt =>
      set(s => {
        s.cropCurrent = pt
      }),
    resetCropDraw: () =>
      set(s => {
        s.cropMode = 'idle'
        s.cropAnchor = null
        s.cropCurrent = null
      }),

    // Measurement
    setMeasureMode: m =>
      set(s => {
        s.measureMode = m
      }),
    setMeasurePoint1: pt =>
      set(s => {
        s.measurePoint1 = pt
      }),
    setMeasurePoint2: pt =>
      set(s => {
        s.measurePoint2 = pt
      }),
    resetMeasure: () =>
      set(s => {
        s.measureMode = 'idle'
        s.measurePoint1 = null
        s.measurePoint2 = null
      }),

    // Ink saver preset
    setInkSaverPreset: preset =>
      set(s => {
        s.inkSaverPreset = preset
        if (preset === 'light') Object.assign(s.inkSaver, INK_SAVER_LIGHT_PRESET)
        if (preset === 'heavy') Object.assign(s.inkSaver, INK_SAVER_HEAVY_PRESET)
        // 'custom' — leave sliders as-is, just record mode
      }),

    // Page selection
    setSelectedPages: pages =>
      set(s => {
        s.selectedPages = pages
      }),
    toggleSelectedPage: (row, col, totalRows, totalCols) =>
      set(s => {
        // Initialise (or reinitialise) when selectedPages is absent or has stale
        // dimensions from a previous grid size.  Without this check, a tiling
        // change (paper size, overlap, DPI) that reshapes the grid leaves an
        // array whose out-of-range rows are undefined, causing a TypeError on
        // the access below.
        const rowMismatch = s.selectedPages?.length !== totalRows
        const colMismatch = (s.selectedPages?.[0]?.length ?? 0) !== totalCols
        if (!s.selectedPages || rowMismatch || colMismatch) {
          s.selectedPages = Array.from({ length: totalRows }, () =>
            Array.from({ length: totalCols }, () => true)
          )
        }
        const target = s.selectedPages[row]
        if (!target) return
        target[col] = !target[col]
        // If all pages are enabled, collapse back to null (= all enabled)
        const allEnabled = s.selectedPages.every(r => r.every(c => c))
        if (allEnabled) s.selectedPages = null
      }),
  }))
)

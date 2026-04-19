import React, { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useCalibration } from '../hooks/useCalibration'
import { computeTileGrid } from '../../shared/TilingCalculator'
import { bridge } from '../ipc/bridge'
import { NumericInput } from './NumericInput'

// Fixed grid settings used for the calibration page — always 10 mm squares,
// never diagonals, so measurement with a ruler is straightforward.
const CALIBRATION_GRID_OVERRIDE = {
  showGrid: true,
  showGridDiagonals: false,
  diagonalSpacingMm: 10,
  showCutMarks: false,
  showPageLabels: false,
  labelStyle: 'grid' as const,
  alignToImage: false,
  extendBeyondImage: true,
  suppressOverImage: false,
  showScaleAnnotation: false,
}

export function ScaleSettings() {
  const store = useAppStore()
  const { startCalibration } = useCalibration()
  const { scale, source, calibrationMode, crop, measureMode, measurePoint1, measurePoint2 } = store
  const [exportingCalPage, setExportingCalPage] = useState(false)

  // Use crop dimensions for the printed-size and page-count display when a crop is active
  const imgW = crop ? crop.srcW : (source?.naturalWidthPx ?? 0)
  const imgH = crop ? crop.srcH : (source?.naturalHeightPx ?? 0)

  const mmPerPx = (25.4 / scale.dpi) * scale.outputScale
  // printerScaleX/Y is a compensation factor — the printer's stretch cancels it, so
  // the final printed size equals the unscaled physical dimensions.
  const physW = source ? (imgW * mmPerPx).toFixed(1) : '—'
  const physH = source ? (imgH * mmPerPx).toFixed(1) : '—'

  let pageCount = '—'
  if (source) {
    const { cols, rows } = computeTileGrid({
      imageWidthPx: imgW,
      imageHeightPx: imgH,
      dpi: scale.dpi,
      outputScale: scale.outputScale,
      printerScaleX: scale.printerScaleX,
      printerScaleY: scale.printerScaleY,
      paperSizeId: store.tiling.paperSizeId,
      orientation: store.tiling.orientation,
      overlapMmTop: store.tiling.overlapMmTop,
      overlapMmRight: store.tiling.overlapMmRight,
      overlapMmBottom: store.tiling.overlapMmBottom,
      overlapMmLeft: store.tiling.overlapMmLeft,
    })
    pageCount = `${cols} × ${rows} = ${cols * rows} pages`
  }

  // Measure distance between the two clicked points (source pixel coords → mm)
  let measureLabel: string | null = null
  if (measurePoint1 && measurePoint2) {
    const dx = (measurePoint2.xPx - measurePoint1.xPx) * mmPerPx
    const dy = (measurePoint2.yPx - measurePoint1.yPx) * mmPerPx
    const distMm = Math.sqrt(dx * dx + dy * dy)
    const distCm = distMm / 10
    const distIn = distMm / 25.4
    measureLabel = `${distMm.toFixed(1)} mm  •  ${distCm.toFixed(2)} cm  •  ${distIn.toFixed(3)} in`
  }

  const handleMeasureToggle = () => {
    if (measureMode !== 'idle') {
      store.resetMeasure()
    } else {
      store.resetMeasure()
      store.setMeasureMode('point1')
    }
  }

  const handleExportCalibrationPage = async () => {
    setExportingCalPage(true)
    try {
      const result = await bridge.exportTestGrid({
        outputPath: '', // empty → handler shows save dialog
        tiling: store.tiling,
        grid: CALIBRATION_GRID_OVERRIDE,
      })
      if (result.success) {
        alert(
          `✅ Calibration page saved:\n${result.outputPath}\n\nPrint at 100% (no fit-to-page). Measure 10 squares with a ruler, then use: measured ÷ expected × 100 = %.`
        )
      } else if (result.errorMessage) {
        alert(`❌ Export failed: ${result.errorMessage}`)
      }
    } finally {
      setExportingCalPage(false)
    }
  }

  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-gray-500 dark:text-gray-400 text-xs">
          {crop ? '(cropped) ' : ''}Printed size: {physW} × {physH} mm
        </span>
        <span className="text-blue-600 dark:text-blue-400 text-xs font-medium">{pageCount}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">DPI</label>
          <NumericInput
            value={scale.dpi}
            onChange={v => store.setScale({ dpi: v })}
            min={1}
            max={9600}
            step={1}
            decimals={1}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Scale</label>
          <NumericInput
            value={scale.outputScale}
            onChange={v => store.setScale({ outputScale: v })}
            min={0.01}
            max={10}
            step={0.01}
            decimals={2}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
          Printer compensation (%)
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-500 mb-0.5">Width</label>
            <NumericInput
              value={Math.round(scale.printerScaleX * 10000) / 100}
              onChange={v => store.setScale({ printerScaleX: v / 100 })}
              min={90}
              max={110}
              step={0.1}
              decimals={2}
              unit="%"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-500 mb-0.5">Height</label>
            <NumericInput
              value={Math.round(scale.printerScaleY * 10000) / 100}
              onChange={v => store.setScale({ printerScaleY: v / 100 })}
              min={90}
              max={110}
              step={0.1}
              decimals={2}
              unit="%"
            />
          </div>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Formula: measured ÷ expected × 100</p>
        <button
          onClick={handleExportCalibrationPage}
          disabled={exportingCalPage}
          className="mt-2 w-full rounded border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900 disabled:opacity-40 text-blue-700 dark:text-blue-300 text-xs py-1.5 font-medium transition-colors"
        >
          {exportingCalPage ? 'Saving…' : '🖨 Export Printer Calibration Page'}
        </button>
      </div>

      <button
        onClick={startCalibration}
        disabled={!source}
        className="w-full rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs py-1.5 font-medium transition-colors"
      >
        {calibrationMode !== 'idle'
          ? calibrationMode === 'point1'
            ? '🎯 Click point 1 on image…'
            : '🎯 Click point 2 on image…'
          : 'Set Scale via Two-Point Calibration'}
      </button>

      {calibrationMode !== 'idle' && (
        <p className="text-xs text-center text-orange-500">
          Click two known-distance points on the preview canvas
        </p>
      )}

      {/* Measure tool */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-1.5">
        <button
          onClick={handleMeasureToggle}
          disabled={!source}
          className={`w-full rounded text-xs py-1.5 font-medium transition-colors disabled:opacity-40 ${
            measureMode !== 'idle'
              ? 'bg-orange-500 hover:bg-orange-600 text-white'
              : 'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
          }`}
        >
          {measureMode !== 'idle'
            ? measurePoint1 && !measurePoint2
              ? '📐 Click second point…'
              : '✕ Stop Measuring'
            : '📐 Measure Image'}
        </button>

        {measureMode !== 'idle' && !measurePoint1 && (
          <p className="text-xs text-center text-orange-500">Click a point on the image to start</p>
        )}
        {measureMode !== 'idle' && measurePoint1 && !measurePoint2 && (
          <p className="text-xs text-center text-orange-500">Click a second point to measure distance</p>
        )}
        {measureLabel && (
          <div className="rounded bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 px-3 py-1.5 text-center">
            <span className="text-green-700 dark:text-green-300 font-medium text-sm">{measureLabel}</span>
            <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
              Click a new point to re-measure
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

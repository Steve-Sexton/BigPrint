import React, { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { NumericInput } from './NumericInput'
import { bridge } from '../ipc/bridge'

// ── Grid spacing unit helpers (mirrors TilingSettings pattern) ────────────────
type SpacingUnit = 'mm' | 'cm' | 'in'
const TO_MM: Record<SpacingUnit, number> = { mm: 1, cm: 10, in: 25.4 }
function toUnit(mm: number, unit: SpacingUnit) {
  return mm / TO_MM[unit]
}
function fromUnit(v: number, unit: SpacingUnit) {
  return v * TO_MM[unit]
}

export function GridSettings() {
  const store = useAppStore()
  const { grid, tiling } = store
  const [exporting, setExporting] = useState(false)
  const [unit, setUnit] = useState<SpacingUnit>('cm') // default cm matches original

  const gridActive = grid.showGrid || grid.showGridDiagonals

  const handlePrintTestGrid = async () => {
    setExporting(true)
    try {
      const result = await bridge.exportTestGrid({
        outputPath: '', // empty → handler shows save dialog
        tiling,
        grid,
      })
      if (result.success) {
        alert(`✅ Calibration grid saved to:\n${result.outputPath}`)
      } else {
        alert(`❌ Export failed: ${result.errorMessage}`)
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3 p-3 text-sm">
      {/* ── Grid type — two independent checkboxes ── */}
      <div className="space-y-1.5">
        <label className="block text-xs text-gray-600 dark:text-gray-400">Alignment grid</label>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="showGrid"
            checked={grid.showGrid}
            onChange={e => store.setGrid({ showGrid: e.target.checked })}
            className="rounded"
          />
          <label htmlFor="showGrid" className="text-xs text-gray-700 dark:text-gray-300">
            Show grid
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="showGridDiagonals"
            checked={grid.showGridDiagonals}
            onChange={e => store.setGrid({ showGridDiagonals: e.target.checked })}
            className="rounded"
          />
          <label htmlFor="showGridDiagonals" className="text-xs text-gray-700 dark:text-gray-300">
            Show grid diagonals
          </label>
        </div>
      </div>

      {/* ── Grid spacing + units (only when a grid is on) ── */}
      {gridActive && (
        <>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Grid size</label>
            <div className="flex items-center gap-1.5">
              <div className="flex-1">
                <NumericInput
                  value={toUnit(grid.diagonalSpacingMm, unit)}
                  onChange={v => store.setGrid({ diagonalSpacingMm: fromUnit(v, unit) })}
                  min={0.1}
                  max={500}
                  step={unit === 'mm' ? 1 : 0.1}
                  decimals={unit === 'mm' ? 0 : 2}
                />
              </div>
              {/* Unit toggle buttons */}
              <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
                {(['cm', 'mm', 'in'] as SpacingUnit[]).map(u => (
                  <button
                    key={u}
                    onClick={() => setUnit(u)}
                    className={`px-2 py-1 font-medium transition-colors ${
                      unit === u
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Alignment: radio pair like original BigPrint ── */}
          <div className="space-y-1">
            <label className="block text-xs text-gray-600 dark:text-gray-400">Grid origin</label>
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="alignToImage"
                name="gridAlign"
                checked={grid.alignToImage}
                onChange={() => store.setGrid({ alignToImage: true })}
              />
              <label htmlFor="alignToImage" className="text-xs text-gray-700 dark:text-gray-300">
                Aligns to top/left of picture
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="alignToPage"
                name="gridAlign"
                checked={!grid.alignToImage}
                onChange={() => store.setGrid({ alignToImage: false })}
              />
              <label htmlFor="alignToPage" className="text-xs text-gray-700 dark:text-gray-300">
                Aligns to top/left page edge
              </label>
            </div>
          </div>

          {/* ── Extend / suppress options ── */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="extendBeyondImage"
                checked={grid.extendBeyondImage}
                onChange={e => store.setGrid({ extendBeyondImage: e.target.checked })}
                className="rounded"
              />
              <label htmlFor="extendBeyondImage" className="text-xs text-gray-700 dark:text-gray-300">
                Grid extends past image
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="suppressOverImage"
                checked={grid.suppressOverImage}
                onChange={e => store.setGrid({ suppressOverImage: e.target.checked })}
                className="rounded"
              />
              <label htmlFor="suppressOverImage" className="text-xs text-gray-700 dark:text-gray-300">
                No grid over image
              </label>
            </div>
          </div>
        </>
      )}

      {/* ── Print marks & labels ── */}
      <div className="space-y-1.5">
        {[
          { key: 'showCutMarks', label: 'Show cut / trim marks' },
          { key: 'showPageLabels', label: 'Show page labels' },
          { key: 'showScaleAnnotation', label: 'Show scale reference on printout' },
        ].map(({ key, label }) => (
          <div key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={key}
              checked={grid[key as keyof typeof grid] as boolean}
              onChange={e => store.setGrid({ [key]: e.target.checked })}
              className="rounded"
            />
            <label htmlFor={key} className="text-xs text-gray-700 dark:text-gray-300">
              {label}
            </label>
          </div>
        ))}
      </div>

      {grid.showPageLabels && (
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Label style</label>
          <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
            {(
              [
                { id: 'grid', label: 'A1, B2… (Grid)' },
                { id: 'sequential', label: '1/12… (Sequential)' },
              ] as { id: 'grid' | 'sequential'; label: string }[]
            ).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => store.setGrid({ labelStyle: id })}
                className={`flex-1 py-1 text-xs font-medium transition-colors ${
                  grid.labelStyle === id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Calibration grid export ── */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Printer scale calibration: print this grid, measure 10 spaces with a ruler, enter the ratio in Scale
          settings.
        </p>
        <button
          onClick={handlePrintTestGrid}
          disabled={exporting}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 text-gray-700 dark:text-gray-300 text-xs py-1.5 font-medium transition-colors"
        >
          {exporting ? 'Saving…' : '📐 Save Calibration Grid PDF'}
        </button>
      </div>
    </div>
  )
}

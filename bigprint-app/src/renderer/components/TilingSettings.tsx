import React, { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { PAPER_SIZES } from '../../shared/constants'
import { NumericInput } from './NumericInput'

type OverlapUnit = 'mm' | 'cm' | 'in'

const UNIT_LABELS: Record<OverlapUnit, string> = { mm: 'mm', cm: 'cm', in: 'in' }
const TO_MM: Record<OverlapUnit, number> = { mm: 1, cm: 10, in: 25.4 }

function toUnit(mm: number, unit: OverlapUnit) {
  return mm / TO_MM[unit]
}
function fromUnit(v: number, unit: OverlapUnit) {
  return v * TO_MM[unit]
}
function unitDecimals(unit: OverlapUnit) {
  return unit === 'mm' ? 0 : unit === 'cm' ? 1 : 2
}
function unitMax(unit: OverlapUnit) {
  return unit === 'mm' ? 50 : unit === 'cm' ? 5 : 2
}
function unitStep(unit: OverlapUnit) {
  return unit === 'mm' ? 1 : unit === 'cm' ? 0.1 : 0.05
}

export function TilingSettings() {
  const store = useAppStore()
  const { tiling } = store
  const [unit, setUnit] = useState<OverlapUnit>('mm')

  const handleOrientationChange = (o: 'portrait' | 'landscape') => {
    if (o === tiling.orientation) return
    // Do NOT swap printer-scale compensation on orientation change.
    //
    // Physically the printer's X/Y axes swap when the page is fed in the
    // other orientation, BUT the persisted preferences round-trip through a
    // debounced save. Two flips in quick succession (the user toggling to
    // landscape to preview the grid, then back) would silently write the
    // swapped values as the new baseline. The correction must remain tied to
    // the printer's feed direction, not the UI's displayed orientation.
    //
    // In practice both scale factors are within a few percent of 1.00 for
    // any reasonably-calibrated printer; leaving them untouched on flip
    // keeps the calibration stable across orientation experiments. If a
    // future deployment discovers the X/Y values genuinely diverge, the
    // right fix is to store `portraitX/portraitY/landscapeX/landscapeY`
    // as four separate fields — not a flip-based swap.
    store.setTiling({ orientation: o })
  }

  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Paper</label>
          <select
            value={tiling.paperSizeId}
            onChange={e => store.setTiling({ paperSizeId: e.target.value })}
            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1 text-xs"
          >
            {PAPER_SIZES.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Orientation</label>
          <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
            {(['portrait', 'landscape'] as const).map(o => (
              <button
                key={o}
                onClick={() => handleOrientationChange(o)}
                className={`flex-1 py-1 text-xs capitalize font-medium transition-colors ${
                  tiling.orientation === o
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {o === 'portrait' ? '↕' : '↔'} {o}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        {/* Header row: label + unit selector */}
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-600 dark:text-gray-400">Overlap — per edge</label>
          <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
            {(['mm', 'cm', 'in'] as OverlapUnit[]).map(u => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`px-1.5 py-0.5 text-xs font-medium transition-colors ${
                  unit === u
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {UNIT_LABELS[u]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 text-center">
          <div />
          <NumericInput
            value={toUnit(tiling.overlapMmTop, unit)}
            onChange={v => store.setTiling({ overlapMmTop: fromUnit(v, unit) })}
            min={0}
            max={unitMax(unit)}
            step={unitStep(unit)}
            decimals={unitDecimals(unit)}
          />
          <div />
          <NumericInput
            value={toUnit(tiling.overlapMmLeft, unit)}
            onChange={v => store.setTiling({ overlapMmLeft: fromUnit(v, unit) })}
            min={0}
            max={unitMax(unit)}
            step={unitStep(unit)}
            decimals={unitDecimals(unit)}
          />
          <div className="flex items-center justify-center text-xs text-gray-400">all</div>
          <NumericInput
            value={toUnit(tiling.overlapMmRight, unit)}
            onChange={v => store.setTiling({ overlapMmRight: fromUnit(v, unit) })}
            min={0}
            max={unitMax(unit)}
            step={unitStep(unit)}
            decimals={unitDecimals(unit)}
          />
          <div />
          <NumericInput
            value={toUnit(tiling.overlapMmBottom, unit)}
            onChange={v => store.setTiling({ overlapMmBottom: fromUnit(v, unit) })}
            min={0}
            max={unitMax(unit)}
            step={unitStep(unit)}
            decimals={unitDecimals(unit)}
          />
          <div />
        </div>
        <button
          className="mt-1 w-full text-xs text-blue-500 hover:text-blue-700"
          onClick={() => {
            const v = tiling.overlapMmTop
            store.setTiling({ overlapMmRight: v, overlapMmBottom: v, overlapMmLeft: v })
          }}
        >
          ↔ Apply top value to all edges
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="skipBlanks"
          checked={tiling.skipBlankPages}
          onChange={e => store.setTiling({ skipBlankPages: e.target.checked })}
          className="rounded"
        />
        <label htmlFor="skipBlanks" className="text-xs text-gray-700 dark:text-gray-300">
          Skip blank pages
        </label>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="showOverlap"
          checked={tiling.showOverlapArea}
          onChange={e => store.setTiling({ showOverlapArea: e.target.checked })}
          className="rounded"
        />
        <label htmlFor="showOverlap" className="text-xs text-gray-700 dark:text-gray-300">
          Print overlap area background
        </label>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="centerImage"
          checked={tiling.centerImage}
          onChange={e => store.setTiling({ centerImage: e.target.checked })}
          className="rounded"
        />
        <label htmlFor="centerImage" className="text-xs text-gray-700 dark:text-gray-300">
          Center image on assembled pages
        </label>
      </div>
    </div>
  )
}

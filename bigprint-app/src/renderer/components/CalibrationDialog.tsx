import React, { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useCalibration } from '../hooks/useCalibration'

export function CalibrationDialog() {
  const { showCalibrationDialog } = useAppStore()
  const { applyCalibration, cancelCalibration } = useCalibration()
  const [distance, setDistance] = useState('100')
  const [unit, setUnit] = useState<'mm' | 'cm' | 'in'>('mm')

  if (!showCalibrationDialog) return null

  function handleApply() {
    let mm = parseFloat(distance)
    if (isNaN(mm) || mm <= 0) {
      alert('Enter a valid distance.')
      return
    }
    if (unit === 'cm') mm *= 10
    if (unit === 'in') mm *= 25.4
    applyCalibration(mm)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-80 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Set Real-World Distance</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Enter the real-world distance between the two points you clicked.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            value={distance}
            onChange={e => setDistance(e.target.value)}
            className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
            placeholder="100"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleApply()}
          />
          <select
            value={unit}
            onChange={e => setUnit(e.target.value as 'mm' | 'cm' | 'in')}
            className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-2 py-2 text-sm"
          >
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="in">in</option>
          </select>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={cancelCalibration}
            className="px-4 py-2 rounded text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Apply Scale
          </button>
        </div>
      </div>
    </div>
  )
}

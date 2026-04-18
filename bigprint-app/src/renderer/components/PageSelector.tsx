import React, { useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { computeTileGrid, getLabelForTile } from '../../shared/TilingCalculator'

/**
 * Compact interactive tile-grid overlay.  Each cell represents one printed
 * page; clicking toggles whether it is included in the export/print.
 * Enabled pages are shown in blue; disabled pages are shown in gray.
 * When all pages are enabled the store keeps `selectedPages = null`.
 */
export function PageSelector() {
  const store = useAppStore()
  const { source, scale, tiling, crop, selectedPages } = store

  // Re-compute the grid whenever settings change
  const grid = useMemo(() => {
    if (!source) return null
    const imgW = crop ? crop.srcW : source.naturalWidthPx
    const imgH = crop ? crop.srcH : source.naturalHeightPx
    return computeTileGrid({
      imageWidthPx: imgW,
      imageHeightPx: imgH,
      dpi: scale.dpi,
      outputScale: scale.outputScale,
      printerScaleX: scale.printerScaleX,
      printerScaleY: scale.printerScaleY,
      paperSizeId: tiling.paperSizeId,
      orientation: tiling.orientation,
      overlapMmTop: tiling.overlapMmTop,
      overlapMmRight: tiling.overlapMmRight,
      overlapMmBottom: tiling.overlapMmBottom,
      overlapMmLeft: tiling.overlapMmLeft,
    })
  }, [source, crop, scale, tiling])

  if (!source || !grid) {
    return (
      <div className="p-3 text-xs text-gray-400 dark:text-gray-600 text-center">
        Open an image to select pages
      </div>
    )
  }

  const { cols, rows } = grid
  const totalPages = cols * rows

  // Is a specific page enabled?
  const isEnabled = (r: number, c: number): boolean => {
    if (!selectedPages) return true
    return selectedPages[r]?.[c] ?? true
  }

  // Count of currently enabled pages
  const enabledCount = selectedPages
    ? selectedPages.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
    : totalPages

  const handleSelectAll = () => store.setSelectedPages(null)
  const handleSelectNone = () => {
    store.setSelectedPages(Array.from({ length: rows }, () => Array.from({ length: cols }, () => false)))
  }

  // Cell aspect ratio matches the paper orientation (portrait ≈ 3:4, landscape ≈ 4:3)
  const cellAspect = tiling.orientation === 'portrait' ? 4 / 3 : 3 / 4 // height/width
  const cellW = Math.min(32, Math.floor((240 - 16) / cols)) // max 240px panel, 8px margins
  const cellH = Math.round(cellW * cellAspect)

  return (
    <div className="p-3 space-y-2 text-sm">
      {/* Summary + quick-select buttons */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {enabledCount === totalPages ? `All ${totalPages} pages` : `${enabledCount} / ${totalPages} pages`}
        </span>
        <div className="flex gap-1">
          <button
            onClick={handleSelectAll}
            disabled={enabledCount === totalPages}
            className="text-xs px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 text-gray-700 dark:text-gray-300 transition-colors"
          >
            All
          </button>
          <button
            onClick={handleSelectNone}
            disabled={enabledCount === 0}
            className="text-xs px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 text-gray-700 dark:text-gray-300 transition-colors"
          >
            None
          </button>
        </div>
      </div>

      {/* Tile grid */}
      <div className="flex flex-col gap-px" style={{ width: cols * (cellW + 2) }}>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-px">
            {Array.from({ length: cols }, (_, c) => {
              const enabled = isEnabled(r, c)
              // getLabelForTile uses base-26 (A–Z, AA–AZ, …) so labels stay
              // valid for grids with more than 26 rows — same logic as the PDF.
              const label = getLabelForTile(r, c, rows, cols, 'grid')
              return (
                <button
                  key={c}
                  title={`Page ${label} — click to ${enabled ? 'exclude' : 'include'}`}
                  onClick={() => store.toggleSelectedPage(r, c, rows, cols)}
                  className={`rounded-sm border text-[9px] font-medium leading-none transition-colors ${
                    enabled
                      ? 'bg-blue-500 border-blue-600 text-white hover:bg-blue-600'
                      : 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                  style={{ width: cellW, height: cellH }}
                >
                  {cellW >= 20 ? label : ''}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {enabledCount === 0 && (
        <p className="text-xs text-orange-500">No pages selected — export will be empty.</p>
      )}
      {selectedPages !== null && enabledCount < totalPages && (
        <p className="text-xs text-blue-500 dark:text-blue-400">
          Only selected pages will be exported/printed.
        </p>
      )}
    </div>
  )
}

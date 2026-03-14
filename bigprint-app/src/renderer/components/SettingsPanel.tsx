import React, { useState } from 'react'
import { ScaleSettings } from './ScaleSettings'
import { TilingSettings } from './TilingSettings'
import { GridSettings } from './GridSettings'
import { InkSaverSettings } from './InkSaverSettings'
import { PageSelector } from './PageSelector'
import { useAppStore } from '../store/appStore'
import { computeTileGrid } from '../../shared/TilingCalculator'

type Section = 'scale' | 'tiling' | 'grid' | 'inkSaver' | 'pages'

export function SettingsPanel() {
  const [open, setOpen] = useState<Section>('scale')
  const { source, scale, tiling, crop, selectedPages } = useAppStore()

  let pageInfo = ''
  let totalPages = 0
  if (source) {
    const imgW = crop ? crop.srcW : source.naturalWidthPx
    const imgH = crop ? crop.srcH : source.naturalHeightPx
    const { cols, rows } = computeTileGrid({
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
      overlapMmLeft: tiling.overlapMmLeft
    })
    pageInfo = `${cols}×${rows}`
    totalPages = cols * rows
  }

  // Badge for Pages section: highlight in orange when a selection is active
  const enabledCount = selectedPages
    ? selectedPages.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
    : totalPages
  const pagesBadge = source
    ? (selectedPages && enabledCount < totalPages ? `${enabledCount}/${totalPages}` : pageInfo)
    : ''

  type SectionDef = { id: Section; label: string; badge: string; onlyWhenSource?: true }
  const sections: SectionDef[] = [
    { id: 'scale',    label: 'Scale & Calibration', badge: `${scale.dpi.toFixed(0)} DPI` },
    { id: 'tiling',   label: 'Tiling & Paper',      badge: pageInfo ? `${pageInfo} pages` : `${tiling.paperSizeId.toUpperCase()}` },
    { id: 'grid',     label: 'Grid & Marks',         badge: '' },
    { id: 'inkSaver', label: 'Ink Saver',            badge: '' },
    { id: 'pages',    label: 'Page Selection',       badge: pagesBadge, onlyWhenSource: true },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 w-72 shrink-0">
      {sections
        .filter(s => !s.onlyWhenSource || source)
        .map(({ id, label, badge }) => {
          const isSelectionActive = id === 'pages' && !!selectedPages && enabledCount < totalPages
          return (
            <div key={id} className="border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setOpen(prev => prev === id ? '' as Section : id)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
                <div className="flex items-center gap-1.5">
                  {badge && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      isSelectionActive
                        ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30'
                        : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                    }`}>
                      {badge}
                    </span>
                  )}
                  <span className="text-gray-400 text-xs">{open === id ? '▲' : '▼'}</span>
                </div>
              </button>
              {open === id && (
                <div className="bg-white dark:bg-gray-850">
                  {id === 'scale'    && <ScaleSettings />}
                  {id === 'tiling'   && <TilingSettings />}
                  {id === 'grid'     && <GridSettings />}
                  {id === 'inkSaver' && <InkSaverSettings />}
                  {id === 'pages'    && <PageSelector />}
                </div>
              )}
            </div>
          )
        })
      }
    </div>
  )
}

import React from 'react'
import { useAppStore, INK_SAVER_LIGHT_PRESET, INK_SAVER_HEAVY_PRESET } from '../store/appStore'
import { NumericInput } from './NumericInput'

// Derive descriptions from the actual preset constants so any future tuning of
// brightness / gamma / edge-fade automatically updates the UI copy too.
function describePreset(p: typeof INK_SAVER_LIGHT_PRESET): string {
  return `brightness ${p.brightness}, gamma ${p.gamma}, edge-fade ${p.edgeFadeStrength}%`
}

const PRESET_MODES: Array<{ id: 'light' | 'heavy' | 'custom'; label: string; desc: string }> = [
  { id: 'light',  label: '☀ Lighten areas', desc: `Mild: ${describePreset(INK_SAVER_LIGHT_PRESET)}` },
  { id: 'heavy',  label: '🌑 Lighten more',  desc: `Strong: ${describePreset(INK_SAVER_HEAVY_PRESET)}` },
  { id: 'custom', label: '⚙ Custom',        desc: 'Adjust sliders manually' }
]

export function InkSaverSettings() {
  const store = useAppStore()
  const { inkSaver, inkSaverPreset } = store

  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="inkSaverEnabled"
          checked={inkSaver.enabled}
          onChange={e => store.setInkSaver({ enabled: e.target.checked })}
          className="rounded"
        />
        <label htmlFor="inkSaverEnabled" className="text-xs font-medium text-gray-700 dark:text-gray-300">
          Enable ink saver
        </label>
      </div>

      {inkSaver.enabled && (
        <>
          {/* Preset mode selector */}
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Mode</label>
            <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
              {PRESET_MODES.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => store.setInkSaverPreset(id)}
                  className={`flex-1 py-1 text-xs font-medium transition-colors ${
                    inkSaverPreset === id
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {PRESET_MODES.find(m => m.id === inkSaverPreset)?.desc}
            </p>
          </div>
        </>
      )}

      <div className={inkSaver.enabled && inkSaverPreset === 'custom' ? 'space-y-3' : 'space-y-3 opacity-40 pointer-events-none'}>
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
            Brightness <span className="text-gray-400">(100 = no change)</span>
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="range" min={10} max={200} value={inkSaver.brightness}
              onChange={e => store.setInkSaver({ brightness: Number(e.target.value) })}
              className="flex-1"
            />
            <NumericInput value={inkSaver.brightness} onChange={v => store.setInkSaver({ brightness: v })}
              min={10} max={200} step={1} decimals={0} className="w-16" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
            Gamma <span className="text-gray-400">(&gt;1 = lighten grays, keep lines)</span>
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="range" min={100} max={300} value={inkSaver.gamma * 100}
              onChange={e => store.setInkSaver({ gamma: Number(e.target.value) / 100 })}
              className="flex-1"
            />
            <NumericInput value={inkSaver.gamma} onChange={v => store.setInkSaver({ gamma: v })}
              min={1.0} max={3.0} step={0.05} decimals={2} className="w-16" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
            Edge-aware fade <span className="text-gray-400">(fades fills away from lines)</span>
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="range" min={0} max={100} value={inkSaver.edgeFadeStrength}
              onChange={e => store.setInkSaver({ edgeFadeStrength: Number(e.target.value) })}
              className="flex-1"
            />
            <NumericInput value={inkSaver.edgeFadeStrength} onChange={v => store.setInkSaver({ edgeFadeStrength: v })}
              min={0} max={100} step={1} decimals={0} unit="%" className="w-20" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
            Edge-fade radius <span className="text-gray-400">(spread of edge influence)</span>
          </label>
          <NumericInput value={inkSaver.edgeFadeRadiusMm} onChange={v => store.setInkSaver({ edgeFadeRadiusMm: v })}
            min={0.5} max={20} step={0.5} decimals={1} unit="mm" />
        </div>
      </div>
    </div>
  )
}

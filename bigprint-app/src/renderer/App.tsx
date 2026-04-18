import React, { useCallback, useEffect, useRef } from 'react'
import { Toolbar } from './components/Toolbar'
import { PreviewCanvas } from './components/PreviewCanvas'
import { SettingsPanel } from './components/SettingsPanel'
import { CalibrationDialog } from './components/CalibrationDialog'
import { useAppStore } from './store/appStore'
import { bridge } from './ipc/bridge'
import { MAX_PREVIEW_SIZE_PX } from '../shared/constants'
import type { AppPreferences } from '../shared/ipc-types'

export function App() {
  const store = useAppStore()
  const isDraggingOver = useRef(false)
  // Prevents the debounced save effect from firing during the initial hydration
  // pass (load prefs → set store → save effect would rewrite the file with the
  // same content). Flipped to true after load completes (success or not).
  const hydrated = useRef(false)

  // ── Dark mode initialisation ──────────────────────────────────────────────
  useEffect(() => {
    const cleanup = bridge.onThemeChange((isDark) => {
      document.documentElement.classList.toggle('dark', isDark)
    })
    return cleanup
  }, [])

  // ── Load persisted preferences on startup ─────────────────────────────────
  useEffect(() => {
    bridge.loadPreferences()
      .then(prefs => {
        if (!prefs) return   // first launch — use DEFAULT_STATE as-is
        store.setTiling(prefs.tiling)
        store.setGrid(prefs.grid)
        store.setInkSaver(prefs.inkSaver)
        store.setScale({ printerScaleX: prefs.printerScaleX, printerScaleY: prefs.printerScaleY })
        // Apply preset last so preset values aren't overwritten by the above
        if (prefs.inkSaverPreset) store.setInkSaverPreset(prefs.inkSaverPreset)
      })
      .catch(err => console.warn('[App] loadPreferences failed:', err))
      .finally(() => { hydrated.current = true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist preferences whenever relevant settings change ─────────────────
  const savePrefsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!hydrated.current) return   // skip the initial pass — avoids redundant write on launch
    if (savePrefsTimer.current) clearTimeout(savePrefsTimer.current)
    savePrefsTimer.current = setTimeout(() => {
      const prefs: AppPreferences = {
        tiling: store.tiling,
        grid: store.grid,
        inkSaver: store.inkSaver,
        inkSaverPreset: store.inkSaverPreset,
        printerScaleX: store.scale.printerScaleX,
        printerScaleY: store.scale.printerScaleY
      }
      bridge.savePreferences(prefs).catch(err =>
        console.warn('[App] savePreferences failed:', err)
      )
    }, 800)
    return () => { if (savePrefsTimer.current) clearTimeout(savePrefsTimer.current) }
  }, [store.tiling, store.grid, store.inkSaver, store.inkSaverPreset,
      store.scale.printerScaleX, store.scale.printerScaleY])

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDraggingOver.current) {
      isDraggingOver.current = true
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingOver.current = false
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingOver.current = false

    const file = e.dataTransfer.files[0]
    if (!file) return

    // Electron 32+ removed the non-standard File.path property. Resolve through
    // the preload's webUtils.getPathForFile() shim instead.
    const filePath = bridge.getPathForFile(file)
    if (!filePath) {
      alert('Could not resolve dropped file path. Try using the Open button.')
      return
    }

    // Admit the dropped path into the main process's read allowlist so the
    // subsequent image:* / pdf:* IPC calls are permitted.
    let mimeType: string
    try {
      const reg = await bridge.registerFile(filePath)
      mimeType = reg.mimeType
    } catch (err) {
      alert(`Failed to register dropped file: ${err}`)
      return
    }

    const isPdf = mimeType === 'application/pdf'
    store.setLoading(true, 'Loading image…')
    try {
      const [meta, previewDataUrl, pdfTotalPages] = await Promise.all([
        bridge.getImageMeta(filePath),
        isPdf
          ? bridge.renderPDFPage(filePath, 0, 1)
          : bridge.getPreviewDataUrl(filePath, MAX_PREVIEW_SIZE_PX),
        isPdf ? bridge.getPDFPageCount(filePath) : Promise.resolve(1)
      ])

      store.setSource({
        filePath,
        mimeType,
        naturalWidthPx: meta.widthPx,
        naturalHeightPx: meta.heightPx,
        previewDataUrl: previewDataUrl || '',
        pdfPageIndex: 0,
        pdfTotalPages: pdfTotalPages ?? 1
      })

      if (meta.dpiX && meta.dpiX > 10) {
        store.setScale({ dpi: meta.dpiX })
      }
    } catch (err) {
      alert(`Failed to load dropped file: ${err}`)
    } finally {
      store.setLoading(false)
    }
  }, [store])

  // ── Paste (clipboard images) ──────────────────────────────────────────────
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(
        i => i.type.startsWith('image/')
      )
      if (!item) return

      const blob = item.getAsFile()
      if (!blob) return

      store.setLoading(true, 'Loading clipboard image…')
      try {
        // Fetch raw bytes and preview data URL concurrently.
        //   clipboardBuffer → passed verbatim to Sharp on export/print so the
        //                     full-resolution source is never re-encoded through
        //                     the preview pipeline.
        //   dataUrl         → used only for the canvas preview widget.
        // Reading both at once avoids any coupling between the two concerns.
        const [clipboardBuffer, dataUrl] = await Promise.all([
          blob.arrayBuffer(),
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(new Error('FileReader failed'))
            reader.readAsDataURL(blob)
          })
        ])

        // Measure actual pixel dimensions from the decoded image.
        await new Promise<void>((resolve, reject) => {
          const img = new Image()
          img.onload = () => {
            store.setSource({
              filePath: '<clipboard>',
              mimeType: item.type,
              naturalWidthPx: img.naturalWidth,
              naturalHeightPx: img.naturalHeight,
              previewDataUrl: dataUrl,
              clipboardBuffer,
              pdfPageIndex: 0,
              pdfTotalPages: 1
            })
            resolve()
          }
          img.onerror = () => reject(new Error('Failed to decode clipboard image'))
          img.src = dataUrl
        })
      } catch (err) {
        alert(`Clipboard paste failed: ${err}`)
      } finally {
        store.setLoading(false)
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [store])

  return (
    <div
      className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900 overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Top toolbar */}
      <Toolbar />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Canvas preview — fills remaining space */}
        <div className="flex-1 min-w-0 relative">
          <PreviewCanvas />
        </div>

        {/* Right settings panel */}
        <div className="w-72 shrink-0 border-l border-gray-200 dark:border-gray-700 overflow-y-auto bg-white dark:bg-gray-800">
          <SettingsPanel />
        </div>
      </div>

      {/* Calibration dialog (modal) */}
      <CalibrationDialog />

      {/* Loading overlay */}
      {store.isLoading && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-white dark:bg-gray-800 rounded-lg px-6 py-4 shadow-xl flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {store.loadingMessage}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useCallback, useEffect, useRef } from 'react'
import { MAX_PREVIEW_SIZE_PX } from '../shared/constants'
import { log } from '../shared/log'
import type { AppPreferences } from '../shared/ipc-types'
import { Toolbar } from './components/Toolbar'
import { PreviewCanvas } from './components/PreviewCanvas'
import { SettingsPanel } from './components/SettingsPanel'
import { CalibrationDialog } from './components/CalibrationDialog'
import { useAppStore } from './store/appStore'
import { bridge } from './ipc/bridge'

export function App() {
  // Stable selectors only — do NOT `const store = useAppStore()` here, which
  // re-renders the whole App on any state change and re-binds every callback
  // and useEffect that depends on `store`.
  const isLoading = useAppStore(s => s.isLoading)
  const loadingMessage = useAppStore(s => s.loadingMessage)
  const tiling = useAppStore(s => s.tiling)
  const grid = useAppStore(s => s.grid)
  const inkSaver = useAppStore(s => s.inkSaver)
  const inkSaverPreset = useAppStore(s => s.inkSaverPreset)
  const printerScaleX = useAppStore(s => s.scale.printerScaleX)
  const printerScaleY = useAppStore(s => s.scale.printerScaleY)
  // Prevents the debounced save effect from firing during the initial hydration
  // pass (load prefs → set store → save effect would rewrite the file with the
  // same content). Flipped to true after load completes (success or not).
  const hydrated = useRef(false)

  // ── Dark mode initialisation ──────────────────────────────────────────────
  useEffect(() => {
    const cleanup = bridge.onThemeChange(isDark => {
      document.documentElement.classList.toggle('dark', isDark)
    })
    return cleanup
  }, [])

  // ── Load persisted preferences on startup ─────────────────────────────────
  // Snapshot each settings slice by reference at mount. When the async load
  // resolves we only apply the disk value for a slice if its current store
  // reference is still the initial one — i.e. the user hasn't edited it while
  // the IPC round-trip was in flight. Immer produces a fresh reference on every
  // setter, so ref equality is a reliable "untouched" signal.
  useEffect(() => {
    const initial = useAppStore.getState()
    const snap = {
      tiling: initial.tiling,
      grid: initial.grid,
      inkSaver: initial.inkSaver,
      inkSaverPreset: initial.inkSaverPreset,
      printerScaleX: initial.scale.printerScaleX,
      printerScaleY: initial.scale.printerScaleY,
    }
    const { setTiling, setGrid, setInkSaver, setScale, setInkSaverPreset } = useAppStore.getState()
    bridge
      .loadPreferences()
      .then(prefs => {
        if (!prefs) return // first launch — use DEFAULT_STATE as-is
        const current = useAppStore.getState()
        if (current.tiling === snap.tiling) setTiling(prefs.tiling)
        if (current.grid === snap.grid) setGrid(prefs.grid)
        if (current.inkSaver === snap.inkSaver) setInkSaver(prefs.inkSaver)
        if (
          current.scale.printerScaleX === snap.printerScaleX &&
          current.scale.printerScaleY === snap.printerScaleY
        ) {
          setScale({ printerScaleX: prefs.printerScaleX, printerScaleY: prefs.printerScaleY })
        }
        // Apply preset last so preset values aren't overwritten by the above
        if (prefs.inkSaverPreset && current.inkSaverPreset === snap.inkSaverPreset) {
          setInkSaverPreset(prefs.inkSaverPreset)
        }
      })
      .catch(err => log.warn('App', 'loadPreferences failed:', err))
      .finally(() => {
        hydrated.current = true
      })
  }, [])

  // ── Persist preferences whenever relevant settings change ─────────────────
  const savePrefsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savePrefsAlertShownRef = useRef(false)
  useEffect(() => {
    if (!hydrated.current) return // skip the initial pass — avoids redundant write on launch
    if (savePrefsTimer.current) clearTimeout(savePrefsTimer.current)
    savePrefsTimer.current = setTimeout(() => {
      const prefs: AppPreferences = {
        tiling,
        grid,
        inkSaver,
        inkSaverPreset,
        printerScaleX,
        printerScaleY,
      }
      bridge.savePreferences(prefs).catch(err => {
        log.warn('App', 'savePreferences failed:', err)
        // Only alert once per session so repeated debounced saves don't spam
        // the user — subsequent failures still log.
        if (!savePrefsAlertShownRef.current) {
          savePrefsAlertShownRef.current = true
          alert(
            'Your settings could not be saved to disk. ' +
              'The app will keep working, but changes may not persist between sessions.\n\n' +
              `Details: ${String(err)}`
          )
        }
      })
    }, 800)
    return () => {
      if (savePrefsTimer.current) clearTimeout(savePrefsTimer.current)
    }
  }, [tiling, grid, inkSaver, inkSaverPreset, printerScaleX, printerScaleY])

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  // preventDefault on dragover + drop is required so Chromium doesn't navigate
  // the window to the dropped file's URL instead of delivering the File object.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

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

    const { setLoading, setSource, setScale } = useAppStore.getState()
    const isPdf = mimeType === 'application/pdf'
    setLoading(true, 'Loading image…')
    try {
      const [meta, previewDataUrl, pdfTotalPages] = await Promise.all([
        bridge.getImageMeta(filePath),
        isPdf
          ? bridge.renderPDFPage(filePath, 0, 1)
          : bridge.getPreviewDataUrl(filePath, MAX_PREVIEW_SIZE_PX),
        isPdf ? bridge.getPDFPageCount(filePath) : Promise.resolve(1),
      ])

      setSource({
        filePath,
        mimeType,
        naturalWidthPx: meta.widthPx,
        naturalHeightPx: meta.heightPx,
        previewDataUrl: previewDataUrl || '',
        pdfPageIndex: 0,
        pdfTotalPages: pdfTotalPages ?? 1,
      })

      // Auto-detect DPI — raster formats only. PDFs carry no intrinsic DPI
      // (they're in points); leave their DPI to the user's current setting.
      // Also reset outputScale — prior calibration may have rebased it.
      if (meta.dpiX && meta.dpiX > 10 && meta.format !== 'pdf') {
        setScale({ dpi: meta.dpiX, outputScale: 1.0 })
      }
    } catch (err) {
      alert(`Failed to load dropped file: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Paste (clipboard images) ──────────────────────────────────────────────
  // Empty deps: we deliberately do NOT close over `store` so the listener is
  // installed exactly once. Actions are read via useAppStore.getState() so
  // they stay fresh without triggering re-subscription on every state change.
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const { setLoading, setSource } = useAppStore.getState()
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'))
      if (!item) return

      const blob = item.getAsFile()
      if (!blob) return

      setLoading(true, 'Loading clipboard image…')
      try {
        // Fetch raw bytes and preview data URL concurrently.
        //   clipboardBuffer → passed verbatim to Sharp on export/print so the
        //                     full-resolution source is never re-encoded through
        //                     the preview pipeline.
        //   dataUrl         → used only for the canvas preview widget.
        const [clipboardBuffer, dataUrl] = await Promise.all([
          blob.arrayBuffer(),
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              // readAsDataURL always produces a string on success, but the
              // result type is `string | ArrayBuffer | null`; narrow before
              // resolving so a malformed or partial read cannot be silently
              // promoted to a bogus data URL downstream.
              const r = reader.result
              if (typeof r !== 'string') {
                reject(new Error('FileReader produced non-string result'))
                return
              }
              resolve(r)
            }
            reader.onerror = () => reject(new Error('FileReader failed'))
            reader.readAsDataURL(blob)
          }),
        ])

        // Measure actual pixel dimensions from the decoded image.
        await new Promise<void>((resolve, reject) => {
          const img = new Image()
          img.onload = () => {
            setSource({
              filePath: '<clipboard>',
              mimeType: item.type,
              naturalWidthPx: img.naturalWidth,
              naturalHeightPx: img.naturalHeight,
              previewDataUrl: dataUrl,
              clipboardBuffer,
              pdfPageIndex: 0,
              pdfTotalPages: 1,
            })
            resolve()
          }
          img.onerror = () => reject(new Error('Failed to decode clipboard image'))
          img.src = dataUrl
        })
      } catch (err) {
        alert(`Clipboard paste failed: ${err}`)
      } finally {
        setLoading(false)
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

  return (
    <div
      className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900 overflow-hidden"
      onDragOver={handleDragOver}
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
      {isLoading && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-white dark:bg-gray-800 rounded-lg px-6 py-4 shadow-xl flex items-center gap-3">
            <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{loadingMessage}</span>
          </div>
        </div>
      )}
    </div>
  )
}

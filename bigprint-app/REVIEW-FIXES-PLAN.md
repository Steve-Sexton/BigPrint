# BigPrint — Review Issues Implementation Plan

Generated: 2026-03-08
Source: Tutorial review + Ink Saver review

---

## Priority Tiers

| Tier | Label | Criteria |
|------|-------|----------|
| P0 | **Correctness bug** | Produces wrong output silently |
| P1 | **UX gap** | Feature exists in original but missing/broken here |
| P2 | **Quality / Polish** | Works but degraded experience |
| P3 | **Deferred** | Nice-to-have; skip until core is solid |

---

## P0 — Correctness Bugs (fix first, zero-risk to defer anything else)

---

### Fix 1: Sobel convolution `offset: 0` → `offset: 128`

**File:** `src/main/image/InkSaver.ts`
**Impact:** Edge-aware fading produces completely wrong mask — only detects edges with positive X/Y gradient, misses all others. All `edgeFadeStrength` values produce broken output.

**Root cause:**
Sharp's `convolve` clamps output to `[0, 255]`. With `offset: 0`, any pixel where the Sobel kernel produces a negative sum is clamped to 0. The code then does `gx = sobelXBuf[i] - 128`, implicitly treating the buffer as if it were centered at 128 — but it isn't; negatives were lost.

**Fix (two lines):**

```typescript
// sobelX — change offset: 0 to offset: 128
.convolve({ width: 3, height: 3, kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1], scale: 1, offset: 128 })

// sobelY — same
.convolve({ width: 3, height: 3, kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1], scale: 1, offset: 128 })
```

No other changes needed — the magnitude loop already does `gx = buf[i] - 128`.

**Verification:** Export with `edgeFadeStrength > 0`. Inspect that text/line edges produce a visible bright halo in the mask, and flat-color fills produce near-zero mask values.

---

### Fix 2: `applyCalibration` ignores `outputScale`

**File:** `src/renderer/hooks/useCalibration.ts`
**Impact:** If the user changed `outputScale` (print size %) before calibrating, the computed DPI is wrong by a factor of `outputScale`. Calibration is the foundation of the whole app — a silent wrong result here cascades to every measurement, tile count, and PDF output.

**Root cause:**
`computeDpiFromTwoPoints` returns `pixelDist * 25.4 / realWorldMm`. This is correct only when `outputScale = 1.0`. At `outputScale = k`, the same pixel distance represents `k × more` real-world distance in the final print, so the formula should be `pixelDist * 25.4 * outputScale / realWorldMm`. Equivalently: after setting the new DPI, reset `outputScale` to 1.0 — the user was effectively rescaling the print, so the DPI absorbs it.

**Preferred fix — reset outputScale to 1.0 after calibrating:**

```typescript
function applyCalibration(distanceMm: number) {
  if (!store.calibrationPoint1 || !store.calibrationPoint2) return
  try {
    const newDpi = computeDpiFromTwoPoints({
      point1Px: { x: store.calibrationPoint1.xPx, y: store.calibrationPoint1.yPx },
      point2Px: { x: store.calibrationPoint2.xPx, y: store.calibrationPoint2.yPx },
      realWorldDistanceMm: distanceMm
    })
    store.setScale({
      dpi: Math.round(newDpi * 100) / 100,
      outputScale: 1.0,          // ← reset: calibration absorbs any prior scale factor
      printerScaleX: 1.0,        // ← reset printer stretch corrections too (new calibration = fresh baseline)
      printerScaleY: 1.0,
    })
    store.resetCalibration()
  } catch (err) {
    alert(String(err))
    store.resetCalibration()
  }
}
```

**Challenge to this approach:** Resetting `printerScaleX/Y` may be too aggressive — the user may have painstakingly calibrated those for their specific printer. Alternative: only reset `outputScale`, leave printer scales alone. Decision call for you; the minimum safe fix is just `outputScale: 1.0`.

**Verification:** Set `outputScale` to 1.5. Perform calibration. Confirm the displayed physical dimensions of the image match expectation (not 1.5× off).

---

## P1 — Feature Gaps vs Original BigPrint

---

### Fix 3: `edgeFadeRadius` — display/input in mm, convert to px at runtime

**Files:** `src/renderer/components/InkSaverSettings.tsx`, `src/shared/ipc-types.ts`, `src/main/image/InkSaver.ts`

**Impact:** The blur radius that controls how far edge influence spreads is specified in source pixels. At 300 DPI the physical zone is tiny; at 72 DPI it's enormous. The same setting produces completely different visual results at different image resolutions.

**Type change in `ipc-types.ts`:**
```typescript
export interface InkSaverSettings {
  // ...
  edgeFadeRadiusMm: number   // rename from edgeFadeRadius (was px)
}
```

**Runtime conversion in `InkSaver.ts`:**
```typescript
// Needs dpi passed in, or compute from widthPx/naturalWidthPx
// Option A: pass dpi through InkSaverInput
export interface InkSaverInput {
  inputBuffer: Buffer
  widthPx: number
  heightPx: number
  dpi: number                // add this
  settings: InkSaverSettings
}

// In applyEdgeFade:
const blurRadiusPx = Math.max(1, Math.round((settings.edgeFadeRadiusMm / 25.4) * dpi))
```

**UI change in `InkSaverSettings.tsx`:**
- Change label from `"Edge detection radius (px)"` to `"Edge-fade radius"`
- Change `NumericInput` unit from `"px"` to `"mm"`
- Update min/max to sensible mm values (e.g. min=0.5, max=20, step=0.5, default=2)
- Update store default: `edgeFadeRadiusMm: 2` (≈2mm at any DPI)

**Store default update in `appStore.ts`:**
```typescript
inkSaver: {
  // ...
  edgeFadeRadiusMm: 2,    // was edgeFadeRadius: 8 (px)
}
```

**Auto-mode preset update** — `InkSaverSettings.tsx` hint text should say e.g. `"edge-fade 55%, radius 2mm"`.

**Everywhere `InkSaver.ts` is called** — verify `dpi` is threaded through. Check `PDFEngine.ts` and any preview path.

---

### Fix 4: `suppressOverImage` — implement in PDF renderer

**File:** `src/main/pdf/GridRenderer.ts`

**Current state:** The `suppressOverImage` flag is stored and toggled in UI but `renderGridOnPage` ignores it entirely.

**Intent (from original BigPrint):** When enabled, grid lines are drawn only in the overlap margin strips — not over the image content itself. This keeps the image clean while still providing alignment guides in the bleed zone.

**Implementation approach using pdf-lib clipping:**

```typescript
function renderHorizontalGrid(params: GridRenderParams): void {
  const { page, tile, grid, paperWidthMm, paperHeightMm, mmPerPx } = params

  // ... (existing phase calculation) ...

  // Determine clip region
  if (grid.suppressOverImage) {
    // Compute where the image lives on this tile in mm
    // clip = union of four margin strips (top, bottom, left, right)
    // This requires knowing the image bounds on the page
    // → need imageOffsetXMm, imageOffsetYMm, imageWidthMm, imageHeightMm per tile
    // These come from: tile.srcX, tile.srcW, mmPerPx, centering offset
    // Draw only outside that rect (use clip path around the margins)
    applyMarginClip(page, /* image rect in page coords */)
  }

  drawGridLines(page, /* ... */)

  if (grid.suppressOverImage) {
    restoreClip(page)
  }
}
```

**Data needed:** `renderGridOnPage` currently receives `tile: TilePosition`, `mmPerPx`, and paper dimensions. The image rect on the page can be derived:
```
imageXOnPageMm = tile.marginLeftMm + centerOffsetXMm   // if centering is on
imageYOnPageMm = tile.marginTopMm  + centerOffsetYMm
imageWOnPageMm = tile.srcW * mmPerPx * scale.printerScaleX
imageHOnPageMm = tile.srcH * mmPerPx * scale.printerScaleY
```

**pdf-lib clip approach:**
pdf-lib doesn't export individual operators as named functions. Use `page.pushOperators()` with raw PDF operator strings `q` / `W` / `n` / `Q` to push/pop a clipping path. This is the most reliable approach given pdf-lib's limited low-level API exposure.

**Complexity rating:** Medium-high. Requires threading centering offset and printer scale into `GridRenderParams`, and generating correct clip paths in PDF coordinate space (Y-flipped).

**Suggested: defer to P3 if timeline is tight** — the feature is obscure and the UI lets users turn it off. Mark it with a TODO comment.

---

### Fix 5: `extendBeyondImage: false` — implement clipping in PDF renderer

**File:** `src/main/pdf/GridRenderer.ts`

**Current state:** `extendBeyondImage` is stored and toggled but `renderHorizontalGrid` and `renderDiagonalGrid` ignore it, always drawing grid across the full page.

**Intent:** When false, grid lines stop at the image boundary and don't extend into the page margin / background outside the image.

**Implementation:** Same clip-path mechanism as Fix 4 but inverted — clip to the image rect (instead of excluding it). Can reuse the same clip infrastructure.

**Complexity:** Same as Fix 4. These two fixes should be done together since they share all the clip machinery.

**Suggested: defer to P3 together with Fix 4.**

---

### Fix 6: Drag-to-reposition calibration crosshairs

**Files:** `src/renderer/hooks/useCalibration.ts`, `src/renderer/components/PreviewCanvas.tsx` (or wherever canvas mouse events are handled)

**Current state:** Calibration is click-point-1 → click-point-2 → dialog → apply. Points cannot be moved after placement.

**Original BigPrint behavior (per tutorial):** After both points are placed, they show as crosshairs that can be dragged to fine-tune position before entering the distance.

**New state machine:**
```
idle → point1 → point2 → adjusting → dialog
```

In `adjusting` state:
- Both crosshairs are rendered on the canvas
- Mouse down within N px of a crosshair → begin dragging that crosshair
- Mouse move → update crosshair position
- Mouse up → release
- "Enter distance" button (or double-click) → open dialog → apply

**Store additions needed:**
```typescript
// In AppState
calibrationMode: 'idle' | 'point1' | 'point2' | 'adjusting'
calibrationDragging: null | 1 | 2    // which crosshair is being dragged
```

**Hook changes (`useCalibration.ts`):**
```typescript
function handleCanvasClick(imageX: number, imageY: number) {
  if (store.calibrationMode === 'point1') {
    store.setCalibrationPoint1({ xPx: imageX, yPx: imageY })
    store.setCalibrationMode('point2')
  } else if (store.calibrationMode === 'point2') {
    store.setCalibrationPoint2({ xPx: imageX, yPx: imageY })
    store.setCalibrationMode('adjusting')   // ← was 'idle' + show dialog
    // Dialog shown only after user confirms adjustment
  } else if (store.calibrationMode === 'adjusting') {
    // click in open space = no-op; drag is handled separately
  }
}

function handleCanvasMouseDown(imageX: number, imageY: number) { ... }
function handleCanvasMouseMove(imageX: number, imageY: number) { ... }
function handleCanvasMouseUp() { ... }
function confirmCalibrationPoints() {
  store.setShowCalibrationDialog(true)
}
```

**Preview canvas rendering:** Draw crosshair overlays at both points when `calibrationMode === 'adjusting'`. Highlight the point being hovered within drag radius.

**Complexity:** Medium. Requires new mouse events in canvas handler, new state fields, and crosshair rendering. Crosshair rendering can reuse the existing calibration point visualization.

---

### Fix 7: Ink saver live preview

**Current state:** Ink saver runs only in the PDF export/print path via `applyInkSaver()` in the main process. The preview canvas shows the raw image regardless of ink saver settings.

**Desired:** Preview canvas (or a small preview thumbnail in the settings panel) reflects ink saver output so the user can tune without printing.

**Architecture options:**

**Option A — Process on every preview render (simplest, potentially slow):**
- In `usePreviewRenderer.ts`, after loading the image, call IPC to apply ink saver to a downsampled version
- Cache the processed buffer; invalidate when ink saver settings change
- Display processed image on canvas

**Option B — Dedicated preview thumbnail in InkSaverSettings (recommended):**
- Add a small `<canvas>` or `<img>` at the bottom of the ink saver settings panel
- When ink saver is enabled and any setting changes, IPC to main → `applyInkSaver` on a 200px-wide downsampled crop → return data URL → display
- Debounce 300ms on setting changes

**IPC additions needed:**
```typescript
// ipc-types.ts
export interface InkSaverPreviewRequest {
  sourceId: string         // current source image identifier
  settings: InkSaverSettings
  dpi: number
  maxWidthPx: number       // e.g. 300
}
export interface InkSaverPreviewResponse {
  dataUrl: string          // PNG data URL of processed thumbnail
}
```

**Main process handler:**
```typescript
// In ipc-handlers or a new inkSaverHandlers.ts
ipcMain.handle('inksaver:preview', async (_, req: InkSaverPreviewRequest) => {
  const source = getSourceById(req.sourceId)   // from image cache
  const thumbnail = await sharp(source.buffer)
    .resize({ width: req.maxWidthPx, fit: 'inside' })
    .png()
    .toBuffer()
  const processed = await applyInkSaver({
    inputBuffer: thumbnail,
    widthPx: ..., heightPx: ...,
    dpi: req.dpi,
    settings: req.settings
  })
  return { dataUrl: `data:image/png;base64,${processed.toString('base64')}` }
})
```

**Complexity:** Medium. Requires new IPC channel + source image access in main process + debounced call in React component.

**Anti-pattern warning:** Do NOT run `applyInkSaver` synchronously in the renderer process — it's CPU-bound image processing and will freeze the UI. Always run in main process via IPC.

---

### Fix 8: Crop edge-drag fine adjustment

**Current state:** Crop mode places the crop rectangle by click-drag. After placement the crop cannot be fine-tuned by dragging its edges.

**Original BigPrint behavior:** After initial crop drag, the four edges and four corners of the crop rectangle can each be dragged individually to shrink/grow the crop.

**New interaction states for crop mode:**
```
'crop-idle' → 'crop-drawing' (on mousedown outside rect)
           → 'crop-adjusting' (after mouseup with valid rect)
             → 'crop-edge-drag:left|right|top|bottom|tl|tr|bl|br' (on mousedown near edge/corner)
```

**Hit-test helper:**
```typescript
type CropHandle = 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br' | 'body' | null

function hitTestCropHandle(
  mouseX: number, mouseY: number,
  crop: CropRect,                  // in canvas coordinates
  hitRadius: number = 8            // px
): CropHandle { ... }
```

**Canvas rendering:** Draw resize handles (small squares) at edges and corners when in `crop-adjusting` state. Change cursor based on hovered handle.

**Complexity:** Medium-high. Requires significant expansion of the crop mouse-event handling, hit-testing, and canvas overlay rendering.

---

## Implementation Order (recommended)

```
Sprint 1 — P0 bugs (< 1 hour total, zero risk)
  Fix 1: InkSaver.ts offset: 0 → 128          (5 min)
  Fix 2: useCalibration.ts outputScale reset   (15 min)

Sprint 2 — High-value UX (1-2 days)
  Fix 3: edgeFadeRadius → mm                   (2-3 hours, touches 4 files)
  Fix 7: Ink saver live preview thumbnail      (half-day)

Sprint 3 — Calibration UX (1-2 days)
  Fix 6: Drag-to-reposition calibration        (1 day)

Sprint 4 — Crop UX (1-2 days)
  Fix 8: Crop edge-drag fine adjustment        (1-2 days)

Sprint 5 — Deferred (complex, low user impact)
  Fix 4 + 5: suppressOverImage + extendBeyondImage PDF clipping
             (do together; complex PDF operator work)
```

---

## Open Challenges / Anti-patterns to Avoid

**1. Preview performance:** Don't apply ink saver pixel processing in the renderer thread. Always IPC to main. Cache processed results keyed by `(settingsHash, sourceId, maxWidth)`.

**2. Calibration UX ordering:** The tutorial shows calibrating as the *first* step after opening an image. Consider whether to force `outputScale = 1.0` before entering calibration mode (prompt user) vs silently resetting. Silent reset is less confusing.

**3. PDF clipping in pdf-lib:** pdf-lib doesn't expose `q/W/n/Q` as named exports. You'll need to use raw operator pushes: `page.pushOperators(pushGraphicsState(), ...)`. Test this carefully — an unclosed graphics state in PDF will corrupt the entire page rendering.

**4. Crop handle hit-radius:** Use display pixels (8-10px) not source image pixels for the hit radius. The canvas is zoomed; hit radius in source-image coordinates would be enormous at low zoom.

**5. `edgeFadeRadiusMm` migration:** If there's any persisted state (localStorage, config file), add a migration that converts old `edgeFadeRadius` (px) to `edgeFadeRadiusMm` assuming 96 DPI (screen default).
```


import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../../src/renderer/store/appStore'

// Regression for L4 (orientation-flip printer-scale corruption). Previously
// `handleOrientationChange` swapped printerScaleX ↔ printerScaleY on every
// flip, then the debounced preferences save persisted the swapped values. A
// user toggling orientation to preview then flipping back ended up with
// (y, x) as the new baseline. The fix removes the swap — orientation is now
// a pure tiling change.

const initial = useAppStore.getState()

describe('orientation flip does not mutate printerScaleX/Y', () => {
  beforeEach(() => {
    useAppStore.setState({
      scale: { ...initial.scale, printerScaleX: 1.02, printerScaleY: 1.0 },
      tiling: { ...initial.tiling, orientation: 'portrait' },
    })
  })

  it('flipping to landscape leaves printer scales untouched', () => {
    useAppStore.getState().setTiling({ orientation: 'landscape' })
    const s = useAppStore.getState().scale
    expect(s.printerScaleX).toBe(1.02)
    expect(s.printerScaleY).toBe(1.0)
  })

  it('two flips round-trip to the original values (no silent swap)', () => {
    useAppStore.getState().setTiling({ orientation: 'landscape' })
    useAppStore.getState().setTiling({ orientation: 'portrait' })
    const s = useAppStore.getState().scale
    expect(s.printerScaleX).toBe(1.02)
    expect(s.printerScaleY).toBe(1.0)
  })
})

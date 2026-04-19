import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../../src/renderer/store/appStore'

// Snapshot the initial state so we can reset the store between tests without
// leaking setSelectedPages/toggleSelectedPage side-effects across cases.
const initial = useAppStore.getState()

describe('appStore.toggleSelectedPage', () => {
  beforeEach(() => {
    // Reset only the page-selection slice — other tests may run in the same
    // process, so a full reset would be heavy-handed.
    useAppStore.setState({ selectedPages: initial.selectedPages })
  })

  it('reshapes selectedPages when the grid dimensions change', () => {
    // Start with a 2×2 selection where one cell is disabled.
    useAppStore.setState({
      selectedPages: [
        [true, false],
        [true, true],
      ],
    })
    // Toggle a cell using NEW dimensions (3×3). The guard in toggleSelectedPage
    // must re-initialise the array to 3×3 rather than access row 5 out of bounds.
    useAppStore.getState().toggleSelectedPage(2, 2, 3, 3)
    const s = useAppStore.getState().selectedPages
    // Result: a 3×3 array (new dims), with (2,2) toggled off.
    expect(s).not.toBeNull()
    expect(s!.length).toBe(3)
    expect(s!.every(row => row.length === 3)).toBe(true)
    expect(s![2]![2]).toBe(false)
    // All other cells are true (fresh init + single toggle).
    let enabledCount = 0
    for (const row of s!) for (const cell of row) if (cell) enabledCount++
    expect(enabledCount).toBe(8) // 9 cells - 1 toggled off
  })

  it('does not access out-of-range indices when coords exceed new grid dims', () => {
    // If the user's click fell on a cell outside the new grid (e.g. the grid
    // shrank between click and dispatch), the action must not throw. The
    // current implementation initialises the array to the new dims, then the
    // `if (!target) return` early-exit skips the collapse check — so the
    // reshaped all-true array remains in place, rather than collapsing back
    // to null. That's acceptable; the crucial property is no out-of-range
    // access and no throw.
    useAppStore.setState({ selectedPages: null })
    expect(() => useAppStore.getState().toggleSelectedPage(99, 99, 2, 2)).not.toThrow()
    const s = useAppStore.getState().selectedPages
    expect(s).not.toBeNull()
    expect(s!.length).toBe(2)
    expect(s!.every(row => row.length === 2 && row.every(Boolean))).toBe(true)
  })

  it('collapses selectedPages to null when every cell is true after a toggle', () => {
    // Start with one cell disabled; toggling it on should collapse to null.
    useAppStore.setState({
      selectedPages: [
        [true, false],
        [true, true],
      ],
    })
    useAppStore.getState().toggleSelectedPage(0, 1, 2, 2)
    expect(useAppStore.getState().selectedPages).toBeNull()
  })

  it('retains the array (does not collapse) when toggling the last true cell off', () => {
    // Leave the array shape intact when the selection goes to all-false so
    // the UI can still show the per-page grid without re-creating state.
    useAppStore.setState({
      selectedPages: [
        [true, false],
        [false, false],
      ],
    })
    useAppStore.getState().toggleSelectedPage(0, 0, 2, 2)
    const s = useAppStore.getState().selectedPages
    expect(s).not.toBeNull()
    expect(s!.flat().every(v => v === false)).toBe(true)
  })
})

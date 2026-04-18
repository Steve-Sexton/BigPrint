import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

// Hoist the shared ref above `vi.mock` so the factory can safely read it.
const state = vi.hoisted(() => ({ tmpRoot: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.tmpRoot },
}))

import { PreferencesStore } from '../../src/main/preferences/PreferencesStore'
import type { AppPreferences } from '../../src/shared/ipc-types'

const validPrefs: AppPreferences = {
  tiling: {
    paperSizeId: 'letter', orientation: 'portrait',
    overlapMmTop: 10, overlapMmRight: 10, overlapMmBottom: 10, overlapMmLeft: 10,
    showOverlapArea: true, skipBlankPages: true, centerImage: false,
  },
  grid: {
    showGrid: true, showGridDiagonals: true, diagonalSpacingMm: 50,
    showCutMarks: true, showPageLabels: true, labelStyle: 'grid',
    alignToImage: true, extendBeyondImage: true, suppressOverImage: false,
    showScaleAnnotation: false,
  },
  inkSaver: { enabled: false, brightness: 100, gamma: 1.8, edgeFadeStrength: 0, edgeFadeRadiusMm: 2 },
  inkSaverPreset: 'heavy',
  printerScaleX: 1.0, printerScaleY: 1.0,
}

describe('PreferencesStore', () => {
  beforeEach(async () => {
    state.tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bigprint-prefs-'))
  })
  afterEach(async () => {
    await fs.rm(state.tmpRoot, { recursive: true, force: true })
  })

  it('load() returns null when the file does not exist', async () => {
    const result = await PreferencesStore.load()
    expect(result).toBeNull()
  })

  it('save() then load() round-trips a valid object', async () => {
    await PreferencesStore.save(validPrefs)
    const loaded = await PreferencesStore.load()
    expect(loaded).toEqual(validPrefs)
  })

  it('save() writes atomically — no .tmp file remains after success', async () => {
    await PreferencesStore.save(validPrefs)
    const files = await fs.readdir(state.tmpRoot)
    expect(files).toContain('preferences.json')
    expect(files.every(f => !f.endsWith('.tmp'))).toBe(true)
  })

  it('load() returns null and preserves corrupt JSON on parse failure', async () => {
    const target = path.join(state.tmpRoot, 'preferences.json')
    await fs.writeFile(target, '{ "tiling": ', 'utf-8')
    const result = await PreferencesStore.load()
    expect(result).toBeNull()
    const files = await fs.readdir(state.tmpRoot)
    expect(files.some(f => f.startsWith('preferences.json.corrupt-'))).toBe(true)
  })

  it('load() returns null and preserves the file on validation failure', async () => {
    const target = path.join(state.tmpRoot, 'preferences.json')
    // Valid JSON but missing required fields
    await fs.writeFile(target, JSON.stringify({ foo: 'bar' }), 'utf-8')
    const result = await PreferencesStore.load()
    expect(result).toBeNull()
    const files = await fs.readdir(state.tmpRoot)
    expect(files.some(f => f.startsWith('preferences.json.corrupt-'))).toBe(true)
  })

  it('save() refuses to persist invalid preferences', async () => {
    const bad = { ...validPrefs, printerScaleX: -1 } as AppPreferences
    await PreferencesStore.save(bad)
    // File should not exist — the save was a no-op
    const files = await fs.readdir(state.tmpRoot)
    expect(files).not.toContain('preferences.json')
  })
})

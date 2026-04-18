import { describe, it, expect } from 'vitest'
import { validateProjectData } from '../../src/main/project/ProjectFile'

// Minimal valid payload — individual tests clone it and mutate a single field
const validPayload = () => ({
  version: 1,
  scale: { dpi: 300, outputScale: 1.0, printerScaleX: 1.0, printerScaleY: 1.0 },
  tiling: {
    paperSizeId: 'letter',
    orientation: 'portrait' as const,
    overlapMmTop: 10, overlapMmRight: 10, overlapMmBottom: 10, overlapMmLeft: 10,
    showOverlapArea: true, skipBlankPages: true, centerImage: false,
  },
  grid: {
    showGrid: true, showGridDiagonals: false, diagonalSpacingMm: 50,
    showCutMarks: true, showPageLabels: true, labelStyle: 'grid' as const,
    alignToImage: true, extendBeyondImage: true, suppressOverImage: false,
    showScaleAnnotation: false,
  },
  inkSaver: { enabled: false, brightness: 100, gamma: 1.0, edgeFadeStrength: 0, edgeFadeRadiusMm: 2 },
})

describe('validateProjectData', () => {
  it('accepts a fully-formed payload', () => {
    expect(validateProjectData(validPayload())).toBeNull()
  })

  it('rejects non-object input', () => {
    expect(validateProjectData(null)).toMatch(/not a json object/i)
    expect(validateProjectData('string')).toMatch(/not a json object/i)
  })

  it('rejects missing version', () => {
    const p: Record<string, unknown> = validPayload()
    delete p.version
    expect(validateProjectData(p)).toMatch(/version/i)
  })

  it('rejects version = 0', () => {
    const p = validPayload()
    ;(p as any).version = 0
    expect(validateProjectData(p)).toMatch(/version/i)
  })

  it('rejects scale.dpi = 0', () => {
    const p = validPayload()
    ;(p as any).scale.dpi = 0
    const err = validateProjectData(p)
    expect(err).toMatch(/scale\.dpi/i)
  })

  it('rejects scale.dpi = 10000 (above 9600)', () => {
    const p = validPayload()
    ;(p as any).scale.dpi = 10000
    expect(validateProjectData(p)).toMatch(/scale\.dpi/i)
  })

  it('rejects scale.outputScale <= 0', () => {
    const p = validPayload()
    ;(p as any).scale.outputScale = -1
    expect(validateProjectData(p)).toMatch(/scale\.outputScale/i)
  })

  it('rejects scale.printerScaleX = 0', () => {
    const p = validPayload()
    ;(p as any).scale.printerScaleX = 0
    expect(validateProjectData(p)).toMatch(/scale\.printerScaleX/i)
  })

  it('rejects missing tiling block', () => {
    const p: Record<string, unknown> = validPayload()
    delete p.tiling
    expect(validateProjectData(p)).toMatch(/tiling/i)
  })

  it('rejects empty tiling.paperSizeId', () => {
    const p = validPayload()
    ;(p as any).tiling.paperSizeId = ''
    expect(validateProjectData(p)).toMatch(/paperSizeId/i)
  })

  it('rejects tiling.orientation = "diagonal"', () => {
    const p = validPayload()
    ;(p as any).tiling.orientation = 'diagonal'
    expect(validateProjectData(p)).toMatch(/orientation/i)
  })

  it('rejects string-typed overlapMmTop (extended validator)', () => {
    const p = validPayload()
    ;(p as any).tiling.overlapMmTop = '10'
    expect(validateProjectData(p)).toMatch(/overlapMmTop/i)
  })

  it('rejects missing grid block', () => {
    const p: Record<string, unknown> = validPayload()
    delete p.grid
    expect(validateProjectData(p)).toMatch(/grid/i)
  })

  it('rejects non-boolean grid.showGrid', () => {
    const p = validPayload()
    ;(p as any).grid.showGrid = 'yes'
    expect(validateProjectData(p)).toMatch(/grid\.showGrid/i)
  })

  it('rejects missing inkSaver block', () => {
    const p: Record<string, unknown> = validPayload()
    delete p.inkSaver
    expect(validateProjectData(p)).toMatch(/inkSaver/i)
  })

  it('rejects non-number inkSaver.brightness', () => {
    const p = validPayload()
    ;(p as any).inkSaver.brightness = '100'
    expect(validateProjectData(p)).toMatch(/inkSaver\.brightness/i)
  })
})

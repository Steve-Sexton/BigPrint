import { describe, it, expect } from 'vitest'
import {
  validateEnabledPages,
  validateCropRect,
  validateSourceBuffer,
  validateScale,
  validateExportParams,
  PRINTER_SCALE_MAX,
} from '../../src/shared/ipc-types'

// ── validateEnabledPages ───────────────────────────────────────────────────
// Covers T1: the shape of enabledPages crossing the IPC boundary must be
// checked before PDFEngine iterates it. A jagged array or a non-boolean cell
// would otherwise produce either a silent "disabled" (for numeric 0) or an
// "enabled" for any truthy value — including strings, objects, nested arrays.

describe('validateEnabledPages', () => {
  it('accepts null', () => {
    expect(validateEnabledPages(null)).toBeNull()
  })

  it('accepts undefined', () => {
    expect(validateEnabledPages(undefined)).toBeNull()
  })

  it('accepts a well-formed boolean matrix', () => {
    expect(validateEnabledPages([[true, false], [false, true]])).toBeNull()
  })

  it('rejects a non-array outer value', () => {
    expect(validateEnabledPages('nope')).toMatch(/array or null/)
    expect(validateEnabledPages(42)).toMatch(/array or null/)
  })

  it('rejects a non-array row', () => {
    expect(validateEnabledPages([[true], 'bad'])).toMatch(/enabledPages\[1\] must be an array/)
  })

  it('rejects a non-boolean cell', () => {
    expect(validateEnabledPages([[true, 1]])).toMatch(/\[0\]\[1\] must be a boolean/)
  })

  it('rejects a jagged matrix', () => {
    expect(validateEnabledPages([[true, false], [true]])).toMatch(/length 1 differs from row 0 \(2\)/)
  })
})

// ── validateCropRect ───────────────────────────────────────────────────────

describe('validateCropRect', () => {
  it('accepts null / undefined', () => {
    expect(validateCropRect(null)).toBeNull()
    expect(validateCropRect(undefined)).toBeNull()
  })

  it('accepts a well-formed rect', () => {
    expect(validateCropRect({ srcX: 0, srcY: 0, srcW: 100, srcH: 100 })).toBeNull()
  })

  it('rejects a negative offset', () => {
    expect(validateCropRect({ srcX: -1, srcY: 0, srcW: 100, srcH: 100 })).toMatch(/srcX/)
  })

  it('rejects zero width / height', () => {
    expect(validateCropRect({ srcX: 0, srcY: 0, srcW: 0, srcH: 100 })).toMatch(/srcW\/srcH must be > 0/)
  })

  it('rejects dimensions above the 20000 px cap', () => {
    expect(validateCropRect({ srcX: 0, srcY: 0, srcW: 21000, srcH: 100 })).toMatch(/srcW/)
  })
})

// ── validateSourceBuffer ───────────────────────────────────────────────────

describe('validateSourceBuffer', () => {
  it('accepts null / undefined', () => {
    expect(validateSourceBuffer(null)).toBeNull()
    expect(validateSourceBuffer(undefined)).toBeNull()
  })

  it('accepts a non-empty ArrayBuffer', () => {
    expect(validateSourceBuffer(new ArrayBuffer(16))).toBeNull()
  })

  it('rejects a non-ArrayBuffer', () => {
    // Uint8Array / Buffer are NOT ArrayBuffer — they share storage but are a
    // distinct type. The IPC contract is ArrayBuffer only.
    expect(validateSourceBuffer(new Uint8Array(16))).toMatch(/sourceBuffer must be an ArrayBuffer/)
    expect(validateSourceBuffer('string')).toMatch(/sourceBuffer must be an ArrayBuffer/)
  })

  it('rejects empty buffers', () => {
    expect(validateSourceBuffer(new ArrayBuffer(0))).toMatch(/must not be empty/)
  })
})

// ── validateScale printer-scale bounds ─────────────────────────────────────

describe('validateScale — printer-scale bounds (T3)', () => {
  const base = { dpi: 96, outputScale: 1, printerScaleX: 1, printerScaleY: 1 }

  it('accepts values within [0.5, 2]', () => {
    expect(validateScale({ ...base, printerScaleX: 0.5 })).toBeNull()
    expect(validateScale({ ...base, printerScaleX: 2 })).toBeNull()
    expect(validateScale({ ...base, printerScaleX: 1.02 })).toBeNull()
  })

  it('rejects a tiny value that would divide-by-near-zero in TilingCalculator', () => {
    expect(validateScale({ ...base, printerScaleX: 0.0001 })).toMatch(/printerScaleX/)
  })

  it('rejects a value above the upper bound', () => {
    expect(validateScale({ ...base, printerScaleX: PRINTER_SCALE_MAX + 0.1 })).toMatch(/printerScaleX/)
  })
})

// ── validateExportParams — integration ─────────────────────────────────────

describe('validateExportParams', () => {
  const validParams = {
    outputPath: '',
    scale: { dpi: 96, outputScale: 1, printerScaleX: 1, printerScaleY: 1 },
    tiling: {
      paperSizeId: 'letter', orientation: 'portrait',
      overlapMmTop: 0, overlapMmRight: 0, overlapMmBottom: 0, overlapMmLeft: 0,
      showOverlapArea: false, skipBlankPages: false, centerImage: false,
    },
    grid: {
      showGrid: false, showGridDiagonals: false, diagonalSpacingMm: 50,
      showCutMarks: false, showPageLabels: false, labelStyle: 'grid',
      alignToImage: false, extendBeyondImage: true, suppressOverImage: false,
      showScaleAnnotation: false,
    },
    inkSaver: { enabled: false, brightness: 100, gamma: 1, edgeFadeStrength: 0, edgeFadeRadiusMm: 0.5 },
  }

  it('accepts a well-formed minimal payload', () => {
    expect(validateExportParams(validParams)).toBeNull()
  })

  it('rejects a payload whose enabledPages is the wrong type', () => {
    expect(validateExportParams({ ...validParams, enabledPages: 'nope' })).toMatch(/enabledPages/)
  })

  it('rejects a payload whose cropRect has a negative offset', () => {
    expect(
      validateExportParams({ ...validParams, cropRect: { srcX: -1, srcY: 0, srcW: 10, srcH: 10 } })
    ).toMatch(/cropRect/)
  })

  it('rejects a payload whose sourceBuffer is not an ArrayBuffer', () => {
    expect(validateExportParams({ ...validParams, sourceBuffer: new Uint8Array(4) })).toMatch(/sourceBuffer/)
  })

  it('rejects a payload with a negative pdfPageIndex', () => {
    expect(validateExportParams({ ...validParams, pdfPageIndex: -1 })).toMatch(/pdfPageIndex/)
  })
})

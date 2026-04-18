import { describe, it, expect } from 'vitest'
import { getLabelForTile } from '../../src/shared/TilingCalculator'

describe('getLabelForTile — grid style', () => {
  it('produces A1 at the origin', () => {
    expect(getLabelForTile(0, 0, 1, 1, 'grid')).toBe('A1')
  })

  it('produces Z1 at row=25', () => {
    expect(getLabelForTile(25, 0, 100, 1, 'grid')).toBe('Z1')
  })

  it('rolls over to AA1 at row=26 (spreadsheet-style carry)', () => {
    expect(getLabelForTile(26, 0, 100, 1, 'grid')).toBe('AA1')
  })

  it('produces AZ1 at row=51 and BA1 at row=52', () => {
    expect(getLabelForTile(51, 0, 100, 1, 'grid')).toBe('AZ1')
    expect(getLabelForTile(52, 0, 100, 1, 'grid')).toBe('BA1')
  })

  it('produces ZZ1 at row=701 and AAA1 at row=702 (second rollover)', () => {
    expect(getLabelForTile(701, 0, 1000, 1, 'grid')).toBe('ZZ1')
    expect(getLabelForTile(702, 0, 1000, 1, 'grid')).toBe('AAA1')
  })

  it('uses 1-based column numbers', () => {
    expect(getLabelForTile(0, 4, 1, 10, 'grid')).toBe('A5')
  })
})

describe('getLabelForTile — sequential style', () => {
  it('produces "1 / 12" at the origin of a 3×4 grid', () => {
    expect(getLabelForTile(0, 0, 3, 4, 'sequential')).toBe('1 / 12')
  })

  it('produces "12 / 12" at the last cell of a 3×4 grid', () => {
    expect(getLabelForTile(2, 3, 3, 4, 'sequential')).toBe('12 / 12')
  })

  it('walks row-major (end of row 0 is index totalCols)', () => {
    expect(getLabelForTile(1, 0, 3, 4, 'sequential')).toBe('5 / 12')
  })
})

describe('getLabelForTile — negative inputs must not infinite-loop', () => {
  it('returns within a single tick for row = -1 (pins current behavior)', () => {
    // Pin current observed behavior: do-while terminates after one pass when
    // r=-1 (Math.floor(-1/26)-1 = -2 → loop exits). Completes effectively
    // instantly — the guard here asserts the label exists and is finite.
    const start = Date.now()
    const label = getLabelForTile(-1, 0, 10, 1, 'grid')
    expect(Date.now() - start).toBeLessThan(100)
    expect(typeof label).toBe('string')
    expect(label.length).toBeGreaterThan(0)
  })
})

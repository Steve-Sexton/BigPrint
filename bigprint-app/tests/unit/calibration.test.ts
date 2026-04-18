import { describe, it, expect } from 'vitest'
import { computeDpiFromTwoPoints } from '../../src/shared/calibration'

describe('computeDpiFromTwoPoints', () => {
  it('returns exactly 300 DPI for a horizontal 300 px span over 25.4 mm (1 inch)', () => {
    const dpi = computeDpiFromTwoPoints({
      point1Px: { x: 0, y: 0 },
      point2Px: { x: 300, y: 0 },
      realWorldDistanceMm: 25.4
    })
    expect(dpi).toBeCloseTo(300, 6)
  })

  it('uses Euclidean distance for diagonals (3-4-5 triangle ⇒ 500 px span)', () => {
    const dpi = computeDpiFromTwoPoints({
      point1Px: { x: 0, y: 0 },
      point2Px: { x: 300, y: 400 },
      realWorldDistanceMm: 25.4
    })
    expect(dpi).toBeCloseTo(500, 6)
  })

  it('throws a "< 1 px apart" error when the two points are too close', () => {
    expect(() =>
      computeDpiFromTwoPoints({
        point1Px: { x: 10, y: 10 },
        point2Px: { x: 10.4, y: 10.2 },
        realWorldDistanceMm: 100
      })
    ).toThrowError(/1 px apart/i)
  })

  it('throws a "< 1 mm" error when realWorldDistanceMm is too small', () => {
    expect(() =>
      computeDpiFromTwoPoints({
        point1Px: { x: 0, y: 0 },
        point2Px: { x: 300, y: 0 },
        realWorldDistanceMm: 0.5
      })
    ).toThrowError(/at least 1 mm/i)
  })

  it('throws when the two points are identical (captured by < 1 px branch)', () => {
    expect(() =>
      computeDpiFromTwoPoints({
        point1Px: { x: 50, y: 50 },
        point2Px: { x: 50, y: 50 },
        realWorldDistanceMm: 100
      })
    ).toThrow()
  })

  it('accepts realWorldDistanceMm = 1 (lower inclusive bound)', () => {
    // 100 px over 1 mm = 2540 DPI exactly
    const dpi = computeDpiFromTwoPoints({
      point1Px: { x: 0, y: 0 },
      point2Px: { x: 100, y: 0 },
      realWorldDistanceMm: 1
    })
    expect(dpi).toBeCloseTo(2540, 6)
  })

  it('accepts distancePx = 1 exactly (boundary at the "< 1 px" guard)', () => {
    // 1 px over 25.4 mm = 1 DPI
    const dpi = computeDpiFromTwoPoints({
      point1Px: { x: 0, y: 0 },
      point2Px: { x: 1, y: 0 },
      realWorldDistanceMm: 25.4
    })
    expect(dpi).toBeCloseTo(1, 6)
  })
})

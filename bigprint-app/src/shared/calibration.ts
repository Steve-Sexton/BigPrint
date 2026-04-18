export function computeDpiFromTwoPoints(params: {
  point1Px: { x: number; y: number }
  point2Px: { x: number; y: number }
  realWorldDistanceMm: number
}): number {
  const dx = params.point2Px.x - params.point1Px.x
  const dy = params.point2Px.y - params.point1Px.y
  const distancePx = Math.sqrt(dx * dx + dy * dy)

  if (distancePx < 1) {
    throw new Error(
      'Points are too close together for reliable calibration (< 1 px apart). Click two points further apart.'
    )
  }
  if (params.realWorldDistanceMm < 1) {
    throw new Error('Real-world distance must be at least 1 mm.')
  }

  return (distancePx * 25.4) / params.realWorldDistanceMm
}

export function mmToInch(mm: number): number {
  return mm / 25.4
}
export function inchToMm(inch: number): number {
  return inch * 25.4
}
export function cmToMm(cm: number): number {
  return cm * 10
}

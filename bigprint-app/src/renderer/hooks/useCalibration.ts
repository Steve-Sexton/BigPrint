import { useAppStore } from '../store/appStore'
import { computeDpiFromTwoPoints } from '../../shared/calibration'

export function useCalibration() {
  const store = useAppStore()

  function startCalibration() {
    store.resetCalibration()
    store.setCalibrationMode('point1')
  }

  function handleCanvasClick(imageX: number, imageY: number) {
    if (store.calibrationMode === 'point1') {
      store.setCalibrationPoint1({ xPx: imageX, yPx: imageY })
      store.setCalibrationMode('point2')
    } else if (store.calibrationMode === 'point2') {
      store.setCalibrationPoint2({ xPx: imageX, yPx: imageY })
      store.setCalibrationMode('idle')
      store.setShowCalibrationDialog(true)
    }
  }

  function applyCalibration(distanceMm: number) {
    if (!store.calibrationPoint1 || !store.calibrationPoint2) return
    try {
      const newDpi = computeDpiFromTwoPoints({
        point1Px: { x: store.calibrationPoint1.xPx, y: store.calibrationPoint1.yPx },
        point2Px: { x: store.calibrationPoint2.xPx, y: store.calibrationPoint2.yPx },
        realWorldDistanceMm: distanceMm
      })
      // Preserve the user's prior physical size by rebasing outputScale so the
      // product (25.4 / dpi) * outputScale is unchanged after DPI swaps. This
      // makes the calibration a pure "tell me the truth about scale" action
      // rather than a silent "reset scale to 1.0" — the printed dimensions
      // stay the same.
      const roundedDpi = Math.round(newDpi * 100) / 100
      const priorMmPerPx = (25.4 / store.scale.dpi) * store.scale.outputScale
      const newOutputScale = priorMmPerPx / (25.4 / roundedDpi)
      store.setScale({
        dpi: roundedDpi,
        outputScale: Math.max(0.01, Math.min(10, Math.round(newOutputScale * 10000) / 10000)),
      })
      // Keep calibration points visible on canvas as a reference annotation.
      store.setCalibrationMode('idle')
      store.setShowCalibrationDialog(false)
    } catch (err) {
      alert(String(err))
      store.resetCalibration()
    }
  }

  function cancelCalibration() {
    store.resetCalibration()
  }

  return { startCalibration, handleCanvasClick, applyCalibration, cancelCalibration }
}

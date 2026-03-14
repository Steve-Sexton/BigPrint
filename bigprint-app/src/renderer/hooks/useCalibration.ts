import { useAppStore } from '../store/appStore'
import { computeDpiFromTwoPoints, mmToInch } from '../../shared/calibration'

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
      // Reset outputScale to 1.0: calibration absorbs any prior scale factor.
      // Without this, if outputScale ≠ 1.0 the computed DPI is wrong by that factor.
      store.setScale({ dpi: Math.round(newDpi * 100) / 100, outputScale: 1.0 })
      // Keep calibration points visible on canvas as a reference annotation.
      // Just close the dialog and return to idle — don't clear the points.
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

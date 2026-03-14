import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import type { PrinterCalibration } from '../../shared/ipc-types'

type CalibrationMap = Record<string, PrinterCalibration>

function getFilePath(): string {
  return path.join(app.getPath('userData'), 'calibrations.json')
}

async function loadAll(): Promise<CalibrationMap> {
  try {
    const data = await fs.readFile(getFilePath(), 'utf-8')
    return JSON.parse(data) as CalibrationMap
  } catch {
    return {}
  }
}

async function saveAll(map: CalibrationMap): Promise<void> {
  await fs.writeFile(getFilePath(), JSON.stringify(map, null, 2), 'utf-8')
}

export const CalibrationStore = {
  async save(printerId: string, cal: PrinterCalibration): Promise<void> {
    const map = await loadAll()
    map[printerId] = cal
    await saveAll(map)
  },
  async load(printerId: string): Promise<PrinterCalibration | null> {
    const map = await loadAll()
    return map[printerId] ?? null
  }
}

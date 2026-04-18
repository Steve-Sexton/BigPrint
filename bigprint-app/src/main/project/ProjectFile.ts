import fs from 'fs/promises'
import type { ScaleSettings, TilingSettings, GridSettings, InkSaverSettings, SaveProjectParams, LoadProjectResult } from '../../shared/ipc-types'

const PROJECT_VERSION = 1

// Intentionally does NOT include any source-image path — per README, the
// .tilr file is a pure settings payload. This avoids leaking absolute local
// paths when users share projects.
interface ProjectData {
  version: number
  scale: ScaleSettings
  tiling: TilingSettings
  grid: GridSettings
  inkSaver: InkSaverSettings
}

// Validate that a loaded project file has the required structure and safe values.
// Returns a human-readable error string, or null if valid.
function validateProjectData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return 'Not a JSON object'

  const d = data as Record<string, unknown>

  if (typeof d['version'] !== 'number' || d['version'] < 1) return 'Missing or invalid version'

  // Validate scale
  const scale = d['scale'] as Record<string, unknown> | undefined
  if (!scale || typeof scale !== 'object') return 'Missing scale block'
  if (typeof scale['dpi'] !== 'number' || scale['dpi'] < 1 || scale['dpi'] > 9600)
    return `Invalid scale.dpi (${scale['dpi']}) — must be 1–9600`
  if (typeof scale['outputScale'] !== 'number' || scale['outputScale'] <= 0 || scale['outputScale'] > 10)
    return `Invalid scale.outputScale (${scale['outputScale']}) — must be > 0 and ≤ 10`
  if (typeof scale['printerScaleX'] !== 'number' || scale['printerScaleX'] <= 0)
    return `Invalid scale.printerScaleX`
  if (typeof scale['printerScaleY'] !== 'number' || scale['printerScaleY'] <= 0)
    return `Invalid scale.printerScaleY`

  // Validate tiling
  const tiling = d['tiling'] as Record<string, unknown> | undefined
  if (!tiling || typeof tiling !== 'object') return 'Missing tiling block'
  if (typeof tiling['paperSizeId'] !== 'string' || !tiling['paperSizeId'])
    return 'Missing tiling.paperSizeId'

  // Validate grid
  const grid = d['grid'] as Record<string, unknown> | undefined
  if (!grid || typeof grid !== 'object') return 'Missing grid block'

  // Validate inkSaver
  const inkSaver = d['inkSaver'] as Record<string, unknown> | undefined
  if (!inkSaver || typeof inkSaver !== 'object') return 'Missing inkSaver block'

  return null
}

export async function saveProject(filePath: string, params: SaveProjectParams): Promise<void> {
  const data: ProjectData = {
    version: PROJECT_VERSION,
    scale: params.scale,
    tiling: params.tiling,
    grid: params.grid,
    inkSaver: params.inkSaver
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export async function loadProject(filePath: string): Promise<LoadProjectResult> {
  const raw = await fs.readFile(filePath, 'utf-8')
  const data: unknown = JSON.parse(raw)

  const validationError = validateProjectData(data)
  if (validationError) throw new Error(`Invalid project file: ${validationError}`)

  const d = data as ProjectData
  return {
    scale: d.scale,
    tiling: d.tiling,
    grid: d.grid,
    inkSaver: d.inkSaver
  }
}

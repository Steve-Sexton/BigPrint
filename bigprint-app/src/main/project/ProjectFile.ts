import fs from 'fs/promises'
import type { ScaleSettings, TilingSettings, GridSettings, InkSaverSettings, SaveProjectParams, LoadProjectResult } from '../../shared/ipc-types'
import { validateScale, validateTiling, validateGrid, validateInkSaver } from '../../shared/ipc-types'

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
export function validateProjectData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return 'Not a JSON object'
  const d = data as Record<string, unknown>

  if (typeof d['version'] !== 'number' || d['version'] < 1) return 'Missing or invalid version'

  const s = validateScale(d['scale']);      if (s) return s
  const t = validateTiling(d['tiling']);    if (t) return t
  const g = validateGrid(d['grid']);        if (g) return g
  const i = validateInkSaver(d['inkSaver']); if (i) return i

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

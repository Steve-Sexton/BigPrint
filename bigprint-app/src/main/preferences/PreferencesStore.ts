import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import type { AppPreferences } from '../../shared/ipc-types'

function getFilePath(): string {
  return path.join(app.getPath('userData'), 'preferences.json')
}

export const PreferencesStore = {
  async load(): Promise<AppPreferences | null> {
    try {
      const data = await fs.readFile(getFilePath(), 'utf-8')
      return JSON.parse(data) as AppPreferences
    } catch {
      // File doesn't exist yet (first launch) or is malformed — return null
      // so the renderer falls back to its built-in DEFAULT_STATE.
      return null
    }
  },

  async save(prefs: AppPreferences): Promise<void> {
    try {
      await fs.writeFile(getFilePath(), JSON.stringify(prefs, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[PreferencesStore] Failed to save preferences:', err)
    }
  }
}

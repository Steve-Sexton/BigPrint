import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import type { AppPreferences } from '../../shared/ipc-types'
import { validateAppPreferences } from '../../shared/ipc-types'

function getFilePath(): string {
  return path.join(app.getPath('userData'), 'preferences.json')
}

// Atomic write: write to `<file>.tmp`, fsync, then rename. A crash mid-write
// leaves either the old file intact or the new file in place — never a
// truncated JSON that would make `load()` silently lose user settings.
async function atomicWrite(target: string, body: string): Promise<void> {
  const tmp = target + '.tmp'
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(body, 'utf-8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fs.rename(tmp, target)
}

export const PreferencesStore = {
  async load(): Promise<AppPreferences | null> {
    const target = getFilePath()
    let data: string
    try {
      data = await fs.readFile(target, 'utf-8')
    } catch {
      // File doesn't exist yet (first launch) — fall back to built-in defaults.
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch (err) {
      // Malformed JSON — preserve the file for manual recovery and fall back
      // to defaults rather than silently losing user settings on rewrite.
      await preserveCorrupt(target, `parse error: ${String(err)}`)
      return null
    }
    const validationError = validateAppPreferences(parsed)
    if (validationError) {
      await preserveCorrupt(target, `validation error: ${validationError}`)
      return null
    }
    return parsed as AppPreferences
  },

  async save(prefs: AppPreferences): Promise<void> {
    // Reject obviously bad writes up-front so corruption can't be introduced
    // through a compromised renderer (the IPC handler also validates, but this
    // is defense-in-depth).
    const err = validateAppPreferences(prefs)
    if (err) {
      console.warn('[PreferencesStore] Refusing to save invalid preferences:', err)
      return
    }
    try {
      await atomicWrite(getFilePath(), JSON.stringify(prefs, null, 2))
    } catch (err) {
      console.warn('[PreferencesStore] Failed to save preferences:', err)
    }
  }
}

async function preserveCorrupt(target: string, reason: string): Promise<void> {
  try {
    const backup = `${target}.corrupt-${Date.now()}`
    await fs.copyFile(target, backup)
    console.warn(`[PreferencesStore] Preferences unreadable (${reason}); preserved at ${backup}`)
  } catch (err) {
    console.warn('[PreferencesStore] Failed to preserve corrupt preferences file:', err)
  }
}

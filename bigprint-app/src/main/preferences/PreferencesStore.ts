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
// Throws on any filesystem failure. Cleans up the .tmp file if rename fails.
async function atomicWrite(target: string, body: string): Promise<void> {
  const tmp = target + '.tmp'
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(body, 'utf-8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await fs.rename(tmp, target)
  } catch (err) {
    // Rename failed (e.g. EACCES from AV lock, disk full after fsync) — best
    // effort to remove the orphan .tmp so it doesn't accumulate forever.
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
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
      // Moves (rename) the bad file aside so subsequent loads don't keep
      // producing fresh .corrupt-* backups of the same broken content.
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

  /**
   * Persist preferences to disk.
   *
   * Failure modes:
   *  - Validation failure (schema mismatch): logs a warning and resolves
   *    without writing. The caller receives no error — this is treated as
   *    defence-in-depth against a compromised renderer, not an I/O failure.
   *  - Disk failure (permission / disk full / antivirus lock): throws. The
   *    IPC handler propagates the error to the renderer so the user can be
   *    told that their settings were not saved.
   */
  async save(prefs: AppPreferences): Promise<void> {
    const err = validateAppPreferences(prefs)
    if (err) {
      console.warn('[PreferencesStore] Refusing to save invalid preferences:', err)
      return
    }
    await atomicWrite(getFilePath(), JSON.stringify(prefs, null, 2))
  },
}

async function preserveCorrupt(target: string, reason: string): Promise<void> {
  try {
    const backup = `${target}.corrupt-${Date.now()}`
    // Rename (not copy) so next load() doesn't rediscover the same corrupt
    // file and produce an unbounded series of .corrupt-<ts> backups.
    await fs.rename(target, backup)
    console.warn(`[PreferencesStore] Preferences unreadable (${reason}); moved to ${backup}`)
  } catch (err) {
    console.warn('[PreferencesStore] Failed to preserve corrupt preferences file:', err)
  }
}

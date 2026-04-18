import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'

const SRC_ROOT = path.join(__dirname, '..', '..', 'src')

async function readAll(p: string): Promise<string> {
  return fs.readFile(p, 'utf-8')
}

function extract(src: string, re: RegExp): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(re)) {
    out.add(m[1])
  }
  return Array.from(out).sort()
}

describe('IPC contract: preload invokes === main handle', () => {
  it('every ipcMain.handle channel has a matching ipcRenderer.invoke in preload', async () => {
    const main = await readAll(path.join(SRC_ROOT, 'main', 'ipc', 'handlers.ts'))
    const preload = await readAll(path.join(SRC_ROOT, 'preload', 'index.ts'))

    const mainChannels  = extract(main,    /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)
    const preloadChannels = extract(preload, /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)

    expect(mainChannels.length).toBeGreaterThan(0)
    expect(preloadChannels.length).toBeGreaterThan(0)
    expect(preloadChannels).toEqual(mainChannels)
  })
})

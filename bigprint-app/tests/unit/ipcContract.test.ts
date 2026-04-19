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
    out.add(m[1]!)
  }
  return Array.from(out).sort()
}

/** Count the number of positional args beyond `channel` / `event` in an IPC call. */
function extractArityMap(src: string, re: RegExp): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of src.matchAll(re)) {
    const channel = m[1]!
    const argList = (m[2] ?? '').trim()
    if (argList.length === 0) {
      out.set(channel, 0)
      continue
    }
    // Count top-level commas (not inside parens/brackets/braces) to get positional arity.
    let depth = 0
    let count = 1
    for (const ch of argList) {
      if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++
      else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth--
      else if (ch === ',' && depth === 0) count++
    }
    out.set(channel, count)
  }
  return out
}

describe('IPC contract: preload invokes === main handle', () => {
  it('every ipcMain.handle channel has a matching ipcRenderer.invoke in preload', async () => {
    const main = await readAll(path.join(SRC_ROOT, 'main', 'ipc', 'handlers.ts'))
    const preload = await readAll(path.join(SRC_ROOT, 'preload', 'index.ts'))

    const mainChannels = extract(main, /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)
    const preloadChannels = extract(preload, /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)

    expect(mainChannels.length).toBeGreaterThan(0)
    expect(preloadChannels.length).toBeGreaterThan(0)
    expect(preloadChannels).toEqual(mainChannels)
  })

  it('preload forwards the same number of positional args as the main handler accepts', async () => {
    const main = await readAll(path.join(SRC_ROOT, 'main', 'ipc', 'handlers.ts'))
    const preload = await readAll(path.join(SRC_ROOT, 'preload', 'index.ts'))

    // Handler signature: ipcMain.handle('channel', async (event, arg1, arg2) => { ... })
    // We capture everything inside the async-arrow-function's parameter list,
    // then drop the leading `event` parameter to count the renderer-facing args.
    const mainArity = new Map<string, number>()
    const handlerRe = /ipcMain\.handle\(\s*['"]([^'"]+)['"]\s*,\s*async\s*(?:\w+\s*)?\(([^)]*)\)/g
    for (const m of main.matchAll(handlerRe)) {
      const channel = m[1]!
      const paramList = (m[2] ?? '').trim()
      if (!paramList) {
        mainArity.set(channel, 0)
        continue
      }
      const params = paramList.split(/\s*,\s*/)
      // First param is `event` — drop it.
      mainArity.set(channel, Math.max(0, params.length - 1))
    }

    // Preload invocation: ipcRenderer.invoke('channel', arg1, arg2)
    const preloadArity = extractArityMap(
      preload,
      /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]\s*(?:,\s*([\s\S]*?))?\)/g
    )

    for (const [channel, mainCount] of mainArity) {
      const preloadCount = preloadArity.get(channel)
      expect(
        preloadCount,
        `preload must forward ${mainCount} args to '${channel}', got ${preloadCount}`
      ).toBe(mainCount)
    }
  })
})

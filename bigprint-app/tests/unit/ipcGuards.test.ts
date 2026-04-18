import { describe, it, expect, vi } from 'vitest'

// Mock electron (isValidFilePath / assertFilePath don't touch it, but the
// handlers module's transitive imports do).
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: () => {} },
  BrowserWindow: class {},
  dialog: {},
}))

import { isValidFilePath, assertFilePath } from '../../src/main/ipc/handlers'
import path from 'path'

describe('isValidFilePath', () => {
  it('accepts a plain absolute path', () => {
    // Use an OS-appropriate absolute path so test runs green on Windows too.
    const p = path.resolve('/tmp/sample.pdf')
    expect(isValidFilePath(p)).toBe(true)
  })

  it('rejects relative paths', () => {
    expect(isValidFilePath('./file.pdf')).toBe(false)
    expect(isValidFilePath('file.pdf')).toBe(false)
    expect(isValidFilePath('../../secret')).toBe(false)
  })

  it('rejects strings containing a null byte (path-truncation attack)', () => {
    const p = path.resolve('/tmp/foo.pdf\0.png')
    expect(isValidFilePath(p)).toBe(false)
  })

  it('rejects the empty string', () => {
    expect(isValidFilePath('')).toBe(false)
  })

  it('rejects non-string inputs', () => {
    expect(isValidFilePath(null)).toBe(false)
    expect(isValidFilePath(undefined)).toBe(false)
    expect(isValidFilePath(42)).toBe(false)
    expect(isValidFilePath({ filePath: '/tmp/x' })).toBe(false)
  })
})

describe('assertFilePath', () => {
  it('returns the path unchanged when valid', () => {
    const p = path.resolve('/tmp/ok.pdf')
    expect(assertFilePath(p)).toBe(p)
  })

  it('throws a descriptive error for invalid input', () => {
    expect(() => assertFilePath(null)).toThrowError(/Invalid file path/)
    expect(() => assertFilePath('')).toThrowError(/Invalid file path/)
    expect(() => assertFilePath('rel/path')).toThrowError(/Invalid file path/)
  })
})

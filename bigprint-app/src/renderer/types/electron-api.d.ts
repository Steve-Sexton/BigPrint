// Renderer-only augmentation of the preload-exposed API.
// The DOM-typed parts (File, Window) live here so that src/shared/ipc-types.ts
// stays DOM-free and compiles cleanly under tsconfig.node.json (which has no
// DOM lib). The preload re-declares the same `getPathForFile` shape locally.

import type { ElectronAPICore } from '../../shared/ipc-types'

export interface ElectronAPI extends ElectronAPICore {
  /** Resolve a dropped File to its absolute OS path. Returns '' for sandboxed
   *  files that have no backing path. Replaces the removed File.path property
   *  (removed from Electron 32+). */
  getPathForFile: (file: File) => string
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

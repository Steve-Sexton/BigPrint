import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ElectronAPI, ExportPDFParams, PrintParams, SaveProjectParams,
  TestGridParams, AppPreferences, FileFilter
} from '../shared/ipc-types'

const api: ElectronAPI = {
  openFile: () => ipcRenderer.invoke('file:open'),
  registerFile: (filePath: string) => ipcRenderer.invoke('file:register', filePath),

  saveProjectDialog: (data: SaveProjectParams) => ipcRenderer.invoke('project:save', data),
  loadProjectDialog: () => ipcRenderer.invoke('project:load'),

  getImageMeta: (filePath: string) => ipcRenderer.invoke('image:getMeta', filePath),
  getPreviewDataUrl: (filePath: string, maxSizePx: number) =>
    ipcRenderer.invoke('image:getPreview', filePath, maxSizePx),

  renderPDFPageDataUrl: (filePath: string, pageIndex: number, scale: number) =>
    ipcRenderer.invoke('pdf:renderPage', filePath, pageIndex, scale),

  getPDFPageCount: (filePath: string) =>
    ipcRenderer.invoke('pdf:getPageCount', filePath),

  getPDFBytes: (filePath: string) =>
    ipcRenderer.invoke('pdf:getBytes', filePath),

  exportPDF: (params: ExportPDFParams) => ipcRenderer.invoke('export:pdf', params),
  exportTestGrid: (params: TestGridParams) => ipcRenderer.invoke('export:testgrid', params),
  printDirect: (params: PrintParams) => ipcRenderer.invoke('print:direct', params),
  getSystemPrinters: () => ipcRenderer.invoke('print:getPrinters'),

  onThemeChange: (cb: (isDark: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isDark: boolean) => cb(isDark)
    ipcRenderer.on('theme:changed', handler)
    return () => ipcRenderer.removeListener('theme:changed', handler)
  },

  showSaveDialog: (defaultName: string, filters: FileFilter[]) =>
    ipcRenderer.invoke('dialog:showSave', defaultName, filters),

  loadPreferences: () =>
    ipcRenderer.invoke('preferences:load'),
  savePreferences: (prefs: AppPreferences) =>
    ipcRenderer.invoke('preferences:save', prefs),

  // File.path was removed in Electron 32+. Use webUtils from the preload to
  // resolve a dragged-in File to its on-disk path. Returns '' when the File
  // has no backing OS path (sandboxed picker results).
  getPathForFile: (file: File) => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

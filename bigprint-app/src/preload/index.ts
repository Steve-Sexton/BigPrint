import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, ExportPDFParams, PrintParams, SaveProjectParams, TestGridParams, AppPreferences } from '../shared/ipc-types'

const api: ElectronAPI = {
  openFile: () => ipcRenderer.invoke('file:open'),

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

  showSaveDialog: (defaultName: string, filters) =>
    ipcRenderer.invoke('dialog:showSave', defaultName, filters),

  loadPreferences: () =>
    ipcRenderer.invoke('preferences:load'),
  savePreferences: (prefs: AppPreferences) =>
    ipcRenderer.invoke('preferences:save', prefs)
}

contextBridge.exposeInMainWorld('electronAPI', api)

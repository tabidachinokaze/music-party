import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateState } from '../shared/updates'
import type { DesktopInfo, PlayerCommand } from '../shared/desktop'
import type { Bridge, Trace } from '../shared/types'
const bridge: Bridge = {
  call: (request) => ipcRenderer.invoke('api', request),
  onTrace(callback) {
    const listener = (_event: Electron.IpcRendererEvent, trace: Trace) => callback(trace)
    ipcRenderer.on('trace', listener)
    return () => ipcRenderer.removeListener('trace', listener)
  },
  exportTrace: () => ipcRenderer.invoke('export-trace'),
  sessionInfo: () => ipcRenderer.invoke('session-info'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  openProject: (link) => ipcRenderer.invoke('project-open', link),
  updateState: () => ipcRenderer.invoke('update-state'),
  updateAction: (action) => ipcRenderer.invoke('update-action', action),
  onUpdate(callback) {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on('update-state-changed', listener)
    return () => ipcRenderer.removeListener('update-state-changed', listener)
  },
  desktopInfo: () => ipcRenderer.invoke('desktop-info'),
  setFullScreen: (value) => ipcRenderer.invoke('desktop-fullscreen', value),
  updatePreferences: (value) => ipcRenderer.invoke('desktop-settings', value),
  updateMedia: (value) => ipcRenderer.invoke('desktop-media', value),
  quit: () => ipcRenderer.invoke('desktop-quit'),
  onDesktopInfo(callback) {
    const listener = (_event: Electron.IpcRendererEvent, info: DesktopInfo) => callback(info)
    ipcRenderer.on('desktop-info', listener)
    return () => ipcRenderer.removeListener('desktop-info', listener)
  },
  onPlayerCommand(callback) {
    const listener = (_event: Electron.IpcRendererEvent, command: PlayerCommand) =>
      callback(command)
    ipcRenderer.on('desktop-command', listener)
    return () => ipcRenderer.removeListener('desktop-command', listener)
  },
  onLifecycle(callback) {
    const listener = (_event: Electron.IpcRendererEvent, state: 'suspend' | 'resume') =>
      callback(state)
    ipcRenderer.on('lifecycle', listener)
    return () => ipcRenderer.removeListener('lifecycle', listener)
  },
}
contextBridge.exposeInMainWorld('together', bridge)

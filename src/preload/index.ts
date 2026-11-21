import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateState } from '../shared/updates'
import type { DesktopInfo, PlayerCommand } from '../shared/desktop'
import type { Bridge, Trace, AccountNotifications } from '../shared/types'
import type { LtMemberUpdate } from '../shared/lt-members'
import type { MediaProgress } from '../shared/media'
const bridge: Bridge = {
  panelAction: (id, action) => ipcRenderer.invoke('panel-action', id, action),
  onPanelStatus(callback) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      id: import('../shared/panels').PanelId,
      status: import('../shared/panels').PanelStatus,
    ) => callback(id, status)
    ipcRenderer.on('panel-status', listener)
    return () => ipcRenderer.removeListener('panel-status', listener)
  },
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
  openMessageLink: (url) => ipcRenderer.invoke('message-link-open', url),
  sendMedia: (request) => ipcRenderer.invoke('media-send', request),
  saveStickerImage: (request) => ipcRenderer.invoke('sticker-image', request),
  privateNotifications: (cursor, session) =>
    ipcRenderer.invoke('private-notifications', cursor, session),
  onPrivateNotifications(callback) {
    const listener = (_event: Electron.IpcRendererEvent, batch: AccountNotifications) =>
      callback(batch)
    ipcRenderer.on('private-notifications', listener)
    return () => ipcRenderer.removeListener('private-notifications', listener)
  },
  onRoomMembers(callback) {
    const listener = (_event: Electron.IpcRendererEvent, update: LtMemberUpdate) => callback(update)
    ipcRenderer.on('room-members', listener)
    return () => ipcRenderer.removeListener('room-members', listener)
  },
  matchOpen: (id) => ipcRenderer.invoke('match-open', id),
  matchPoll: (id) => ipcRenderer.invoke('match-poll', id),
  matchClose: (id) => ipcRenderer.invoke('match-close', id),
  joinImChatroom: (chatroomId) => ipcRenderer.invoke('join-im-chatroom', chatroomId),
  leaveImChatroom: () => ipcRenderer.invoke('leave-im-chatroom'),
  cancelMedia: (requestId) => ipcRenderer.invoke('media-cancel', requestId),
  requestMicrophone: () => ipcRenderer.invoke('microphone-request'),
  onMediaProgress(callback) {
    const listener = (_event: Electron.IpcRendererEvent, progress: MediaProgress) =>
      callback(progress)
    ipcRenderer.on('media-progress', listener)
    return () => ipcRenderer.removeListener('media-progress', listener)
  },
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
  preparePlayerBackground: (bytes) => ipcRenderer.invoke('player-background-image', bytes),
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

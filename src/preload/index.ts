import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult, StorageIQApi } from '@shared/ipc-contract'
import { subscribe } from './subscribe'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

const api: StorageIQApi = {
  getAppInfo: () => invoke('app:get-info'),
  quit: () => invoke('app:quit'),
  selectFolder: () => invoke('dialog:select-folder'),
  listDrives: () => invoke('drives:list'),
  getDriveInfo: (root) => invoke('drive:info', root),
  listPlaces: () => invoke('places:list'),
  startScan: (root) => invoke('scan:start', root),
  cancelScan: (scanId) => invoke('scan:cancel', scanId),
  getChildren: (scanId, nodeId, sortKey, sortDir, offset, limit) =>
    invoke('tree:children', scanId, nodeId, sortKey, sortDir, offset, limit),
  getNode: (scanId, nodeId, sortKey, sortDir) =>
    invoke('tree:node', scanId, nodeId, sortKey, sortDir),
  getExpandIds: (scanId, nodeId, levels) => invoke('tree:expand-ids', scanId, nodeId, levels),
  refreshFolder: (scanId, nodeId) => invoke('tree:refresh', scanId, nodeId),
  getTreemap: (scanId, nodeId, mode, depth, width, height) =>
    invoke('treemap:layout', scanId, nodeId, mode, depth, width, height),
  openInExplorer: (scanId, nodeId) => invoke('shell:open-in-explorer', scanId, nodeId),
  showContextMenu: (scanId, nodeId, x, y, extended) =>
    invoke('shell:context-menu', scanId, nodeId, x, y, extended),
  createFolder: (scanId, nodeId) => invoke('folder:create', scanId, nodeId),
  writeClipboardText: (text) => invoke('clipboard:write-text', text),
  onScanProgress: (listener) => subscribe(ipcRenderer, 'scan:progress', listener),
  onScanDone: (listener) => subscribe(ipcRenderer, 'scan:done', listener),
  onScanFailed: (listener) => subscribe(ipcRenderer, 'scan:failed', listener),
  onTreeChanged: (listener) => subscribe(ipcRenderer, 'tree:changed', listener),
}

contextBridge.exposeInMainWorld('storageiq', api)

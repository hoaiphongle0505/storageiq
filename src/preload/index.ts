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
  showContextMenu: (scanId, nodeIds, x, y, extended) =>
    invoke('shell:context-menu', scanId, nodeIds, x, y, extended),
  createFolder: (scanId, nodeId) => invoke('folder:create', scanId, nodeId),
  copyNodePath: (scanId, nodeIds) => invoke('clipboard:copy-path', scanId, nodeIds),
  onScanProgress: (listener) => subscribe(ipcRenderer, 'scan:progress', listener),
  onScanDone: (listener) => subscribe(ipcRenderer, 'scan:done', listener),
  onScanFailed: (listener) => subscribe(ipcRenderer, 'scan:failed', listener),
  onScanRestarted: (listener) => subscribe(ipcRenderer, 'scan:restarted', listener),
  onTreeChanged: (listener) => subscribe(ipcRenderer, 'tree:changed', listener),
  installUpdate: () => invoke('update:install'),
  onUpdateReady: (listener) => subscribe(ipcRenderer, 'update:ready', listener),
}

contextBridge.exposeInMainWorld('storageiq', api)

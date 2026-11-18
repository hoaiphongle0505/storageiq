import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult, StorageIQApi } from '@shared/ipc-contract'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

const api: StorageIQApi = {
  getAppInfo: () => invoke('app:get-info'),
  selectFolder: () => invoke('dialog:select-folder'),
}

contextBridge.exposeInMainWorld('storageiq', api)

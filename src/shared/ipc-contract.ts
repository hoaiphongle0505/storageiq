/** Metadata about the running application, shown in the status bar. */
export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electronVersion: string
}

/** Outcome of the native "choose a folder" dialog. */
export type SelectFolderResult = { canceled: true } | { canceled: false; path: string }

/**
 * Single source of truth for every renderer → main request.
 * Each channel maps to its argument tuple and its resolved result.
 */
export interface IpcContract {
  'app:get-info': { args: []; result: AppInfo }
  'dialog:select-folder': { args: []; result: SelectFolderResult }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** The API the preload script exposes to the renderer as `window.storageiq`. */
export interface StorageIQApi {
  getAppInfo(): Promise<AppInfo>
  selectFolder(): Promise<SelectFolderResult>
}

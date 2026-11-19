import type { DriveInfo, ScanDone, ScanFailed, ScanProgress, ScanStartResult } from './scan-types'

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
  'drives:list': { args: []; result: DriveInfo[] }
  'app:get-info': { args: []; result: AppInfo }
  'dialog:select-folder': { args: []; result: SelectFolderResult }
  'scan:start': { args: [path: string]; result: ScanStartResult }
  'scan:cancel': { args: [scanId: string]; result: void }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Single source of truth for every main → renderer event and its payload. */
export interface IpcEventContract {
  'scan:progress': ScanProgress
  'scan:done': ScanDone
  'scan:failed': ScanFailed
}

export type IpcEventChannel = keyof IpcEventContract
export type IpcEventPayload<E extends IpcEventChannel> = IpcEventContract[E]

/** Stops a subscription made with one of the `on…` functions. */
export type Unsubscribe = () => void

/** The API the preload script exposes to the renderer as `window.storageiq`. */
export interface StorageIQApi {
  getAppInfo(): Promise<AppInfo>
  selectFolder(): Promise<SelectFolderResult>
  /** Fixed and removable drives with label and space (network and optical drives are left out). */
  listDrives(): Promise<DriveInfo[]>
  /** Starts scanning `path` (an absolute local folder); a running scan is superseded. */
  startScan(path: string): Promise<ScanStartResult>
  /** Stops the scan; unknown or finished IDs are ignored. */
  cancelScan(scanId: string): Promise<void>
  onScanProgress(listener: (progress: ScanProgress) => void): Unsubscribe
  onScanDone(listener: (done: ScanDone) => void): Unsubscribe
  onScanFailed(listener: (failed: ScanFailed) => void): Unsubscribe
}

import type {
  DriveDetails,
  DriveInfo,
  Places,
  ScanDone,
  ScanFailed,
  ScanProgress,
  ScanRestarted,
  ScanStartResult,
} from './scan-types'
import type {
  NodeId,
  SizeMode,
  SortDir,
  SortKey,
  TreeChanged,
  TreemapLayout,
  TreeNodeDetails,
  TreePage,
} from './tree-types'

/** Metadata about the running application, shown in the status bar and the About box. */
export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electronVersion: string
}

/** Outcome of the native "choose a folder" dialog. */
export type SelectFolderResult = { canceled: true } | { canceled: false; path: string }

/** An update has been downloaded and installs on restart (main → renderer). */
export interface UpdateReady {
  version: string
}

/** What the native context menu did, so the renderer can follow up. */
export type ContextMenuOutcome =
  | { kind: 'dismissed' }
  | { kind: 'gone' }
  | { kind: 'refreshed'; nodeId: NodeId }
  | { kind: 'copied'; count: number }
  | { kind: 'opened' }
  | { kind: 'created'; nodeId: NodeId; name: string }
  | {
      kind: 'shell'
      verb: string | null
      changed: boolean
      /** How many items the command was started for (rows the shell cannot act on are skipped). */
      count: number
      /** The command is still running in Windows when this outcome is returned. */
      running: boolean
    }
  /** Three Explorer actions are already running; try again in a moment. */
  | { kind: 'busy' }

/** `folder:create` result: the folder that now holds the new one, and the new folder's name. */
export interface CreateFolderResult {
  parentId: NodeId
  name: string
}

/**
 * Single source of truth for every renderer → main request.
 * Each channel maps to its argument tuple and its resolved result.
 */
export interface IpcContract {
  'drives:list': { args: []; result: DriveInfo[] }
  'drive:info': { args: [root: string]; result: DriveDetails | null }
  'places:list': { args: []; result: Places }
  'app:get-info': { args: []; result: AppInfo }
  'app:quit': { args: []; result: void }
  'dialog:select-folder': { args: []; result: SelectFolderResult }
  'scan:start': { args: [path: string]; result: ScanStartResult }
  'scan:cancel': { args: [scanId: string]; result: void }
  'tree:children': {
    args: [
      scanId: string,
      nodeId: NodeId,
      sortKey: SortKey,
      sortDir: SortDir,
      offset: number,
      limit: number,
    ]
    result: TreePage | null
  }
  'tree:node': {
    args: [scanId: string, nodeId: NodeId, sortKey: SortKey, sortDir: SortDir]
    result: TreeNodeDetails | null
  }
  'tree:expand-ids': { args: [scanId: string, nodeId: NodeId, levels: number]; result: NodeId[] }
  'tree:refresh': { args: [scanId: string, nodeId: NodeId]; result: TreeNodeDetails | null }
  'treemap:layout': {
    args: [
      scanId: string,
      nodeId: NodeId,
      mode: SizeMode,
      depth: number,
      width: number,
      height: number,
    ]
    result: TreemapLayout | null
  }
  'shell:open-in-explorer': { args: [scanId: string, nodeId: NodeId]; result: void }
  'shell:context-menu': {
    args: [scanId: string, nodeIds: NodeId[], x: number, y: number, extended: boolean]
    result: ContextMenuOutcome
  }
  'folder:create': { args: [scanId: string, nodeId: NodeId]; result: CreateFolderResult }
  'clipboard:copy-path': { args: [scanId: string, nodeIds: NodeId[]]; result: void }
  'update:install': { args: []; result: void }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Single source of truth for every main → renderer event and its payload. */
export interface IpcEventContract {
  'scan:progress': ScanProgress
  'scan:done': ScanDone
  'scan:failed': ScanFailed
  'scan:restarted': ScanRestarted
  'tree:changed': TreeChanged
  'update:ready': UpdateReady
}

export type IpcEventChannel = keyof IpcEventContract
export type IpcEventPayload<E extends IpcEventChannel> = IpcEventContract[E]

/** Stops a subscription made with one of the `on…` functions. */
export type Unsubscribe = () => void

/** The API the preload script exposes to the renderer as `window.storageiq`. */
export interface StorageIQApi {
  getAppInfo(): Promise<AppInfo>
  quit(): Promise<void>
  selectFolder(): Promise<SelectFolderResult>
  /** Fixed and removable drives with label and space (network and optical drives are left out). */
  listDrives(): Promise<DriveInfo[]>
  /** Space, cluster size and file system of the drive holding `root`; null when unreadable. */
  getDriveInfo(root: string): Promise<DriveDetails | null>
  /** Documents, OneDrive folders and the recently scanned paths. */
  listPlaces(): Promise<Places>
  /** Starts scanning `path` (an absolute local folder); a running scan is superseded. */
  startScan(path: string): Promise<ScanStartResult>
  /** Stops the scan; unknown or finished IDs are ignored. */
  cancelScan(scanId: string): Promise<void>
  getChildren(
    scanId: string,
    nodeId: NodeId,
    sortKey: SortKey,
    sortDir: SortDir,
    offset: number,
    limit: number,
  ): Promise<TreePage | null>
  getNode(
    scanId: string,
    nodeId: NodeId,
    sortKey: SortKey,
    sortDir: SortDir,
  ): Promise<TreeNodeDetails | null>
  /** Folders to expand so `levels` levels below `nodeId` are visible (capped by the scanner). */
  getExpandIds(scanId: string, nodeId: NodeId, levels: number): Promise<NodeId[]>
  /** Rescans one folder of the current scan and updates its totals and its ancestors. */
  refreshFolder(scanId: string, nodeId: NodeId): Promise<TreeNodeDetails | null>
  getTreemap(
    scanId: string,
    nodeId: NodeId,
    mode: SizeMode,
    depth: number,
    width: number,
    height: number,
  ): Promise<TreemapLayout | null>
  openInExplorer(scanId: string, nodeId: NodeId): Promise<void>
  /**
   * Shows the Windows Explorer context menu for one or more rows (1 to 1,000) at window
   * coordinates (CSS px). Resolves when the menu closes, not when the command ends.
   */
  showContextMenu(
    scanId: string,
    nodeIds: NodeId[],
    x: number,
    y: number,
    extended: boolean,
  ): Promise<ContextMenuOutcome>
  /** Creates "New folder" (or "New folder (2)", …) in the row's folder and rescans that folder. */
  createFolder(scanId: string, nodeId: NodeId): Promise<CreateFolderResult>
  /**
   * Copies the paths of rows of the current scan to the clipboard, one per line (main resolves
   * the paths).
   */
  copyNodePath(scanId: string, nodeIds: NodeId[]): Promise<void>
  onScanProgress(listener: (progress: ScanProgress) => void): Unsubscribe
  onScanDone(listener: (done: ScanDone) => void): Unsubscribe
  onScanFailed(listener: (failed: ScanFailed) => void): Unsubscribe
  /** Main started a new scan of the same root; sent before any progress for the new scanId. */
  onScanRestarted(listener: (restarted: ScanRestarted) => void): Unsubscribe
  onTreeChanged(listener: (changed: TreeChanged) => void): Unsubscribe
  /** Restarts the app to install the downloaded update; ignored when none is ready. */
  installUpdate(): Promise<void>
  /** An update finished downloading; also re-sent when the page reloads after that. */
  onUpdateReady(listener: (ready: UpdateReady) => void): Unsubscribe
}

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
  chromeVersion: string
  /** `Beta` when the version has a pre-release tag, else `Stable`. */
  channel: 'Beta' | 'Stable'
}

/** Outcome of the native "choose a folder" dialog. */
export type SelectFolderResult = { canceled: true } | { canceled: false; path: string }

/** Where the updater stands; main owns it, the renderer only reads it. */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'unavailable'; message: string } // unpackaged or self-test run
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number } // integer 0..100
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string; during: 'check' | 'download' }

export interface ChangelogSection {
  title: string
  items: string[]
}

export interface ChangelogEntry {
  version: string
  date: string | null
  sections: ChangelogSection[]
}

/** The only links the renderer may ask main to open; main owns the URLs. */
export type AboutLink = 'repo' | 'license' | 'releases' | 'help' | 'issues'

export type ReleaseNotes = { version: string; text: string | null }

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

/** One icon as PNG data URLs. */
export interface IconImage {
  /** `data:image/png;base64,…` of the small icon (the system small-icon size, 16 px at 100 %). */
  small: string
  /** The large icon (the system large-icon size, 32 px at 100 %), used when devicePixelRatio ≥ 1.25. */
  large: string
}

/** `icons:for-nodes` result. */
export interface IconBatch {
  /** nodeId → icon key. A node that no longer resolves is absent. */
  keys: Record<NodeId, string>
  /** icon key → images. Contains every key named in `keys` that could be produced. */
  images: Record<string, IconImage>
  /** Per-file ids that were answered with their type’s icon only (time budget); ask again. */
  pending: NodeId[]
}

/** `folder:create` result: the folder that now holds the new one, and the new folder's name. */
export interface CreateFolderResult {
  parentId: NodeId
  name: string
}

/**
 * Single source of truth for every renderer → main request.
 * Each channel maps to its argument tuple and its resolved result.
 */
export interface OptionsState {
  /** false when unpackaged (or not Windows): both switches are shown disabled. */
  available: boolean
  /** All three Explorer verbs exist with a command for the current exe. */
  explorerMenu: boolean
  /** HKCU or HKLM carries RUNASADMIN for the current exe. */
  runAsAdmin: boolean
  /** RUNASADMIN comes from HKLM (policy or an administrator): it cannot be turned off here. */
  runAsAdminLocked: boolean
}

export interface OptionsChangeResult {
  state: OptionsState
  /** Calm one-line message when Windows refused the change; null on success. */
  error: string | null
}

/** A launch with `--scan <path>`: main already validated the path (or says why it is not usable). */
export type LaunchRequest = { kind: 'scan'; path: string } | { kind: 'invalid'; message: string }

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
  'icons:for-nodes': { args: [scanId: string, nodeIds: NodeId[]]; result: IconBatch }
  'icons:for-types': { args: [typeKeys: string[]]; result: Record<string, IconImage> }
  'update:install': { args: []; result: void }
  'update:get-state': { args: []; result: UpdateState }
  'update:check': { args: []; result: UpdateState }
  'update:download': { args: []; result: void }
  'update:get-release-notes': { args: []; result: ReleaseNotes | null }
  'app:get-changelog': { args: []; result: ChangelogEntry[] }
  'app:open-notices': { args: []; result: { opened: boolean } }
  'app:open-link': { args: [link: AboutLink]; result: void }
  'app:get-whats-new-due': { args: []; result: ChangelogEntry | null }
  'app:mark-whats-new-seen': { args: []; result: void }
  'options:get-state': { args: []; result: OptionsState }
  'options:set-explorer-menu': { args: [enabled: boolean]; result: OptionsChangeResult }
  'options:set-run-as-admin': { args: [enabled: boolean]; result: OptionsChangeResult }
  'launch:take-request': { args: []; result: LaunchRequest | null }
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
  'update:state': UpdateState
  'launch:request': LaunchRequest
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
  /**
   * Windows’ own icons for rows of the current scan (1 to 64 ids). A key missing from `images`
   * means “keep the placeholder”; native failures answer empty, only invalid arguments reject.
   */
  getIcons(scanId: string, nodeIds: NodeId[]): Promise<IconBatch>
  /** Windows’ icons by type key (`dir`, `drive`, `file`, `ext:<extension>`), 1 to 64 keys. */
  getTypeIcons(typeKeys: string[]): Promise<Record<string, IconImage>>
  onScanProgress(listener: (progress: ScanProgress) => void): Unsubscribe
  onScanDone(listener: (done: ScanDone) => void): Unsubscribe
  onScanFailed(listener: (failed: ScanFailed) => void): Unsubscribe
  /** Main started a new scan of the same root; sent before any progress for the new scanId. */
  onScanRestarted(listener: (restarted: ScanRestarted) => void): Unsubscribe
  onTreeChanged(listener: (changed: TreeChanged) => void): Unsubscribe
  /** The updater's current state (pull once, then follow `onUpdateState`). */
  getUpdateState(): Promise<UpdateState>
  /** Starts a manual update check; ignored while one is running or an update is found. */
  checkForUpdates(): Promise<UpdateState>
  /** Downloads the found update; ignored unless one is available. */
  downloadUpdate(): Promise<void>
  /** Restarts the app to install the downloaded update; ignored when none is ready. */
  installUpdate(): Promise<void>
  /** Release notes (plain text) of the update that was found; null when there is none. */
  getReleaseNotes(): Promise<ReleaseNotes | null>
  /** Every state change; also re-sent when the page reloads while not idle. */
  onUpdateState(listener: (state: UpdateState) => void): Unsubscribe
  /** The bundled CHANGELOG.md, newest first (at most 10 entries). */
  getChangelog(): Promise<ChangelogEntry[]>
  /** Opens the third-party notices file with the default app. */
  openNotices(): Promise<{ opened: boolean }>
  /** Opens one of the fixed project links in the default browser. */
  openLink(link: AboutLink): Promise<void>
  /** The changelog entry to show once after an update; null when nothing is due. */
  getWhatsNewDue(): Promise<ChangelogEntry | null>
  /** Records that the running version's What's new was shown. */
  markWhatsNewSeen(): Promise<void>
  /** What Windows has for the two Options switches (read from the registry on every call). */
  getOptionsState(): Promise<OptionsState>
  /** Adds or removes “Scan with StorageIQ” in Explorer’s context menu (HKCU, no admin needed). */
  setExplorerMenu(enabled: boolean): Promise<OptionsChangeResult>
  /** Sets or clears Windows’ “run as administrator” flag for StorageIQ; effective next start. */
  setRunAsAdmin(enabled: boolean): Promise<OptionsChangeResult>
  /** The validated `--scan` request that started the app, once; null when there is none. */
  takeLaunchRequest(): Promise<LaunchRequest | null>
  /** A `--scan` request from a later launch (Explorer’s menu while the app is open). */
  onLaunchRequest(listener: (request: LaunchRequest) => void): Unsubscribe
}

import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  AboutLink,
  ChangelogEntry,
  ContextMenuOutcome,
  LaunchRequest,
  OptionsChangeResult,
  OptionsState,
  ReleaseNotes,
  StorageIQApi,
  UpdateState,
} from '@shared/ipc-contract'
import type {
  DriveDetails,
  DriveInfo,
  Places,
  ScanDone,
  ScanError,
  ScanFailed,
  ScanProgress,
  ScanRestarted,
  ScanStartResult,
} from '@shared/scan-types'
import { SCANNER_STOPPED_MESSAGE } from '@shared/scan-types'
import {
  MAX_TREEMAP_DEPTH,
  modeSortKey,
  ROOT_NODE_ID,
  type NodeId,
  type SizeMode,
  type SortDir,
  type SortKey,
  type TreeChanged,
  type TreemapLayout,
} from '@shared/tree-types'
import type { SizeUnit } from '../lib/format'
import { dropDescendants, type Selection, single } from '../lib/selection'
import {
  CHUNK_SIZE,
  type ChildLists,
  type ChunkRef,
  rowIndexOf,
  rowInList,
} from '../lib/tree-view-model'

/** `empty → scanning → done | canceled | failed`; any state can scan again. */
export type ScanPhase = 'empty' | 'scanning' | 'done' | 'canceled' | 'failed'

/** Column ids of the tree. "% of Parent" sorts by the Mode value. */
export type ColumnId = 'name' | 'size' | 'allocated' | 'files' | 'folders' | 'percent' | 'modified'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ScanTotals {
  files: number
  folders: number
  bytes: number
  allocatedBytes: number
  errorCount: number
}

export interface Banner {
  tone: 'error' | 'crash'
  message: string
}

export const FOLDER_PICKER_ERROR = 'StorageIQ couldn’t open the folder picker. Please try again.'
export const START_SCAN_ERROR =
  'StorageIQ couldn’t start a scan of that location. Please choose another one.'
export const NETWORK_PATH_ERROR =
  'StorageIQ can’t scan network locations. Please choose a drive or a folder on this PC.'
export const SCAN_CRASH_MESSAGE = 'The scan stopped unexpectedly. You can try again.'
export const PATH_COPIED = 'Path copied.'
export const GONE_MESSAGE = 'That item no longer exists. The list was refreshed.'
export const BUSY_MESSAGE = 'Windows is still working on earlier actions. Try again in a moment.'
export const BIN_MIXED_MESSAGE = 'Select the Recycle Bin on its own to empty it.'
export const TOO_MANY_MESSAGE = 'Too many items selected (the limit is 1,000).'
/** Rows one Explorer action takes (the same limit as main). */
export const MAX_ACTION_ITEMS = 1000
/** A selection larger than this is not re-checked against the scanner; it shrinks to the active row. */
export const MAX_PRUNED_SELECTION = 200
const PRUNE_IN_FLIGHT = 8
export const EXPAND_ALL_LEVELS = 64
export const DEFAULT_TREEMAP_DEPTH = 1

/** While scanning, progress events bump the tree revision at most this often (ms). */
export const REVISION_THROTTLE_MS = 1000

const EMPTY_TOTALS: ScanTotals = {
  files: 0,
  folders: 0,
  bytes: 0,
  allocatedBytes: 0,
  errorCount: 0,
}

export function actionError(error: unknown): string {
  const detail =
    error instanceof Error
      ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      : ''
  return detail === '' ? 'StorageIQ couldn’t do that.' : `StorageIQ couldn’t do that: ${detail}`
}

export function isNetworkPath(target: string): boolean {
  return target.startsWith('\\\\') || target.startsWith('//')
}

/** `C:\Users\Ana` → `C:\`. */
export function driveRootOf(target: string): string | null {
  const match = /^([A-Za-z]):/.exec(target)
  return match === null ? null : `${(match[1] ?? '').toUpperCase()}:\\`
}

export interface WorkspaceState {
  phase: ScanPhase
  /** The drive or folder being scanned, or scanned last. */
  target: string | null
  /** Known once `scan:start` returns. */
  scanId: string | null
  totals: ScanTotals
  /** The first unreadable entries (at most 1000); `totals.errorCount` is the exact count. */
  errors: ScanError[]
  elapsedMs: number
  drive: DriveDetails | null
  drives: DriveInfo[]
  places: Places
  menuDataStatus: LoadStatus
  mode: SizeMode
  unit: SizeUnit
  /** null sorts by the Mode value. */
  sortColumn: ColumnId | null
  sortDir: SortDir
  lists: ChildLists
  expanded: ReadonlySet<NodeId>
  /** The active row (focused; what the treemap shows). Always in `selectedIds`, or `selectedIds` is empty. */
  selectedId: NodeId | null
  /** The selected rows. Holds ids, so it survives chunk reloads and revision bumps. */
  selectedIds: ReadonlySet<NodeId>
  /** Where a Shift range starts. */
  anchorId: NodeId | null
  /** Ask the tree to scroll a row into view (seq changes on every request). */
  scrollTarget: { id: NodeId; seq: number } | null
  /** Bumps whenever the scanner's tree may have changed; loaded chunks older than it reload. */
  revision: number
  treemapVisible: boolean
  treemapDepth: number
  /** The folder the treemap shows. */
  treemapRootId: NodeId | null
  banner: Banner | null
  /** The updater's state; main owns it, this mirrors it. */
  updateState: UpdateState
  /** The update version whose banner was dismissed (session memory only). */
  dismissedUpdateVersion: string | null
  /** The open What's new dialog, if any. */
  whatsNew: WhatsNewTarget | null
  /** A download error the user chose to hide with Later (cleared when the state changes). */
  dismissedDownloadError: boolean
  /** Short polite message for screen readers (copied, created, …). */
  announcement: string
  folderPickerOpen: boolean
  /** A launched `--scan` path waiting for the owner to confirm stopping the running scan. */
  pendingLaunchScan: string | null

  loadMenuData(): Promise<void>
  chooseFolder(): Promise<void>
  startScan(target: string): Promise<void>
  stopScan(): Promise<void>
  rescan(): Promise<void>
  setMode(mode: SizeMode): void
  setUnit(unit: SizeUnit): void
  sortBy(column: ColumnId): void
  setExpanded(id: NodeId, open: boolean): void
  expandLevels(levels: number): Promise<void>
  select(id: NodeId): void
  /** Sets the polite screen-reader message. */
  announce(message: string): void
  /** Replaces the selection; `selectedId` follows the active row and so does the treemap. */
  setSelection(selection: Selection): void
  /** Selects a row that may be hidden: expands its ancestors and loads its chunk. */
  reveal(id: NodeId): Promise<void>
  /** Treemap double-click: reveal the row and show its children in the treemap. */
  drillInto(id: NodeId): Promise<void>
  requestChunks(refs: readonly ChunkRef[]): void
  openInExplorer(id: NodeId): Promise<void>
  /** Copies the paths of these rows, one per line (main resolves them). */
  copyPaths(ids: readonly NodeId[]): Promise<void>
  /** Shows the Explorer menu for these rows (1 to 1,000 after rows inside others are dropped). */
  showContextMenu(ids: readonly NodeId[], x: number, y: number, extended: boolean): Promise<void>
  createFolder(id: NodeId): Promise<void>
  /**
   * Keyboard Delete and the ribbon button: sends the selection (the active row when none is
   * selected) to the Recycle Bin, or deletes it permanently. Windows shows its own dialogs.
   * Does nothing while a scan runs, and announces the rows it skips.
   */
  deleteSelection(permanent: boolean): Promise<void>
  /** Lays out the treemap of `treemapRootId` for a canvas of `width` × `height` CSS px. */
  fetchTreemap(width: number, height: number): Promise<TreemapLayout | null>
  setTreemapDepth(depth: number): void
  setTreemapVisible(visible: boolean): void
  dismissBanner(): void
  /** A validated `--scan` request from main: scans now, or asks first while a scan runs. */
  receiveLaunchRequest(request: LaunchRequest): void
  /**
   * Follows `--scan` launches: subscribes first, then takes the request that started the app, so
   * none is lost in between. Returns the unsubscribe.
   */
  watchLaunchRequests(): () => void
  /** The launch dialog's "Scan …" button: stops the running scan and scans the new path. */
  confirmLaunchScan(): Promise<void>
  /** The launch dialog's "Keep current scan" button. */
  declineLaunchScan(): void
  /** What Windows has for the Options switches; null when the call fails. */
  loadOptionsState(): Promise<OptionsState | null>
  /** Result of changing the Explorer menu option; null when the call itself fails. */
  changeExplorerMenu(enabled: boolean): Promise<OptionsChangeResult | null>
  /** Result of changing the administrator option; null when the call itself fails. */
  changeRunAsAdmin(enabled: boolean): Promise<OptionsChangeResult | null>
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  /** Hides the banner for the announced version; a newer version shows it again. */
  dismissUpdate(): void
  openWhatsNew(target: WhatsNewTarget): void
  closeWhatsNew(): void
  /** Opens one of the fixed project links in the browser; main owns the URLs. */
  openLink(link: AboutLink): Promise<void>
  /** Opens the third-party notices file; false when it was not found. */
  openNotices(): Promise<boolean>
  /** The bundled changelog, newest first; empty when it cannot be read. */
  loadChangelog(): Promise<ChangelogEntry[]>
  /** Plain-text release notes of the announced update; rejects when the call fails. */
  loadReleaseNotes(): Promise<ReleaseNotes | null>
  quit(): Promise<void>
}

export type WorkspaceStore = StoreApi<WorkspaceState> & { dispose(): void }

/** The sort the scanner is asked for. */
export function effectiveSort(state: Pick<WorkspaceState, 'sortColumn' | 'sortDir' | 'mode'>): {
  key: SortKey
  dir: SortDir
} {
  const column = state.sortColumn
  if (column === null || column === 'percent')
    return { key: modeSortKey(state.mode), dir: state.sortDir }
  return { key: column, dir: state.sortDir }
}

type ScanEvent =
  | { kind: 'progress'; payload: ScanProgress }
  | { kind: 'done'; payload: ScanDone }
  | { kind: 'failed'; payload: ScanFailed }

/** What the What's new dialog shows. */
export type WhatsNewTarget =
  { kind: 'history' } | { kind: 'installed'; version: string } | { kind: 'update'; version: string }

export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
  /** Events that arrived while `scan:start` was still in flight (scan ID not known yet). */
  let early: ScanEvent[] = []
  let cancelWhenStarted = false
  const inFlight = new Set<string>()
  /** Changes whenever the lists are thrown away (new scan, new sort); stale replies are dropped. */
  let generation = 0

  /** Pending trailing revision bump while a scan reports progress. */
  let revisionTimer: ReturnType<typeof setTimeout> | null = null
  let lastProgressBumpAt = Number.NEGATIVE_INFINITY

  const clearRevisionTimer = () => {
    if (revisionTimer !== null) clearTimeout(revisionTimer)
    revisionTimer = null
  }

  /** An immediate bump: cancels any pending trailing bump and restarts the progress window. */
  const bumpRevision = (current: number): number => {
    clearRevisionTimer()
    lastProgressBumpAt = Number.NEGATIVE_INFINITY
    return current + 1
  }

  /**
   * Progress events reload the tree and treemap through `revision`; at most once per
   * `REVISION_THROTTLE_MS`: the first event at once, then one trailing bump per window.
   */
  const throttledBump = () => {
    const now = Date.now()
    const wait = lastProgressBumpAt + REVISION_THROTTLE_MS - now
    if (wait <= 0) {
      clearRevisionTimer()
      lastProgressBumpAt = now
      store.setState({ revision: store.getState().revision + 1 })
    } else if (revisionTimer === null) {
      revisionTimer = setTimeout(() => {
        revisionTimer = null
        if (store.getState().phase !== 'scanning') return
        lastProgressBumpAt = Date.now()
        store.setState({ revision: store.getState().revision + 1 })
      }, wait)
    }
  }

  const store = createStore<WorkspaceState>()((set, get) => {
    const fail = (error: unknown) => set({ banner: { tone: 'error', message: actionError(error) } })

    const loadDrive = (target: string) => {
      const root = driveRootOf(target)
      if (root === null) return
      api.getDriveInfo(root).then(
        (drive) => {
          if (get().target === target) set({ drive })
        },
        () => undefined,
      )
    }

    /** Fetches one chunk of a row's children into `lists`. */
    const fetchChunk = async (nodeId: NodeId, chunk: number): Promise<void> => {
      const { scanId, revision } = get()
      if (scanId === null) return
      const key = `${nodeId}:${chunk}`
      if (inFlight.has(key)) return
      inFlight.add(key)
      const startedGeneration = generation
      const { key: sortKey, dir } = effectiveSort(get())
      try {
        const page = await api.getChildren(
          scanId,
          nodeId,
          sortKey,
          dir,
          chunk * CHUNK_SIZE,
          CHUNK_SIZE,
        )
        if (startedGeneration !== generation || get().scanId !== scanId) return
        const lists = { ...get().lists }
        if (page === null) {
          delete lists[nodeId]
        } else {
          const old = lists[nodeId]
          lists[nodeId] = {
            parent: page.parent,
            total: page.total,
            chunks: { ...(old?.chunks ?? {}), [chunk]: { rows: page.rows, revision } },
          }
        }
        set({ lists })
      } catch {
        // The scanner is gone or busy; the next revision asks again.
      } finally {
        inFlight.delete(key)
      }
    }

    const findRow = (id: NodeId) => {
      for (const list of Object.values(get().lists)) {
        if (list.parent.id === id) return list.parent
        for (const chunk of Object.values(list.chunks)) {
          const row = chunk.rows.find((candidate) => candidate.id === id)
          if (row) return row
        }
      }
      return null
    }

    /** The treemap shows a folder or a "[N files]" row; a file shows its own group. */
    const treemapRootFor = (id: NodeId): NodeId => {
      if (!id.startsWith('f')) return id
      return findRow(id)?.parentId ?? get().treemapRootId ?? ROOT_NODE_ID
    }

    const resetTree = () => {
      generation += 1
      inFlight.clear()
      set({ lists: {} })
    }

    /** Rows of the action that main could not act on (root, "[N files]", vanished rows). */
    const skippedNote = (sent: number, acted: number): string => {
      const skipped = sent - acted
      return skipped > 0
        ? ` Skipped ${skipped} ${skipped === 1 ? 'row' : 'rows'} that cannot be acted on.`
        : ''
    }

    const handleOutcome = (outcome: ContextMenuOutcome, sent: number) => {
      if (outcome.kind === 'gone')
        set({
          selectedId: null,
          selectedIds: new Set(),
          anchorId: null,
          announcement: GONE_MESSAGE,
          banner: null,
        })
      if (outcome.kind === 'busy') set({ announcement: BUSY_MESSAGE })
      if (outcome.kind === 'bin-mixed') set({ announcement: BIN_MIXED_MESSAGE })
      if (outcome.kind === 'copied') {
        set({
          announcement:
            (outcome.count === 1 ? PATH_COPIED : `Copied ${outcome.count} paths.`) +
            skippedNote(sent, outcome.count),
        })
      }
      if (outcome.kind === 'created') set({ announcement: `Created “${outcome.name}”.` })
      if (outcome.kind === 'opened') set({ announcement: 'Opened in Explorer.' })
      if (outcome.kind === 'shell') {
        const working = `Windows is working on ${outcome.count} ${outcome.count === 1 ? 'item' : 'items'}…`
        set({ announcement: working + skippedNote(sent, outcome.count) })
        // The rows leave the tree when the operation ends; until then only the active row stays.
        if (outcome.verb === 'delete') {
          const active = get().selectedId
          set({ selectedIds: active === null ? new Set() : new Set([active]) })
        }
      }
    }

    /** True while a delete request is with main; a second one is dropped. */
    let deleteInFlight = false

    /** The rows an action sends: rows inside another selected row are not part of it. */
    const actionIds = (ids: readonly NodeId[]): { ids: NodeId[]; removed: number } => {
      const rows = rowIndexOf(get().lists)
      // With several rows main drops the root and "[N files]" rows (rule 12): do it here first,
      // or the root (everyone's ancestor) would swallow the whole selection.
      const kept =
        ids.length > 1 ? ids.filter((id) => id !== ROOT_NODE_ID && !id.startsWith('g')) : ids
      return {
        ids: dropDescendants(kept, (id) => rows.get(id)?.parentId ?? null),
        removed: ids.length - kept.length,
      }
    }

    return {
      phase: 'empty',
      target: null,
      scanId: null,
      totals: EMPTY_TOTALS,
      errors: [],
      elapsedMs: 0,
      drive: null,
      drives: [],
      places: { places: [], recent: [] },
      menuDataStatus: 'idle',
      mode: 'size',
      unit: 'auto',
      sortColumn: null,
      sortDir: 'desc',
      lists: {},
      expanded: new Set<NodeId>(),
      selectedId: null,
      selectedIds: new Set<NodeId>(),
      anchorId: null,
      scrollTarget: null,
      revision: 0,
      treemapVisible: true,
      treemapDepth: DEFAULT_TREEMAP_DEPTH,
      treemapRootId: null,
      banner: null,
      updateState: { kind: 'idle' },
      dismissedUpdateVersion: null,
      whatsNew: null,
      dismissedDownloadError: false,
      announcement: '',
      folderPickerOpen: false,
      pendingLaunchScan: null,

      async loadMenuData() {
        if (get().menuDataStatus === 'loading') return
        set({ menuDataStatus: 'loading' })
        const [drives, places] = await Promise.allSettled([api.listDrives(), api.listPlaces()])
        set({
          drives: drives.status === 'fulfilled' ? drives.value : [],
          places: places.status === 'fulfilled' ? places.value : { places: [], recent: [] },
          menuDataStatus:
            drives.status === 'fulfilled' && places.status === 'fulfilled' ? 'ready' : 'error',
        })
      },

      async chooseFolder() {
        if (get().folderPickerOpen) return
        set({ folderPickerOpen: true })
        let picked: string | null
        try {
          const result = await api.selectFolder()
          picked = result.canceled ? null : result.path
        } catch {
          set({ folderPickerOpen: false, banner: { tone: 'error', message: FOLDER_PICKER_ERROR } })
          return
        }
        set({ folderPickerOpen: false })
        if (picked !== null) await get().startScan(picked)
      },

      async startScan(target) {
        if (isNetworkPath(target)) {
          set({ banner: { tone: 'error', message: NETWORK_PATH_ERROR } })
          return
        }
        early = []
        cancelWhenStarted = false
        resetTree()
        set({
          phase: 'scanning',
          target,
          scanId: null,
          totals: EMPTY_TOTALS,
          errors: [],
          elapsedMs: 0,
          drive: null,
          expanded: new Set([ROOT_NODE_ID]),
          selectedId: ROOT_NODE_ID,
          selectedIds: new Set([ROOT_NODE_ID]),
          anchorId: ROOT_NODE_ID,
          scrollTarget: null,
          treemapRootId: ROOT_NODE_ID,
          banner: null,
          revision: bumpRevision(get().revision),
        })
        loadDrive(target)
        let started: ScanStartResult
        try {
          started = await api.startScan(target)
        } catch {
          set({
            phase: 'empty',
            target: null,
            banner: { tone: 'error', message: START_SCAN_ERROR },
          })
          return
        }
        if (get().target !== target || get().scanId !== null) return // superseded meanwhile
        set({ scanId: started.scanId })
        const pending = early
        early = []
        for (const event of pending) applyEvent(event)
        if (cancelWhenStarted && get().phase === 'scanning') {
          await api.cancelScan(started.scanId).catch(() => undefined)
        }
        void get().loadMenuData() // "Recently scanned" now includes this path
      },

      async stopScan() {
        const { phase, scanId } = get()
        if (phase !== 'scanning') return
        if (scanId === null) {
          cancelWhenStarted = true
          return
        }
        try {
          await api.cancelScan(scanId)
        } catch (error) {
          fail(error)
        }
      },

      async rescan() {
        const { target, phase } = get()
        if (target !== null && phase !== 'scanning') await get().startScan(target)
      },

      setMode(mode) {
        if (get().mode === mode) return
        const byMode = get().sortColumn === null || get().sortColumn === 'percent'
        set({ mode })
        if (byMode) {
          resetTree()
          set({ revision: bumpRevision(get().revision) })
        }
      },

      setUnit(unit) {
        set({ unit })
      },

      sortBy(column) {
        const { sortColumn, sortDir } = get()
        const same = sortColumn === column || (sortColumn === null && column === 'percent')
        const dir: SortDir = same
          ? sortDir === 'desc'
            ? 'asc'
            : 'desc'
          : column === 'name'
            ? 'asc'
            : 'desc'
        resetTree()
        set({ sortColumn: column, sortDir: dir, revision: bumpRevision(get().revision) })
      },

      setExpanded(id, open) {
        const expanded = new Set(get().expanded)
        if (open) expanded.add(id)
        else expanded.delete(id)
        set({ expanded })
      },

      async expandLevels(levels) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          const ids = await api.getExpandIds(scanId, ROOT_NODE_ID, levels)
          if (get().scanId === scanId) set({ expanded: new Set(ids) })
        } catch (error) {
          fail(error)
        }
      },

      select(id) {
        get().setSelection(single(id))
      },

      announce(message) {
        set({ announcement: message })
      },

      setSelection(selection) {
        const { activeId } = selection
        set({
          selectedId: activeId,
          selectedIds: selection.ids,
          anchorId: selection.anchorId,
          ...(activeId === null ? {} : { treemapRootId: treemapRootFor(activeId) }),
        })
      },

      async reveal(id) {
        const { scanId } = get()
        if (scanId === null) return
        const { key, dir } = effectiveSort(get())
        let details
        try {
          details = await api.getNode(scanId, id, key, dir)
        } catch (error) {
          fail(error)
          return
        }
        if (details === null || get().scanId !== scanId) return
        const expanded = new Set(get().expanded)
        for (const ancestor of details.ancestorIds) expanded.add(ancestor)
        set({ expanded })
        await Promise.all(
          details.locations
            .filter((location) => {
              const list = get().lists[location.parentId]
              return rowInList(list, location.index) === null
            })
            .map((location) =>
              fetchChunk(location.parentId, Math.floor(location.index / CHUNK_SIZE)),
            ),
        )
        const seq = (get().scrollTarget?.seq ?? 0) + 1
        set({
          selectedId: id,
          selectedIds: new Set([id]),
          anchorId: id,
          scrollTarget: { id, seq },
        })
      },

      async drillInto(id) {
        if (id.startsWith('f')) return
        await get().reveal(id)
        set({ treemapRootId: id })
      },

      requestChunks(refs) {
        const { lists, revision } = get()
        for (const ref of refs) {
          const chunk = lists[ref.nodeId]?.chunks[ref.chunk]
          if (chunk !== undefined && chunk.revision === revision) continue
          void fetchChunk(ref.nodeId, ref.chunk)
        }
      },

      async openInExplorer(id) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          await api.openInExplorer(scanId, id)
        } catch (error) {
          fail(error)
        }
      },

      async copyPaths(ids) {
        const { scanId } = get()
        if (scanId === null || ids.length === 0) return
        if (ids.length > MAX_ACTION_ITEMS) {
          set({ announcement: TOO_MANY_MESSAGE })
          return
        }
        try {
          await api.copyNodePath(scanId, [...ids])
          set({ announcement: ids.length === 1 ? PATH_COPIED : `Copied ${ids.length} paths.` })
        } catch (error) {
          fail(error)
        }
      },

      async showContextMenu(ids, x, y, extended) {
        const { scanId } = get()
        if (scanId === null || ids.length === 0) return
        const { ids: sent, removed } = actionIds(ids)
        if (sent.length === 0) {
          set({
            announcement: `Skipped ${removed} ${removed === 1 ? 'row' : 'rows'} that cannot be acted on.`,
          })
          return
        }
        if (sent.length > MAX_ACTION_ITEMS) {
          set({ announcement: TOO_MANY_MESSAGE })
          return
        }
        try {
          handleOutcome(
            await api.showContextMenu(
              scanId,
              sent,
              Math.max(0, Math.round(x)),
              Math.max(0, Math.round(y)),
              extended,
            ),
            sent.length + removed,
          )
        } catch (error) {
          fail(error)
        }
      },

      async deleteSelection(permanent) {
        const { scanId, phase, selectedId, selectedIds } = get()
        // A request is still on its way (a held or repeated key): drop this one.
        if (scanId === null || phase === 'scanning' || deleteInFlight) return
        const selection =
          selectedIds.size > 0 ? [...selectedIds] : selectedId === null ? [] : [selectedId]
        if (selection.length === 0) return
        // The root and "[N files]" rows are never deleted, not even alone (actionIds only drops
        // them from a multi-row selection).
        const deletable = selection.filter((id) => id !== ROOT_NODE_ID && !id.startsWith('g'))
        const { ids: sent, removed } =
          deletable.length === 0 ? { ids: [], removed: selection.length } : actionIds(selection)
        if (sent.length === 0) {
          set({
            announcement: `Skipped ${removed} ${removed === 1 ? 'row' : 'rows'} that cannot be acted on.`,
          })
          return
        }
        if (sent.length > MAX_ACTION_ITEMS) {
          set({ announcement: TOO_MANY_MESSAGE })
          return
        }
        deleteInFlight = true
        try {
          handleOutcome(await api.deleteNodes(scanId, sent, permanent), sent.length + removed)
        } catch (error) {
          fail(error)
        } finally {
          deleteInFlight = false
        }
      },

      async createFolder(id) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          const created = await api.createFolder(scanId, id)
          set({ announcement: `Created “${created.name}”.` })
        } catch (error) {
          fail(error)
        }
      },

      async fetchTreemap(width, height) {
        const { scanId, treemapRootId, mode, treemapDepth } = get()
        if (scanId === null || treemapRootId === null || width < 1 || height < 1) return null
        try {
          return await api.getTreemap(
            scanId,
            treemapRootId,
            mode,
            treemapDepth,
            Math.round(width),
            Math.round(height),
          )
        } catch {
          return null
        }
      },

      setTreemapDepth(depth) {
        set({ treemapDepth: Math.max(0, Math.min(MAX_TREEMAP_DEPTH, Math.round(depth))) })
      },

      setTreemapVisible(visible) {
        set({ treemapVisible: visible })
      },

      dismissBanner() {
        set({ banner: null })
      },

      async installUpdate() {
        try {
          await api.installUpdate()
        } catch (error) {
          fail(error)
        }
      },

      async checkForUpdates() {
        try {
          // The state arrives as a pushed event; the reply is not used.
          await api.checkForUpdates()
        } catch (error) {
          fail(error)
        }
      },

      async downloadUpdate() {
        try {
          await api.downloadUpdate()
        } catch (error) {
          fail(error)
        }
      },

      dismissUpdate() {
        const { updateState } = get()
        if (updateState.kind === 'available' || updateState.kind === 'ready') {
          set({ dismissedUpdateVersion: updateState.version })
        } else if (updateState.kind === 'error' && updateState.during === 'download') {
          set({ dismissedDownloadError: true })
        }
      },

      receiveLaunchRequest(request) {
        if (request.kind === 'invalid') {
          set({ banner: { tone: 'error', message: request.message } })
          return
        }
        if (get().phase === 'scanning') {
          set({ pendingLaunchScan: request.path }) // a later request replaces an earlier one
          return
        }
        set({ pendingLaunchScan: null }) // never leave an older path in the dialog
        void get().startScan(request.path)
      },

      watchLaunchRequests() {
        const unsubscribe = api.onLaunchRequest((request) => get().receiveLaunchRequest(request))
        api.takeLaunchRequest().then(
          (request) => {
            if (request !== null) get().receiveLaunchRequest(request)
          },
          () => undefined,
        )
        return unsubscribe
      },

      async confirmLaunchScan() {
        const path = get().pendingLaunchScan
        set({ pendingLaunchScan: null })
        if (path !== null) await get().startScan(path)
      },

      declineLaunchScan() {
        set({ pendingLaunchScan: null })
      },

      async loadOptionsState() {
        try {
          return await api.getOptionsState()
        } catch {
          return null
        }
      },

      async changeExplorerMenu(enabled) {
        try {
          return await api.setExplorerMenu(enabled)
        } catch {
          return null
        }
      },

      async changeRunAsAdmin(enabled) {
        try {
          return await api.setRunAsAdmin(enabled)
        } catch {
          return null
        }
      },

      openWhatsNew(target) {
        set({ whatsNew: target })
      },

      closeWhatsNew() {
        set({ whatsNew: null })
      },

      async openLink(link) {
        try {
          await api.openLink(link)
        } catch (error) {
          fail(error)
        }
      },

      async openNotices() {
        try {
          return (await api.openNotices()).opened
        } catch (error) {
          fail(error)
          return false
        }
      },

      async loadChangelog() {
        try {
          return await api.getChangelog()
        } catch {
          return []
        }
      },

      loadReleaseNotes() {
        return api.getReleaseNotes()
      },

      async quit() {
        await api.quit()
      },
    }
  })

  function applyEvent(event: ScanEvent): void {
    const { phase, scanId } = store.getState()
    // The scanner can die after a scan ended (its tree is gone), so a failure for the current
    // scan is accepted in any phase that holds a scan.
    if (event.kind === 'failed' && scanId !== null && event.payload.scanId === scanId) {
      if (phase === 'scanning' || phase === 'done' || phase === 'canceled') failScan(event.payload)
      return
    }
    if (phase !== 'scanning') return
    if (scanId === null) {
      early.push(event)
      return
    }
    if (event.payload.scanId !== scanId) return
    if (event.kind === 'progress') {
      const { files, folders, bytes, allocatedBytes, errorCount, elapsedMs } = event.payload
      store.setState({ totals: { files, folders, bytes, allocatedBytes, errorCount }, elapsedMs })
      throttledBump()
    } else if (event.kind === 'done') {
      const revision = bumpRevision(store.getState().revision)
      const { files, folders, bytes, allocatedBytes, errorCount, elapsedMs, errors, status } =
        event.payload
      store.setState({
        phase: status === 'complete' ? 'done' : 'canceled',
        totals: { files, folders, bytes, allocatedBytes, errorCount },
        errors,
        elapsedMs,
        revision,
      })
      const { target } = store.getState()
      const root = target === null ? null : driveRootOf(target)
      if (root !== null) {
        api.getDriveInfo(root).then(
          (drive) => {
            if (store.getState().target === target) store.setState({ drive })
          },
          () => undefined,
        )
      }
    } else {
      failScan(event.payload)
    }
  }

  function failScan(payload: ScanFailed): void {
    const message =
      payload.message !== '' && payload.message !== SCANNER_STOPPED_MESSAGE
        ? payload.message
        : SCAN_CRASH_MESSAGE
    store.setState({
      phase: 'failed',
      banner: { tone: 'crash', message },
      revision: bumpRevision(store.getState().revision),
    })
  }

  function applyTreeChanged(changed: TreeChanged): void {
    const state = store.getState()
    if (changed.scanId !== state.scanId) return
    store.setState({
      totals: { ...changed.totals, errorCount: state.totals.errorCount },
      revision: bumpRevision(state.revision),
    })
    const { target, scanId } = state
    const root = target === null ? null : driveRootOf(target)
    if (root !== null) {
      api.getDriveInfo(root).then(
        (drive) => {
          const now = store.getState()
          if (now.target === target && now.scanId === scanId) store.setState({ drive })
        },
        () => undefined,
      )
    }
    void pruneSelection()
  }

  /**
   * After the tree changed: removes selected rows that no longer exist. Up to 200 rows are asked
   * from the scanner (8 at a time); a larger selection keeps only the active row. A result that
   * arrives after the scan or the revision changed is ignored (the next change prunes again).
   * Known limitation: the scanner may renumber ids inside a refreshed folder, so rows there can be
   * dropped here; a stale id is never kept, because main re-resolves every id it is sent.
   */
  async function pruneSelection(): Promise<void> {
    const start = store.getState()
    const { scanId, revision, selectedId } = start
    if (scanId === null) return
    const ids = [...start.selectedIds]
    if (ids.length > MAX_PRUNED_SELECTION) {
      store.setState({
        selectedIds: selectedId === null ? new Set() : new Set([selectedId]),
        anchorId: selectedId,
      })
      return
    }
    const checked =
      selectedId !== null && !start.selectedIds.has(selectedId) ? [...ids, selectedId] : ids
    if (checked.length === 0) return
    const { key, dir } = effectiveSort(start)
    const gone = new Set<NodeId>()
    let next = 0
    const lane = async (): Promise<void> => {
      while (next < checked.length) {
        const id = checked[next]
        next += 1
        if (id === undefined) return
        try {
          if ((await api.getNode(scanId, id, key, dir)) === null) gone.add(id)
        } catch {
          // The scanner is busy or gone: keep the row; the next change asks again.
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PRUNE_IN_FLIGHT, checked.length) }, lane))
    const now = store.getState()
    if (now.scanId !== scanId || now.revision !== revision || gone.size === 0) return
    const remaining = [...now.selectedIds].filter((id) => !gone.has(id))
    const activeGone = now.selectedId !== null && gone.has(now.selectedId)
    const activeId = activeGone ? (remaining[0] ?? null) : now.selectedId
    store.setState({
      selectedIds: new Set(remaining),
      selectedId: activeId,
      anchorId: now.anchorId !== null && gone.has(now.anchorId) ? activeId : now.anchorId,
      ...(activeGone && activeId !== null
        ? { treemapRootId: activeId.startsWith('f') ? now.treemapRootId : activeId }
        : {}),
    })
  }

  /** Main restarted the scan of the root itself: adopt the new scan like a user-started one. */
  function applyRestarted(restarted: ScanRestarted): void {
    const current = store.getState()
    if (current.target === null) return
    // A scan the user just started is still waiting for its id: that one wins.
    if (current.phase === 'scanning' && current.scanId === null) return
    early = []
    cancelWhenStarted = false
    generation += 1
    inFlight.clear()
    store.setState({
      lists: {},
      phase: 'scanning',
      target: restarted.root,
      scanId: restarted.scanId,
      totals: EMPTY_TOTALS,
      errors: [],
      elapsedMs: 0,
      expanded: new Set([ROOT_NODE_ID]),
      selectedId: ROOT_NODE_ID,
      selectedIds: new Set([ROOT_NODE_ID]),
      anchorId: ROOT_NODE_ID,
      scrollTarget: null,
      treemapRootId: ROOT_NODE_ID,
      banner: null,
      revision: bumpRevision(store.getState().revision),
    })
    const root = driveRootOf(restarted.root)
    if (root !== null) {
      api.getDriveInfo(root).then(
        (drive) => {
          if (store.getState().target === restarted.root) store.setState({ drive })
        },
        () => undefined,
      )
    }
  }

  let pushedUpdateState = false
  const unsubscribers = [
    api.onScanProgress((payload) => applyEvent({ kind: 'progress', payload })),
    api.onScanDone((payload) => applyEvent({ kind: 'done', payload })),
    api.onScanFailed((payload) => applyEvent({ kind: 'failed', payload })),
    api.onScanRestarted(applyRestarted),
    api.onTreeChanged(applyTreeChanged),
    api.onUpdateState((updateState) => {
      pushedUpdateState = true
      store.setState(
        updateState.kind === 'error'
          ? { updateState }
          : { updateState, dismissedDownloadError: false },
      )
    }),
  ]

  // Pull the current state after subscribing (a late reply cannot overwrite a newer push: both
  // are applied last-writer-wins and a push beats the reply), then open What's new when main says
  // it is due. It is marked seen as it opens, so closing the app with the dialog open still counts
  // as shown, and a re-init asks main again and gets nothing.
  void (async () => {
    try {
      const pulled = await api.getUpdateState()
      // A push that arrived meanwhile is newer than this reply.
      if (!pushedUpdateState) store.setState({ updateState: pulled })
    } catch {
      // Stay idle: the state arrives with the next push.
    }
    try {
      const due = await api.getWhatsNewDue()
      if (due === null) return
      await api.markWhatsNewSeen()
      store.setState({ whatsNew: { kind: 'installed', version: due.version } })
    } catch {
      // A failed lookup shows nothing.
    }
  })()

  // The "Scan another folder?" question only makes sense while that scan runs.
  const stopWatchingLaunchDialog = store.subscribe((state, previous) => {
    if (previous.phase === 'scanning' && state.phase !== 'scanning') {
      if (state.pendingLaunchScan !== null) store.setState({ pendingLaunchScan: null })
    }
  })

  return Object.assign(store, {
    dispose() {
      stopWatchingLaunchDialog()
      clearRevisionTimer()
      for (const unsubscribe of unsubscribers) unsubscribe()
    },
  })
}

import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ContextMenuOutcome, StorageIQApi, UpdateReady } from '@shared/ipc-contract'
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
import { CHUNK_SIZE, type ChildLists, type ChunkRef, rowInList } from '../lib/tree-view-model'

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
  selectedId: NodeId | null
  /** Ask the tree to scroll a row into view (seq changes on every request). */
  scrollTarget: { id: NodeId; seq: number } | null
  /** Bumps whenever the scanner's tree may have changed; loaded chunks older than it reload. */
  revision: number
  treemapVisible: boolean
  treemapDepth: number
  /** The folder the treemap shows. */
  treemapRootId: NodeId | null
  banner: Banner | null
  /** A downloaded update waiting for a restart; null when none or dismissed. */
  updateReady: UpdateReady | null
  /** Short polite message for screen readers (copied, created, …). */
  announcement: string
  folderPickerOpen: boolean

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
  /** Selects a row that may be hidden: expands its ancestors and loads its chunk. */
  reveal(id: NodeId): Promise<void>
  /** Treemap double-click: reveal the row and show its children in the treemap. */
  drillInto(id: NodeId): Promise<void>
  requestChunks(refs: readonly ChunkRef[]): void
  openInExplorer(id: NodeId): Promise<void>
  copyPath(id: NodeId): Promise<void>
  showContextMenu(id: NodeId, x: number, y: number, extended: boolean): Promise<void>
  createFolder(id: NodeId): Promise<void>
  /** Lays out the treemap of `treemapRootId` for a canvas of `width` × `height` CSS px. */
  fetchTreemap(width: number, height: number): Promise<TreemapLayout | null>
  setTreemapDepth(depth: number): void
  setTreemapVisible(visible: boolean): void
  dismissBanner(): void
  installUpdate(): Promise<void>
  /** Hides the update banner for this session. */
  dismissUpdate(): void
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

    const handleOutcome = (outcome: ContextMenuOutcome) => {
      if (outcome.kind === 'gone')
        set({ selectedId: null, announcement: GONE_MESSAGE, banner: null })
      if (outcome.kind === 'copied') set({ announcement: PATH_COPIED })
      if (outcome.kind === 'created') set({ announcement: `Created “${outcome.name}”.` })
      if (outcome.kind === 'opened') set({ announcement: 'Opened in Explorer.' })
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
      scrollTarget: null,
      revision: 0,
      treemapVisible: true,
      treemapDepth: DEFAULT_TREEMAP_DEPTH,
      treemapRootId: null,
      banner: null,
      updateReady: null,
      announcement: '',
      folderPickerOpen: false,

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
        set({ selectedId: id, treemapRootId: treemapRootFor(id) })
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
        set({ selectedId: id, scrollTarget: { id, seq } })
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

      async copyPath(id) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          await api.copyNodePath(scanId, id)
          set({ announcement: PATH_COPIED })
        } catch (error) {
          fail(error)
        }
      },

      async showContextMenu(id, x, y, extended) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          handleOutcome(
            await api.showContextMenu(
              scanId,
              id,
              Math.max(0, Math.round(x)),
              Math.max(0, Math.round(y)),
              extended,
            ),
          )
        } catch (error) {
          fail(error)
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

      dismissUpdate() {
        set({ updateReady: null })
      },

      async quit() {
        await api.quit()
      },
    }
  })

  function applyEvent(event: ScanEvent): void {
    const { phase, scanId } = store.getState()
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
      store.setState({
        phase: 'failed',
        banner: { tone: 'crash', message: SCAN_CRASH_MESSAGE },
        revision: bumpRevision(store.getState().revision),
      })
    }
  }

  function applyTreeChanged(changed: TreeChanged): void {
    const state = store.getState()
    if (changed.scanId !== state.scanId) return
    store.setState({
      totals: { ...changed.totals, errorCount: state.totals.errorCount },
      revision: bumpRevision(state.revision),
    })
    const root = state.target === null ? null : driveRootOf(state.target)
    if (root !== null) {
      api.getDriveInfo(root).then(
        (drive) => store.setState({ drive }),
        () => undefined,
      )
    }
  }

  /** Main restarted the scan of the root itself: adopt the new scan like a user-started one. */
  function applyRestarted(restarted: ScanRestarted): void {
    if (store.getState().target === null) return
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

  const unsubscribers = [
    api.onScanProgress((payload) => applyEvent({ kind: 'progress', payload })),
    api.onScanDone((payload) => applyEvent({ kind: 'done', payload })),
    api.onScanFailed((payload) => applyEvent({ kind: 'failed', payload })),
    api.onScanRestarted(applyRestarted),
    api.onTreeChanged(applyTreeChanged),
    api.onUpdateReady((ready) => store.setState({ updateReady: ready })),
  ]

  return Object.assign(store, {
    dispose() {
      clearRevisionTimer()
      for (const unsubscribe of unsubscribers) unsubscribe()
    },
  })
}

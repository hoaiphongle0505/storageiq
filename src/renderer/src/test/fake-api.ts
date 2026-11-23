import { vi } from 'vitest'
import type { AppInfo, SelectFolderResult, StorageIQApi, UpdateReady } from '@shared/ipc-contract'
import type {
  DriveDetails,
  DriveInfo,
  Places,
  ScanDone,
  ScanFailed,
  ScanProgress,
  ScanRestarted,
  ScanStartResult,
} from '@shared/scan-types'
import type {
  NodeId,
  SortDir,
  SortKey,
  TreeChanged,
  TreemapLayout,
  TreeNodeDetails,
  TreePage,
  TreeRow,
} from '@shared/tree-types'

export const TEST_APP_INFO: AppInfo = {
  name: 'StorageIQ',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '45.3.4',
}

const MB = 1024 ** 2
const GB = 1024 ** 3

export const TEST_DRIVES: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 512 * GB, freeBytes: 128 * GB },
  { root: 'E:\\', label: 'Photos', kind: 'removable', totalBytes: 64 * GB, freeBytes: 16 * GB },
]

export const TEST_PLACES: Places = {
  places: [
    { kind: 'documents', label: 'Documents', path: 'C:\\Users\\Ana\\Documents' },
    { kind: 'onedrive', label: 'OneDrive', path: 'C:\\Users\\Ana\\OneDrive' },
  ],
  recent: [],
}

export const TEST_DRIVE_DETAILS: DriveDetails = {
  root: 'D:\\',
  totalBytes: 1024 * GB,
  freeBytes: 400 * GB,
  clusterBytes: 4096,
  fileSystem: 'NTFS',
}

function row(fields: Partial<TreeRow> & Pick<TreeRow, 'id' | 'name'>): TreeRow {
  return {
    parentId: 'd0',
    kind: 'folder',
    size: 0,
    allocated: 0,
    files: 0,
    folders: 0,
    modifiedMs: Date.UTC(2026, 10, 19, 12),
    childCount: 0,
    ...fields,
  }
}

/**
 * D:\ (3.0 GB)
 *   Videos 2.0 GB (d1) → Clips 1.5 GB (d3), [1 file] 0.5 GB (g1 → movie.mp4 f1)
 *   Photos 768 MB (d2)
 *   [3 files] 256 MB (g0)
 */
export const TEST_ROWS: Record<NodeId, TreeRow> = {
  d0: row({
    id: 'd0',
    parentId: null,
    name: 'D:\\',
    size: 3 * GB,
    allocated: 3 * GB + 8 * MB,
    files: 1014,
    folders: 53,
    childCount: 3,
  }),
  d1: row({
    id: 'd1',
    name: 'Videos',
    size: 2 * GB,
    allocated: 2 * GB,
    files: 10,
    folders: 1,
    childCount: 2,
  }),
  d2: row({
    id: 'd2',
    name: 'Photos',
    size: 768 * MB,
    allocated: 776 * MB,
    files: 1000,
    folders: 50,
    childCount: 0,
  }),
  g0: row({
    id: 'g0',
    kind: 'files',
    name: '',
    size: 256 * MB,
    allocated: 256 * MB,
    files: 3,
    childCount: 3,
  }),
  d3: row({
    id: 'd3',
    parentId: 'd1',
    name: 'Clips',
    size: 1.5 * GB,
    allocated: 1.5 * GB,
    files: 9,
    childCount: 0,
  }),
  g1: row({
    id: 'g1',
    parentId: 'd1',
    kind: 'files',
    name: '',
    size: 0.5 * GB,
    allocated: 0.5 * GB,
    files: 1,
    childCount: 1,
  }),
  f1: row({
    id: 'f1',
    parentId: 'g1',
    kind: 'file',
    name: 'movie.mp4',
    size: 0.5 * GB,
    allocated: 0.5 * GB,
    files: 1,
  }),
}

const CHILDREN: Record<NodeId, NodeId[]> = {
  d0: ['d1', 'd2', 'g0'],
  d1: ['d3', 'g1'],
  g1: ['f1'],
  g0: [],
}

const PATHS: Record<NodeId, string> = {
  d0: 'D:\\',
  d1: 'D:\\Videos',
  d2: 'D:\\Photos',
  g0: 'D:\\',
  d3: 'D:\\Videos\\Clips',
  g1: 'D:\\Videos',
  f1: 'D:\\Videos\\movie.mp4',
}

function sortedChildren(nodeId: NodeId, key: SortKey, dir: SortDir): TreeRow[] {
  const rows = (CHILDREN[nodeId] ?? []).map((id) => TEST_ROWS[id]).filter((r): r is TreeRow => !!r)
  const value = (r: TreeRow): number | string =>
    key === 'name' ? r.name : key === 'modified' ? r.modifiedMs : r[key]
  return rows.sort((a, b) => {
    const left = value(a)
    const right = value(b)
    const order =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right))
    return (dir === 'asc' ? order : -order) || a.id.localeCompare(b.id)
  })
}

export function fakeChildren(
  nodeId: NodeId,
  key: SortKey,
  dir: SortDir,
  offset: number,
  limit: number,
): TreePage | null {
  const parent = TEST_ROWS[nodeId]
  if (parent === undefined) return null
  const rows = sortedChildren(nodeId, key, dir)
  return { parent, total: rows.length, offset, rows: rows.slice(offset, offset + limit) }
}

export function fakeNode(nodeId: NodeId, key: SortKey, dir: SortDir): TreeNodeDetails | null {
  const row = TEST_ROWS[nodeId]
  if (row === undefined) return null
  const chain: NodeId[] = []
  for (let id: NodeId | null = row.parentId; id !== null; id = TEST_ROWS[id]?.parentId ?? null) {
    chain.unshift(id)
  }
  const steps = [...chain, nodeId]
  const locations = steps.slice(1).map((id, i) => {
    const parentId = steps[i] ?? 'd0'
    return { parentId, index: sortedChildren(parentId, key, dir).findIndex((r) => r.id === id) }
  })
  return { row, path: PATHS[nodeId] ?? '', ancestorIds: chain, locations }
}

/** Two side-by-side blocks for the root's two largest children; enough to test clicks. */
export function fakeTreemap(nodeId: NodeId, width: number, height: number): TreemapLayout {
  const half = Math.round(width / 2)
  return {
    nodeId,
    width,
    height,
    rects: [
      {
        id: 'd1',
        kind: 'folder',
        name: 'Videos',
        value: 2 * GB,
        files: 10,
        depth: 0,
        x: 0,
        y: 0,
        w: half,
        h: height,
        nested: false,
        category: 'video',
      },
      {
        id: 'd2',
        kind: 'folder',
        name: 'Photos',
        value: 768 * MB,
        files: 1000,
        depth: 0,
        x: half,
        y: 0,
        w: width - half,
        h: height,
        nested: false,
        category: 'image',
      },
    ],
    categories: [
      { category: 'video', bytes: 2 * GB },
      { category: 'image', bytes: 768 * MB },
    ],
  }
}

/** A fake bridge plus `emit…` helpers that play the main process sending events. */
export interface FakeApi extends StorageIQApi {
  emitScanProgress(progress: ScanProgress): void
  emitScanDone(done: ScanDone): void
  emitScanFailed(failed: ScanFailed): void
  emitScanRestarted(restarted: ScanRestarted): void
  emitTreeChanged(changed: TreeChanged): void
  emitUpdateReady(ready: UpdateReady): void
  /** Subscribed event listeners across all channels. */
  listenerCount(): number
}

function createChannel<T>() {
  const listeners = new Set<(payload: T) => void>()
  return {
    subscribe: (listener: (payload: T) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: (payload: T) => {
      for (const listener of [...listeners]) listener(payload)
    },
    size: () => listeners.size,
  }
}

export function createFakeApi(overrides: Partial<StorageIQApi> = {}): FakeApi {
  const progress = createChannel<ScanProgress>()
  const done = createChannel<ScanDone>()
  const failed = createChannel<ScanFailed>()
  const restarted = createChannel<ScanRestarted>()
  const changed = createChannel<TreeChanged>()
  const updateReady = createChannel<UpdateReady>()
  return {
    getAppInfo: vi.fn(async () => TEST_APP_INFO),
    quit: vi.fn(async () => undefined),
    selectFolder: vi.fn(async (): Promise<SelectFolderResult> => ({ canceled: true })),
    listDrives: vi.fn(async () => TEST_DRIVES),
    getDriveInfo: vi.fn(async () => TEST_DRIVE_DETAILS),
    listPlaces: vi.fn(async () => TEST_PLACES),
    startScan: vi.fn(async (): Promise<ScanStartResult> => ({ scanId: 'scan-1' })),
    cancelScan: vi.fn(async () => undefined),
    getChildren: vi.fn(async (_scanId, nodeId, key, dir, offset, limit) =>
      fakeChildren(nodeId, key, dir, offset, limit),
    ),
    getNode: vi.fn(async (_scanId, nodeId, key, dir) => fakeNode(nodeId, key, dir)),
    getExpandIds: vi.fn(async () => ['d0', 'd1']),
    refreshFolder: vi.fn(async (_scanId, nodeId) => fakeNode(nodeId, 'size', 'desc')),
    getTreemap: vi.fn(async (_scanId, nodeId, _mode, _depth, width, height) =>
      fakeTreemap(nodeId, width, height),
    ),
    openInExplorer: vi.fn(async () => undefined),
    showContextMenu: vi.fn(async () => ({ kind: 'dismissed' as const })),
    createFolder: vi.fn(async () => ({ parentId: 'd1', name: 'New folder' })),
    copyNodePath: vi.fn(async () => undefined),
    onScanProgress: vi.fn(progress.subscribe),
    onScanDone: vi.fn(done.subscribe),
    onScanFailed: vi.fn(failed.subscribe),
    onScanRestarted: vi.fn(restarted.subscribe),
    onTreeChanged: vi.fn(changed.subscribe),
    installUpdate: vi.fn(async () => undefined),
    onUpdateReady: vi.fn(updateReady.subscribe),
    ...overrides,
    emitScanProgress: progress.emit,
    emitScanDone: done.emit,
    emitScanFailed: failed.emit,
    emitScanRestarted: restarted.emit,
    emitTreeChanged: changed.emit,
    emitUpdateReady: updateReady.emit,
    listenerCount: () =>
      progress.size() +
      done.size() +
      failed.size() +
      restarted.size() +
      changed.size() +
      updateReady.size(),
  }
}

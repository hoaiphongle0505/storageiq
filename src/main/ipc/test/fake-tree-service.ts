import { vi } from 'vitest'
import type { ScannerQuery, ScanVolume } from '@shared/scanner-protocol'
import type { TreeNodeDetails, TreeRow, TreeTotals } from '@shared/tree-types'
import type { TreeScanService } from '../tree-handlers'

export const SCAN = '0d6b2f6e-8a3c-4c1e-9f61-2b8f6a1d5e10'
export const TOTALS: TreeTotals = { files: 3, folders: 1, bytes: 300, allocatedBytes: 12_288 }

export function row(overrides: Partial<TreeRow> = {}): TreeRow {
  return {
    id: 'd1',
    parentId: 'd0',
    kind: 'folder',
    name: 'Photos',
    size: 300,
    allocated: 8192,
    files: 2,
    folders: 0,
    modifiedMs: 0,
    childCount: 1,
    ...overrides,
  }
}

/** Nodes of a tiny scan of `D:\Data`: the root, Photos (d1), its "[N files]" (g1) and a file. */
export const NODES: Record<string, TreeNodeDetails> = {
  d0: {
    row: row({ id: 'd0', parentId: null, name: 'D:\\Data' }),
    path: 'D:\\Data',
    ancestorIds: [],
    locations: [],
  },
  d1: {
    row: row(),
    path: 'D:\\Data\\Photos',
    ancestorIds: ['d0'],
    locations: [{ parentId: 'd0', index: 0 }],
  },
  g1: {
    row: row({ id: 'g1', parentId: 'd1', kind: 'files', name: '' }),
    path: 'D:\\Data\\Photos',
    ancestorIds: ['d0', 'd1'],
    locations: [],
  },
  f7: {
    row: row({ id: 'f7', parentId: 'g1', kind: 'file', name: 'a.jpg', files: 1, childCount: 0 }),
    path: 'D:\\Data\\Photos\\a.jpg',
    ancestorIds: ['d0', 'd1', 'g1'],
    locations: [],
  },
  f10: {
    row: row({ id: 'f10', parentId: 'g1', kind: 'file', name: 'c.jpg', files: 1, childCount: 0 }),
    path: 'D:\\Data\\Photos\\c.jpg',
    ancestorIds: ['d0', 'd1', 'g1'],
    locations: [],
  },
  d2: {
    row: row({ id: 'd2', name: 'Docs' }),
    path: 'D:\\Data\\Docs',
    ancestorIds: ['d0'],
    locations: [{ parentId: 'd0', index: 1 }],
  },
  g2: {
    row: row({ id: 'g2', parentId: 'd2', kind: 'files', name: '' }),
    path: 'D:\\Data\\Docs',
    ancestorIds: ['d0', 'd2'],
    locations: [],
  },
  f9: {
    row: row({ id: 'f9', parentId: 'g2', kind: 'file', name: 'b.txt', files: 1, childCount: 0 }),
    path: 'D:\\Data\\Docs\\b.txt',
    ancestorIds: ['d0', 'd2', 'g2'],
    locations: [],
  },
  d3: {
    row: row({ id: 'd3', parentId: 'd1', name: 'Raw' }),
    path: 'D:\\Data\\Photos\\Raw',
    ancestorIds: ['d0', 'd1'],
    locations: [],
  },
}

/** A scan service whose scanner answers from `NODES`. */
export function fakeTreeService(
  options: {
    scanning?: boolean
    current?: string | null
    /** More nodes than `NODES`. */
    extra?: Record<string, TreeNodeDetails>
  } = {},
) {
  /** Looked up on every call, so a test may add to `NODES` while the service lives. */
  const node = (id: string): TreeNodeDetails | null => options.extra?.[id] ?? NODES[id] ?? null
  const queries: ScannerQuery[] = []
  const start = vi.fn<(root: string, volume: ScanVolume) => { scanId: string }>(() => ({
    scanId: 'rescan-1',
  }))
  const volumeFor = vi.fn(async (): Promise<ScanVolume> => ({ clusterBytes: 8192, freeBytes: 77 }))
  const service: TreeScanService = {
    currentScan: () =>
      options.current === null ? null : { scanId: options.current ?? SCAN, root: 'D:\\Data' },
    isScanning: () => options.scanning ?? false,
    start,
    query: vi.fn(async (query: ScannerQuery) => {
      queries.push(query)
      switch (query.kind) {
        case 'node':
        case 'refresh':
          return node(query.nodeId)
        case 'paths':
          return query.nodeIds.map((id) => {
            const found = node(id)
            return found === null ? null : { row: found.row, path: found.path }
          })
        case 'totals':
          return TOTALS
        case 'expand':
          return ['d0']
        default:
          return null
      }
    }) as TreeScanService['query'],
  }
  return { service, queries, start, volumeFor, node }
}

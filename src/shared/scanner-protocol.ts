import type { ScanDone, ScanFailed, ScanProgress } from './scan-types'
import type {
  NodeId,
  SizeMode,
  SortDir,
  SortKey,
  TreemapLayout,
  TreeNodeDetails,
  TreeNodePath,
  TreePage,
  TreeTotals,
} from './tree-types'

/** Name of the scanner utilityProcess; it is the `name` in `app.getAppMetrics()`. */
export const SCANNER_SERVICE_NAME = 'StorageIQ scanner'

/** Most ids one `paths` query takes. */
export const MAX_PATH_QUERY_IDS = 64

/** Used when main could not read the drive's cluster size (the NTFS default). */
export const DEFAULT_CLUSTER_BYTES = 4096

/** Questions main asks the scanner about its tree, plus the folder refresh. */
export type ScannerQuery =
  | {
      kind: 'children'
      scanId: string
      nodeId: NodeId
      sortKey: SortKey
      sortDir: SortDir
      offset: number
      limit: number
    }
  | { kind: 'node'; scanId: string; nodeId: NodeId; sortKey: SortKey; sortDir: SortDir }
  | { kind: 'expand'; scanId: string; nodeId: NodeId; levels: number }
  /** Row and path of up to `MAX_PATH_QUERY_IDS` ids in one message (no sorting; for icons). */
  | { kind: 'paths'; scanId: string; nodeIds: NodeId[] }
  | {
      kind: 'treemap'
      scanId: string
      nodeId: NodeId
      mode: SizeMode
      depth: number
      width: number
      height: number
    }
  | { kind: 'refresh'; scanId: string; nodeId: NodeId }
  | { kind: 'totals'; scanId: string }

/** The result type of each query kind. */
export interface ScannerQueryResults {
  children: TreePage | null
  node: TreeNodeDetails | null
  expand: NodeId[]
  paths: Array<TreeNodePath | null>
  treemap: TreemapLayout | null
  refresh: TreeNodeDetails | null
  totals: TreeTotals | null
}

export type ScannerQueryKind = ScannerQuery['kind']
export type ScannerQueryOf<K extends ScannerQueryKind> = Extract<ScannerQuery, { kind: K }>

/** Drive facts main reads with koffi and hands to the scanner at scan start. */
export interface ScanVolume {
  /** Bytes per cluster; allocated size is `ceil(size / clusterBytes) * clusterBytes`. */
  clusterBytes: number
  /** Free bytes on the drive for the treemap's "Free space" block; null unless a drive root. */
  freeBytes: number | null
}

/** main → scanner process. */
export type ScannerRequest =
  | { type: 'start'; scanId: string; root: string; volume: ScanVolume }
  | { type: 'cancel'; scanId: string }
  | { type: 'query'; requestId: number; query: ScannerQuery }

/** scanner process → main. */
export type ScannerMessage =
  | { type: 'progress'; payload: ScanProgress }
  | { type: 'done'; payload: ScanDone }
  | { type: 'failed'; payload: ScanFailed }
  | { type: 'reply'; requestId: number; ok: true; result: unknown }
  | { type: 'reply'; requestId: number; ok: false; message: string }

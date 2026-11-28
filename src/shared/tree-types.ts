/**
 * Row identity in the scan tree. The scanner owns the tree; the renderer only ever holds pages.
 * `d<n>` is folder n (`d0` is the scanned root), `g<n>` is the "[N files]" row that groups the
 * files directly in folder n, and `f<n>` is file n.
 */
export type NodeId = string

export const ROOT_NODE_ID: NodeId = 'd0'
export const NODE_ID_PATTERN = /^[dgf]\d{1,9}$/

export type NodeKind = 'folder' | 'files' | 'file'

/** The Mode toggle: the value the tree bars and the treemap use. */
export type SizeMode = 'size' | 'allocated' | 'files' | 'percent'
export const SIZE_MODES: readonly SizeMode[] = ['size', 'allocated', 'files', 'percent']

/** Keys the scanner can sort children by. The "% of Parent" column sorts by the Mode value. */
export type SortKey = 'name' | 'size' | 'allocated' | 'files' | 'folders' | 'modified'
export const SORT_KEYS: readonly SortKey[] = [
  'name',
  'size',
  'allocated',
  'files',
  'folders',
  'modified',
]

export type SortDir = 'asc' | 'desc'

/** Most rows one `tree:children` call returns. */
export const MAX_PAGE_ROWS = 1000

/** Deepest treemap nesting the level bar offers (Level 0 to Level 5). */
export const MAX_TREEMAP_DEPTH = 5

/** One row of the column tree. */
export interface TreeRow {
  id: NodeId
  parentId: NodeId | null
  kind: NodeKind
  /** Folder or file name; the scanned path for the root; `''` for a "[N files]" row. */
  name: string
  /** Logical size in bytes (`stat.size`). */
  size: number
  /** Size rounded up to whole clusters. */
  allocated: number
  /** Files below this row (1 for a file). */
  files: number
  /** Folders below this row, not counting itself. */
  folders: number
  /** Newest modification time below this row, in ms since the epoch (0 when unknown). */
  modifiedMs: number
  /** Number of child rows (`tree:children` total). */
  childCount: number
}

/** A page of a row's children, in the requested order. */
export interface TreePage {
  parent: TreeRow
  /** All children of `parent`, not just this page. */
  total: number
  offset: number
  rows: TreeRow[]
}

/** Where one node sits: each ancestor and the node's own index in its parent's sorted children. */
export interface TreeLocation {
  parentId: NodeId
  index: number
}

/** What the icon lookup needs of a row: the row itself and its path (no ancestors, no sorting). */
export interface TreeNodePath {
  row: TreeRow
  path: string
}

export interface TreeNodeDetails {
  row: TreeRow
  /** Full path on disk. */
  path: string
  /** From the root down to the node's parent. */
  ancestorIds: NodeId[]
  /** For each step from the root down to the node: the child's index in the requested sort. */
  locations: TreeLocation[]
}

export type TreemapBlockKind = NodeKind | 'free'

/**
 * File types the treemap colours by. The order is the index the scanner stores per file: never
 * reorder, only append.
 */
export const FILE_CATEGORIES = [
  'video',
  'image',
  'audio',
  'document',
  'archive',
  'code',
  'app',
  'system',
  'disk-image',
  'other',
] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

/** Logical bytes of one file type. */
export interface CategoryShare {
  category: FileCategory
  bytes: number
}

/** One rectangle of the treemap, in CSS pixels of the requested canvas size. */
export interface TreemapRect {
  /** `null` for the "Free space" block. */
  id: NodeId | null
  kind: TreemapBlockKind
  name: string
  /** The Mode value the area stands for. */
  value: number
  /** Files below the block (for the "[N files]" label). */
  files: number
  /** 0 for the selected folder's children, 1 for their children, and so on. */
  depth: number
  x: number
  y: number
  w: number
  h: number
  /** True when the rectangle holds nested rectangles under a label strip. */
  nested: boolean
  /**
   * A file's own type; for a folder or "[N files]" block the dominant type (at least half of its
   * logical bytes). `null` for free space, a mixed folder or a block with no bytes.
   */
  category: FileCategory | null
}

export interface TreemapLayout {
  nodeId: NodeId
  width: number
  height: number
  rects: TreemapRect[]
  /** Logical bytes per file type in the laid-out node, largest first, empty types left out. */
  categories: CategoryShare[]
}

/** Totals of the scanned root; sent with `tree:changed` after a folder is refreshed. */
export interface TreeTotals {
  files: number
  folders: number
  bytes: number
  allocatedBytes: number
}

export interface TreeChanged {
  scanId: string
  /** The folder that was rescanned. */
  nodeId: NodeId
  totals: TreeTotals
}

/** The value a row stands for in the given Mode (Percent ranks by size). */
export function modeValue(
  row: Pick<TreeRow, 'size' | 'allocated' | 'files'>,
  mode: SizeMode,
): number {
  switch (mode) {
    case 'allocated':
      return row.allocated
    case 'files':
      return row.files
    case 'size':
    case 'percent':
      return row.size
  }
}

/** The sort key that ranks rows by the Mode value. */
export function modeSortKey(mode: SizeMode): SortKey {
  if (mode === 'allocated') return 'allocated'
  if (mode === 'files') return 'files'
  return 'size'
}

export function folderIndexOf(id: NodeId): number | null {
  return id.startsWith('d') || id.startsWith('g') ? Number(id.slice(1)) : null
}

/** Most rows the Top files view lists. */
export const TOP_FILES_LIMIT = 1000
/** Most extensions the Types view lists before it sums the rest into "Other extensions". */
export const TYPE_ROWS_LIMIT = 500

/** One row of the Top files view. */
export interface TopFileRow {
  /** `f<n>`: works with `icons:for-nodes` and `shell:context-menu`. */
  id: NodeId
  name: string
  /** Path of the folder that holds the file. */
  folder: string
  /** Logical size in bytes. */
  size: number
  /** Size rounded up to whole clusters. */
  allocated: number
  /** Modification time in ms since the epoch, to the second (0 when unknown). */
  modifiedMs: number
}

/** `extension`: files with that extension; `none`: files without one; `other`: the rest. */
export type TypeRowKind = 'extension' | 'none' | 'other'

/** One row of the Types view: the files of one extension below a folder. */
export interface TypeRow {
  kind: TypeRowKind
  /** Lower case, no dot; `''` for `none` and `other`. */
  ext: string
  /** The file type colour; `null` for the "Other extensions" row. */
  category: FileCategory | null
  size: number
  allocated: number
  files: number
}

export type AgeBucketId =
  | 'last-30-days'
  | 'months-1-3'
  | 'months-3-6'
  | 'months-6-12'
  | 'years-1-2'
  | 'years-2-5'
  | 'over-5-years'
  | 'unknown'

/** The age buckets in display order; the scanner always returns one row per entry. */
export const AGE_BUCKETS: ReadonlyArray<{ id: AgeBucketId; label: string }> = [
  { id: 'last-30-days', label: 'Last 30 days' },
  { id: 'months-1-3', label: '1–3 months' },
  { id: 'months-3-6', label: '3–6 months' },
  { id: 'months-6-12', label: '6–12 months' },
  { id: 'years-1-2', label: '1–2 years' },
  { id: 'years-2-5', label: '2–5 years' },
  { id: 'over-5-years', label: 'Over 5 years' },
  { id: 'unknown', label: 'Unknown date' },
]

/** One row of the Age view: the files of one modification-age bucket below a folder. */
export interface AgeRow {
  id: AgeBucketId
  label: string
  size: number
  allocated: number
  files: number
}

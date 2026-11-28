import { fileExtension } from '@shared/file-category'
import {
  AGE_BUCKETS,
  FILE_CATEGORIES,
  TOP_FILES_LIMIT,
  TYPE_ROWS_LIMIT,
  type AgeRow,
  type NodeId,
  type SizeMode,
  type TopFileRow,
  type TypeRow,
} from '@shared/tree-types'
import { folderOf, resolveNode } from './tree-queries'
import type { TreeStore } from './tree-store'

const DAY_MS = 86_400_000
/** Upper edges of the first six age buckets, in days (the last two buckets have no edge). */
const AGE_EDGES_DAYS = [30, 91, 182, 365, 730, 1826] as const
/** Results kept between calls; a change to the tree empties them. */
const CACHE_SIZE = 24

/** Top files rank by allocated size in Allocated mode and by logical size in every other mode. */
export function rankByOf(mode: SizeMode): 'size' | 'allocated' {
  return mode === 'allocated' ? 'allocated' : 'size'
}

/** Calls `visit` for every file below `folder`. The root loops over all files instead of walking. */
function forEachFile(store: TreeStore, folder: number, visit: (file: number) => void): void {
  if (folder === 0) {
    for (let file = 0; file < store.fileLength; file += 1) {
      if (store.isLiveFile(file)) visit(file)
    }
    return
  }
  const pending = [folder]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const file of store.filesIn(next)) visit(file)
    for (const child of store.childFolders(next)) pending.push(child)
  }
}

/**
 * The `limit` biggest files below `folder`, biggest first; equal sizes keep the file that was
 * scanned first. A min-heap of `limit` files holds the best so far, so memory stays small.
 */
export function topFiles(
  store: TreeStore,
  folder: number,
  rankBy: 'size' | 'allocated',
  limit: number,
): TopFileRow[] {
  if (limit <= 0) return []
  const value = (file: number) =>
    rankBy === 'allocated' ? store.fileAllocated(file) : store.fileSize(file)
  /** True when `a` ranks below `b`. */
  const worse = (a: number, b: number) => {
    const diff = value(a) - value(b)
    return diff !== 0 ? diff < 0 : a > b
  }
  const heap: number[] = []
  const swap = (i: number, j: number) => {
    const held = heap[i] as number
    heap[i] = heap[j] as number
    heap[j] = held
  }
  const siftUp = (from: number) => {
    for (let i = from; i > 0;) {
      const parent = (i - 1) >> 1
      if (!worse(heap[i] as number, heap[parent] as number)) return
      swap(i, parent)
      i = parent
    }
  }
  const siftDown = (from: number) => {
    for (let i = from; ;) {
      let lowest = i
      const left = 2 * i + 1
      const right = left + 1
      if (left < heap.length && worse(heap[left] as number, heap[lowest] as number)) lowest = left
      if (right < heap.length && worse(heap[right] as number, heap[lowest] as number))
        lowest = right
      if (lowest === i) return
      swap(i, lowest)
      i = lowest
    }
  }
  forEachFile(store, folder, (file) => {
    if (heap.length < limit) {
      heap.push(file)
      siftUp(heap.length - 1)
    } else if (worse(heap[0] as number, file)) {
      heap[0] = file
      siftDown(0)
    }
  })
  heap.sort((a, b) => (worse(a, b) ? 1 : worse(b, a) ? -1 : 0))
  const folders = new Map<number, string>()
  return heap.map((file) => {
    const parent = store.fileParent(file)
    let path = folders.get(parent)
    if (path === undefined) {
      path = store.folderPath(parent)
      folders.set(parent, path)
    }
    return {
      id: `f${file}`,
      name: store.fileName(file),
      folder: path,
      size: store.fileSize(file),
      allocated: store.fileAllocated(file),
      modifiedMs: store.fileModified(file),
    }
  })
}

/**
 * Bytes per file extension below `folder`, biggest first (ties by extension). Files without an
 * extension are one `none` row. When there are more than `limit` groups, the rest are summed into
 * one `other` row after the first `limit`.
 */
export function typeBreakdown(store: TreeStore, folder: number, limit: number): TypeRow[] {
  const groups = new Map<string, TypeRow>()
  forEachFile(store, folder, (file) => {
    const ext = fileExtension(store.fileName(file))
    let group = groups.get(ext)
    if (group === undefined) {
      group = {
        kind: ext === '' ? 'none' : 'extension',
        ext,
        category: FILE_CATEGORIES[store.fileCategoryOf(file)] ?? 'other',
        size: 0,
        allocated: 0,
        files: 0,
      }
      groups.set(ext, group)
    }
    group.size += store.fileSize(file)
    group.allocated += store.fileAllocated(file)
    group.files += 1
  })
  const rows = [...groups.values()].sort((a, b) => b.size - a.size || a.ext.localeCompare(b.ext))
  if (rows.length <= limit) return rows
  const rest: TypeRow = { kind: 'other', ext: '', category: null, size: 0, allocated: 0, files: 0 }
  for (const row of rows.slice(limit)) {
    rest.size += row.size
    rest.allocated += row.allocated
    rest.files += row.files
  }
  return [...rows.slice(0, limit), rest]
}

/** Index into `AGE_BUCKETS` for a file modified at `modifiedMs`, seen at `nowMs`. */
function bucketOf(modifiedMs: number, nowMs: number): number {
  if (modifiedMs === 0 || modifiedMs > nowMs + DAY_MS) return AGE_BUCKETS.length - 1
  const ageMs = nowMs - modifiedMs
  const edge = AGE_EDGES_DAYS.findIndex((days) => ageMs < days * DAY_MS)
  return edge === -1 ? AGE_EDGES_DAYS.length : edge
}

/** Bytes per modification-age bucket below `folder`: always all 8 buckets, in display order. */
export function ageBreakdown(store: TreeStore, folder: number, nowMs: number): AgeRow[] {
  const rows: AgeRow[] = AGE_BUCKETS.map((bucket) => ({
    ...bucket,
    size: 0,
    allocated: 0,
    files: 0,
  }))
  forEachFile(store, folder, (file) => {
    const row = rows[bucketOf(store.fileModified(file), nowMs)]
    if (row === undefined) return
    row.size += store.fileSize(file)
    row.allocated += store.fileAllocated(file)
    row.files += 1
  })
  return rows
}

/**
 * The three side views of one tree, with their last results kept until the tree changes
 * (`store.version`), the way the treemap layout is kept. A node that is gone gives `null`; a
 * file or "[N files]" row stands for its folder.
 */
export class SideViews {
  private version = -1
  private readonly cache = new Map<string, unknown>()

  constructor(
    private readonly store: TreeStore,
    private readonly nowMs: () => number = Date.now,
  ) {}

  topFiles(nodeId: NodeId, mode: SizeMode): TopFileRow[] | null {
    const rankBy = rankByOf(mode)
    return this.answer(nodeId, `top:${rankBy}`, (folder) =>
      topFiles(this.store, folder, rankBy, TOP_FILES_LIMIT),
    )
  }

  types(nodeId: NodeId): TypeRow[] | null {
    return this.answer(nodeId, 'types', (folder) =>
      typeBreakdown(this.store, folder, TYPE_ROWS_LIMIT),
    )
  }

  age(nodeId: NodeId): AgeRow[] | null {
    return this.answer(nodeId, 'age', (folder) => ageBreakdown(this.store, folder, this.nowMs()))
  }

  private answer<T>(nodeId: NodeId, kind: string, compute: (folder: number) => T): T | null {
    const ref = resolveNode(this.store, nodeId)
    if (ref === null) return null
    const folder = folderOf(this.store, ref)
    if (this.version !== this.store.version) {
      this.cache.clear()
      this.version = this.store.version
    }
    const key = `${kind}:${folder}`
    if (this.cache.has(key)) return this.cache.get(key) as T
    const result = compute(folder)
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(key, result)
    return result
  }
}

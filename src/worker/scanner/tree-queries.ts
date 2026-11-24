import {
  MAX_PAGE_ROWS,
  NODE_ID_PATTERN,
  type NodeId,
  type SortDir,
  type SortKey,
  type TreeLocation,
  type TreeNodeDetails,
  type TreeNodePath,
  type TreePage,
  type TreeRow,
} from '@shared/tree-types'
import type { TreeStore } from './tree-store'

/** A resolved row: folder `index`, the files directly in folder `index`, or file `index`. */
export type NodeRef =
  | { kind: 'folder'; index: number }
  | { kind: 'files'; index: number }
  | { kind: 'file'; index: number }

/** Most folders `expandIds` returns, so "Expand all" on a huge drive stays bounded. */
export const MAX_EXPAND_IDS = 5000
/** Sorted child orders kept between calls (one per recently viewed folder and sort). */
const SORT_CACHE_SIZE = 64

export function nodeIdOf(ref: NodeRef): NodeId {
  const prefix = ref.kind === 'folder' ? 'd' : ref.kind === 'files' ? 'g' : 'f'
  return `${prefix}${ref.index}`
}

/** Parses a `NodeId` and checks it names a live entry of `store`. */
export function resolveNode(store: TreeStore, id: NodeId): NodeRef | null {
  if (!NODE_ID_PATTERN.test(id)) return null
  const index = Number(id.slice(1))
  if (id.startsWith('f')) return store.isLiveFile(index) ? { kind: 'file', index } : null
  if (!store.isLiveFolder(index)) return null
  if (id.startsWith('g')) return store.directFiles(index) > 0 ? { kind: 'files', index } : null
  return { kind: 'folder', index }
}

export function parentOf(store: TreeStore, ref: NodeRef): NodeRef | null {
  if (ref.kind === 'file') return { kind: 'files', index: store.fileParent(ref.index) }
  if (ref.kind === 'files') return { kind: 'folder', index: ref.index }
  const parent = store.folderParent(ref.index)
  return parent < 0 ? null : { kind: 'folder', index: parent }
}

/** The folder a row belongs to: itself for a folder, its folder for "[N files]" and files. */
export function folderOf(store: TreeStore, ref: NodeRef): number {
  return ref.kind === 'file' ? store.fileParent(ref.index) : ref.index
}

export function rowOf(store: TreeStore, ref: NodeRef): TreeRow {
  const parent = parentOf(store, ref)
  const parentId = parent === null ? null : nodeIdOf(parent)
  if (ref.kind === 'folder') {
    const i = ref.index
    const direct = store.directFiles(i)
    return {
      id: nodeIdOf(ref),
      parentId,
      kind: 'folder',
      name: store.folderName(i),
      size: store.folderSize(i),
      allocated: store.folderAllocated(i),
      files: store.folderFiles(i),
      folders: store.folderFolders(i),
      modifiedMs: store.folderModified(i),
      childCount: store.folderChildCount(i) + (direct > 0 ? 1 : 0),
    }
  }
  if (ref.kind === 'files') {
    const i = ref.index
    return {
      id: nodeIdOf(ref),
      parentId,
      kind: 'files',
      name: '',
      size: store.directSize(i),
      allocated: store.directAllocated(i),
      files: store.directFiles(i),
      folders: 0,
      modifiedMs: store.directModified(i),
      childCount: store.directFiles(i),
    }
  }
  const j = ref.index
  return {
    id: nodeIdOf(ref),
    parentId,
    kind: 'file',
    name: store.fileName(j),
    size: store.fileSize(j),
    allocated: store.fileAllocated(j),
    files: 1,
    folders: 0,
    modifiedMs: store.fileModified(j),
    childCount: 0,
  }
}

/** Unsorted child rows of `ref`. */
export function childRefs(store: TreeStore, ref: NodeRef): NodeRef[] {
  if (ref.kind === 'file') return []
  if (ref.kind === 'files') {
    return store.filesIn(ref.index).map((index) => ({ kind: 'file', index }))
  }
  const refs: NodeRef[] = store.childFolders(ref.index).map((index) => ({ kind: 'folder', index }))
  if (store.directFiles(ref.index) > 0) refs.push({ kind: 'files', index: ref.index })
  return refs
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Code-unit order for ids: short ASCII strings, so this is cheap and deterministic. */
function compareIds(a: NodeId, b: NodeId): number {
  return a < b ? -1 : a > b ? 1 : 0
}

type NumericKey = Exclude<SortKey, 'name'>

/**
 * A child as one number, `index * 4 + kind` (0 folder, 1 "[N files]", 2 file), so a folder with a
 * million files orders plain numbers and builds a `TreeRow` only for the rows it returns.
 */
const KINDS: readonly NodeRef['kind'][] = ['folder', 'files', 'file']

function refOf(code: number): NodeRef {
  return { kind: KINDS[code & 3] ?? 'file', index: code >> 2 }
}

function idOfCode(code: number): NodeId {
  return `${'dgf'[code & 3]}${code >> 2}`
}

function nameOfCode(store: TreeStore, code: number): string {
  const kind = code & 3
  return kind === 0 ? store.folderName(code >> 2) : kind === 2 ? store.fileName(code >> 2) : ''
}

/** The figure a child sorts by: the same value `rowOf` reports, read without building a row. */
function keyValue(store: TreeStore, code: number, key: NumericKey): number {
  const i = code >> 2
  switch (code & 3) {
    case 0:
      return key === 'size'
        ? store.folderSize(i)
        : key === 'allocated'
          ? store.folderAllocated(i)
          : key === 'files'
            ? store.folderFiles(i)
            : key === 'folders'
              ? store.folderFolders(i)
              : store.folderModified(i)
    case 1:
      return key === 'size'
        ? store.directSize(i)
        : key === 'allocated'
          ? store.directAllocated(i)
          : key === 'files'
            ? store.directFiles(i)
            : key === 'folders'
              ? 0
              : store.directModified(i)
    default:
      return key === 'size'
        ? store.fileSize(i)
        : key === 'allocated'
          ? store.fileAllocated(i)
          : key === 'modified'
            ? store.fileModified(i)
            : key === 'files'
              ? 1
              : 0
  }
}

/** Child codes of `ref`, unsorted; the same children `childRefs` lists. */
function childCodes(store: TreeStore, ref: NodeRef): number[] {
  if (ref.kind === 'file') return []
  if (ref.kind === 'files') {
    const codes = store.filesIn(ref.index)
    for (let i = 0; i < codes.length; i += 1) codes[i] = (codes[i] ?? 0) * 4 + 2
    return codes
  }
  const codes = store.childFolders(ref.index)
  for (let i = 0; i < codes.length; i += 1) codes[i] = (codes[i] ?? 0) * 4
  if (store.directFiles(ref.index) > 0) codes.push(ref.index * 4 + 1)
  return codes
}

function sortValue(row: TreeRow, key: NumericKey): number {
  switch (key) {
    case 'size':
      return row.size
    case 'allocated':
      return row.allocated
    case 'files':
      return row.files
    case 'folders':
      return row.folders
    case 'modified':
      return row.modifiedMs
  }
}

/**
 * Orders rows by `key`. Rows that tie on the key (and the "[N files]" row's empty name) fall back
 * to name, then id; the name and id order is never reversed, whatever the direction.
 */
export function compareRows(a: TreeRow, b: TreeRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1
  if (key !== 'name') {
    const delta = sortValue(a, key) - sortValue(b, key)
    if (delta !== 0) return sign * delta
    return collator.compare(a.name, b.name) || compareIds(a.id, b.id)
  }
  const byName = collator.compare(a.name, b.name)
  if (byName !== 0) return sign * byName
  return compareIds(a.id, b.id)
}

/** Position bits packed under a value: `value * 2^20 + position` stays an exact double. */
const POSITION_BITS = 2 ** 20
/** Values below this pack exactly with a position. */
const PACKABLE_LIMIT = 2 ** 33
/** Fewest children one lazy step places, so small pages do not pay per call. */
const MIN_CHUNK = 1024

/** Quickselect (Wirth): afterwards `a[k]` is where it would be if `a` were sorted by `cmp`. */
function selectAt(a: number[], length: number, k: number, cmp: (x: number, y: number) => number) {
  let low = 0
  let high = length - 1
  while (low < high) {
    const pivot = a[k] ?? 0
    let i = low
    let j = high
    do {
      while (cmp(a[i] ?? 0, pivot) < 0) i += 1
      while (cmp(pivot, a[j] ?? 0) < 0) j -= 1
      if (i <= j) {
        const swap = a[i] ?? 0
        a[i] = a[j] ?? 0
        a[j] = swap
        i += 1
        j -= 1
      }
    } while (i <= j)
    if (j < k) low = i
    if (k < i) high = j
  }
}

/** Keys sampled to guess where the top `count` of a huge folder begin. */
const SAMPLE_SIZE = 2048

/**
 * Moves the keys at or above a value boundary to the end of `keys[0, length)` and returns where
 * they start; at least `count` keys end up there. The boundary comes from a sample, so this is one
 * pass over the keys rather than a full sort (a thin sample just widens the boundary and retries).
 */
function partitionTop(keys: Float64Array, length: number, count: number): number {
  const step = Math.max(1, Math.floor(length / SAMPLE_SIZE))
  const sample = new Float64Array(Math.ceil(length / step))
  for (let i = 0; i < sample.length; i += 1) sample[i] = keys[i * step] ?? 0
  sample.sort()
  for (let want = count * 2; want < length; want *= 4) {
    const pick = sample[Math.max(0, sample.length - 1 - Math.ceil((want * sample.length) / length))]
    const threshold = Math.floor((pick ?? 0) / POSITION_BITS) * POSITION_BITS
    let below = 0
    for (let i = 0; i < length; i += 1) {
      const key = keys[i] ?? 0
      if (key < threshold) {
        keys[i] = keys[below] ?? 0
        keys[below] = key
        below += 1
      }
    }
    if (length - below >= count) return below
  }
  return 0
}

/**
 * The children of one folder in one order: by value (or name), ties by name then id. Nothing is
 * ordered until it is read. A numeric key packs each child's value with its position into one
 * double, so the next chunk of the largest values is found with one sampled partition pass and a
 * typed-array sort; each run of equal values is ordered only as far as the page reads, by a
 * quickselect. A first page of a huge folder therefore costs a few passes, not a sort of every
 * child.
 */
export class SortedOrder {
  private readonly children: number[]
  /** Child codes placed so far, in order; grows as chunks of values are placed. */
  private readonly codes: number[] = []
  /** Where each run of equal values starts in `codes`, and how many of its first rows are ordered. */
  private readonly runStarts: number[] = []
  private readonly runReady: number[] = []
  /** Marker of the run being filled: the packed value, or the value itself on the slow path. */
  private lastMark = NaN
  /** Sign of the name step: name descending flips it, a value key never does. */
  private readonly nameSign: 1 | -1
  /** Packed keys not yet placed; only the first `pendingLength` are live. */
  private pending: Float64Array | null = null
  private pendingLength = 0

  constructor(
    private readonly store: TreeStore,
    ref: NodeRef,
    key: SortKey,
    dir: SortDir,
  ) {
    this.children = childCodes(store, ref)
    this.nameSign = key === 'name' && dir === 'desc' ? -1 : 1
    const n = this.children.length
    if (key === 'name') {
      // One run holding every child; it is ordered by name as far as it is read.
      if (n > 0) this.addRun()
      this.codes = this.children
      return
    }
    const descending = dir === 'desc'
    const keys = new Float64Array(n)
    let packable = n <= POSITION_BITS
    for (let i = 0; i < n && packable; i += 1) {
      const value = keyValue(store, this.children[i] ?? 0, key)
      if (value >= 0 && value < PACKABLE_LIMIT && value === Math.floor(value)) {
        keys[i] = (descending ? value : PACKABLE_LIMIT - 1 - value) * POSITION_BITS + i
      } else {
        packable = false
      }
    }
    if (packable) {
      this.pending = keys
      this.pendingLength = n
      return
    }
    // Values that do not pack (too large, fractional or negative): order them with a comparator.
    const values = Float64Array.from(this.children, (code) => keyValue(store, code, key))
    const sign = descending ? -1 : 1
    const positions = Array.from(values, (_, i) => i)
    positions.sort((a, b) => sign * ((values[a] ?? 0) - (values[b] ?? 0)))
    for (const position of positions)
      this.place(this.children[position] ?? 0, values[position] ?? 0)
  }

  /** Number of children, in any order. */
  get length(): number {
    return this.children.length
  }

  /** The children from `start` up to `end` (exclusive), in order. */
  slice(start: number, end: number): NodeRef[] {
    const stop = Math.min(end, this.length)
    if (stop <= start) return []
    while (this.codes.length < stop && this.pendingLength > 0) this.extend(stop - this.codes.length)
    for (let run = this.runAt(start); run < this.runStarts.length; run += 1) {
      const first = this.runStarts[run] ?? 0
      if (first >= stop) break
      this.orderRun(run, stop - first)
    }
    return this.codes.slice(start, stop).map(refOf)
  }

  /** Position of `ref` in the order, or -1. Orders every child, so it costs a full sort. */
  indexOf(ref: NodeRef): number {
    this.slice(0, this.length)
    return this.codes.indexOf(ref.index * 4 + KINDS.indexOf(ref.kind))
  }

  /**
   * Places the next chunk of the largest remaining values, at least `need` children. The chunk
   * ends on a value boundary, so every run in `codes` is complete when it is placed.
   */
  private extend(need: number): void {
    const pending = this.pending
    if (pending === null) return
    const m = this.pendingLength
    const count = Math.min(m, Math.max(need, MIN_CHUNK))
    const below = count < m ? partitionTop(pending, m, count) : 0
    pending.subarray(below, m).sort()
    for (let i = m - 1; i >= below; i -= 1) {
      const packed = pending[i] ?? 0
      const mark = Math.floor(packed / POSITION_BITS)
      this.place(this.children[packed - mark * POSITION_BITS] ?? 0, mark)
    }
    this.pendingLength = below
  }

  private place(code: number, mark: number): void {
    if (this.codes.length === 0 || mark !== this.lastMark) {
      this.addRun()
      this.lastMark = mark
    }
    this.codes.push(code)
  }

  private addRun(): void {
    this.runStarts.push(this.codes.length)
    this.runReady.push(0)
  }

  /** The run that holds position `pos`. */
  private runAt(pos: number): number {
    let low = 0
    let high = this.runStarts.length - 1
    let found = 0
    while (low <= high) {
      const mid = (low + high) >> 1
      if ((this.runStarts[mid] ?? 0) <= pos) {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return found
  }

  /** Orders the first `need` rows of a run; a long run is selected from first, not fully sorted. */
  private orderRun(run: number, need: number): void {
    const start = this.runStarts[run] ?? 0
    const length = (this.runStarts[run + 1] ?? this.codes.length) - start
    const wanted = need * 4 < length ? need : length
    if (length < 2 || (this.runReady[run] ?? 0) >= wanted) return
    const part = this.codes.slice(start, start + length)
    const compare = (a: number, b: number): number => this.compareChildren(a, b)
    if (wanted < length) selectAt(part, length, wanted - 1, compare)
    const ordered =
      wanted < length
        ? part.slice(0, wanted).sort(compare).concat(part.slice(wanted))
        : part.sort(compare)
    ordered.forEach((code, k) => {
      this.codes[start + k] = code
    })
    this.runReady[run] = wanted
  }

  /** Name, then id. */
  private compareChildren(a: number, b: number): number {
    const byName = collator.compare(nameOfCode(this.store, a), nameOfCode(this.store, b))
    if (byName !== 0) return this.nameSign * byName
    return compareIds(idOfCode(a), idOfCode(b))
  }
}

interface CachedOrder {
  version: number
  order: SortedOrder
}

/** Sorted children with a small cache keyed on the store version. */
export class ChildSorter {
  private readonly cache = new Map<string, CachedOrder>()

  constructor(private readonly store: TreeStore) {}

  sorted(ref: NodeRef, key: SortKey, dir: SortDir): SortedOrder {
    const cacheKey = `${nodeIdOf(ref)}|${key}|${dir}`
    const hit = this.cache.get(cacheKey)
    if (hit && hit.version === this.store.version) return hit.order
    const order = new SortedOrder(this.store, ref, key, dir)
    this.cache.delete(cacheKey)
    this.cache.set(cacheKey, { version: this.store.version, order })
    if (this.cache.size > SORT_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return order
  }
}

export function childrenPage(
  store: TreeStore,
  sorter: ChildSorter,
  nodeId: NodeId,
  key: SortKey,
  dir: SortDir,
  offset: number,
  limit: number,
): TreePage | null {
  const ref = resolveNode(store, nodeId)
  if (ref === null) return null
  const order = sorter.sorted(ref, key, dir)
  const start = Math.max(0, Math.min(offset, order.length))
  const count = Math.max(0, Math.min(limit, MAX_PAGE_ROWS))
  return {
    parent: rowOf(store, ref),
    total: order.length,
    offset: start,
    rows: order.slice(start, start + count).map((child) => rowOf(store, child)),
  }
}

export function nodeDetails(
  store: TreeStore,
  sorter: ChildSorter,
  nodeId: NodeId,
  key: SortKey,
  dir: SortDir,
): TreeNodeDetails | null {
  const ref = resolveNode(store, nodeId)
  if (ref === null) return null
  const chain: NodeRef[] = []
  for (let step: NodeRef | null = ref; step !== null; step = parentOf(store, step)) {
    chain.push(step)
  }
  chain.reverse()
  const locations: TreeLocation[] = []
  for (let i = 1; i < chain.length; i += 1) {
    const parent = chain[i - 1]
    const child = chain[i]
    if (parent === undefined || child === undefined) continue
    const index = sorter.sorted(parent, key, dir).indexOf(child)
    locations.push({ parentId: nodeIdOf(parent), index })
  }
  return {
    row: rowOf(store, ref),
    path: ref.kind === 'file' ? store.filePath(ref.index) : store.folderPath(ref.index),
    ancestorIds: chain.slice(0, -1).map(nodeIdOf),
    locations,
  }
}

/**
 * The row and path of each id, in order (`null` for an id that does not resolve). A cheap batch
 * lookup: no ancestors, no sorting, no sibling search.
 */
export function nodePaths(
  store: TreeStore,
  nodeIds: readonly NodeId[],
): Array<TreeNodePath | null> {
  return nodeIds.map((id) => {
    const ref = resolveNode(store, id)
    if (ref === null) return null
    return {
      row: rowOf(store, ref),
      path: ref.kind === 'file' ? store.filePath(ref.index) : store.folderPath(ref.index),
    }
  })
}

/**
 * Folders to expand so `levels` levels of folders below `nodeId` are visible: `nodeId` itself
 * for 1 level, plus its child folders for 2 levels, and so on. Breadth first, at most
 * `MAX_EXPAND_IDS`. Only folders with children are returned.
 */
export function expandIds(store: TreeStore, nodeId: NodeId, levels: number): NodeId[] {
  const ref = resolveNode(store, nodeId)
  if (ref === null || ref.kind !== 'folder') return []
  const ids: NodeId[] = []
  let level = [ref.index]
  for (let depth = 0; depth < levels && level.length > 0; depth += 1) {
    const next: number[] = []
    for (const folder of level) {
      const hasRows = store.folderChildCount(folder) > 0 || store.directFiles(folder) > 0
      if (!hasRows) continue
      if (ids.length >= MAX_EXPAND_IDS) return ids
      ids.push(`d${folder}`)
      // A loop, not `push(...children)`: a spread of 100k+ arguments overflows the stack.
      for (const child of store.childFolders(folder)) next.push(child)
    }
    level = next
  }
  return ids
}

import {
  MAX_PAGE_ROWS,
  NODE_ID_PATTERN,
  type NodeId,
  type SortDir,
  type SortKey,
  type TreeLocation,
  type TreeNodeDetails,
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

function sortValue(row: TreeRow, key: Exclude<SortKey, 'name'>): number {
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

/** Orders rows by `key`; ties (and the "[N files]" row's empty name) fall back to name, then id. */
export function compareRows(a: TreeRow, b: TreeRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1
  if (key !== 'name') {
    const delta = sortValue(a, key) - sortValue(b, key)
    if (delta !== 0) return sign * delta
    return collator.compare(a.name, b.name) || a.id.localeCompare(b.id)
  }
  const byName = collator.compare(a.name, b.name)
  if (byName !== 0) return sign * byName
  return a.id.localeCompare(b.id)
}

interface CachedOrder {
  version: number
  rows: TreeRow[]
}

/** Sorted children with a small cache keyed on the store version. */
export class ChildSorter {
  private readonly cache = new Map<string, CachedOrder>()

  constructor(private readonly store: TreeStore) {}

  sorted(ref: NodeRef, key: SortKey, dir: SortDir): TreeRow[] {
    const cacheKey = `${nodeIdOf(ref)}|${key}|${dir}`
    const hit = this.cache.get(cacheKey)
    if (hit && hit.version === this.store.version) return hit.rows
    const rows = childRefs(this.store, ref).map((child) => rowOf(this.store, child))
    rows.sort((a, b) => compareRows(a, b, key, dir))
    this.cache.delete(cacheKey)
    this.cache.set(cacheKey, { version: this.store.version, rows })
    if (this.cache.size > SORT_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return rows
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
  const rows = sorter.sorted(ref, key, dir)
  const start = Math.max(0, Math.min(offset, rows.length))
  const count = Math.max(0, Math.min(limit, MAX_PAGE_ROWS))
  return {
    parent: rowOf(store, ref),
    total: rows.length,
    offset: start,
    rows: rows.slice(start, start + count),
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
    const childId = nodeIdOf(child)
    const index = sorter.sorted(parent, key, dir).findIndex((row) => row.id === childId)
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
      next.push(...store.childFolders(folder))
    }
    level = next
  }
  return ids
}

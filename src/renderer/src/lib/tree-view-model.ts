import type { NodeId, TreeRow } from '@shared/tree-types'

/** Rows per `tree:children` request and per cached chunk. */
export const CHUNK_SIZE = 200

/** One loaded chunk of a row's children, tagged with the data revision it was fetched at. */
export interface ChildChunk {
  rows: TreeRow[]
  revision: number
}

/** What the renderer holds of one row's children: the count plus the chunks seen so far. */
export interface ChildList {
  parent: TreeRow
  total: number
  chunks: Readonly<Record<number, ChildChunk>>
}

export type ChildLists = Readonly<Record<NodeId, ChildList>>

/** One visible line of the tree. `row` is null while its chunk is loading. */
export interface VisibleRow {
  row: TreeRow | null
  /** null for the root line. */
  parentId: NodeId | null
  /** Position among the parent's children (0 for the root). */
  index: number
  /** 0 for the root, 1 for its children, … */
  depth: number
  /** Number of siblings, for `aria-setsize`. */
  setSize: number
}

export interface ChunkRef {
  nodeId: NodeId
  chunk: number
}

/** The flattened tree: only the root and the children of expanded, loaded rows. */
export interface VisibleModel {
  count: number
  rowAt(index: number): VisibleRow | null
  /** Index of a loaded row, or -1 when it is not visible (collapsed parent or not loaded). */
  indexOf(id: NodeId): number
  /** Expanded rows whose children have not been loaded yet. */
  missingLists: NodeId[]
}

interface Segment {
  /** Global index of the segment's first line. */
  start: number
  count: number
  /** null for the root line. */
  parentId: NodeId | null
  /** First child index in the parent's list. */
  from: number
  depth: number
}

export function rowInList(list: ChildList | undefined, index: number): TreeRow | null {
  if (list === undefined) return null
  const chunk = list.chunks[Math.floor(index / CHUNK_SIZE)]
  return chunk?.rows[index % CHUNK_SIZE] ?? null
}

function loadedIndices(list: ChildList): number[] {
  return Object.keys(list.chunks)
    .map(Number)
    .sort((a, b) => a - b)
}

/**
 * Builds the visible model as a list of segments (runs of siblings) instead of one object per
 * line, so a folder with a million children costs one segment, not a million rows.
 */
export function buildVisibleModel(
  lists: ChildLists,
  expanded: ReadonlySet<NodeId>,
  rootId: NodeId,
): VisibleModel {
  const segments: Segment[] = []
  const missingLists: NodeId[] = []
  let cursor = 0
  const root = lists[rootId]?.parent ?? null

  if (root !== null) {
    segments.push({ start: 0, count: 1, parentId: null, from: 0, depth: 0 })
    cursor = 1
  }

  const emitChildren = (parentId: NodeId, depth: number): void => {
    const list = lists[parentId]
    if (list === undefined) {
      missingLists.push(parentId)
      return
    }
    let from = 0
    for (const chunkIndex of loadedIndices(list)) {
      const chunk = list.chunks[chunkIndex]
      if (chunk === undefined) continue
      chunk.rows.forEach((row, offset) => {
        const index = chunkIndex * CHUNK_SIZE + offset
        if (!expanded.has(row.id) || row.childCount === 0 || index < from) return
        const count = index - from + 1
        segments.push({ start: cursor, count, parentId, from, depth })
        cursor += count
        from = index + 1
        emitChildren(row.id, depth + 1)
      })
    }
    if (from < list.total) {
      const count = list.total - from
      segments.push({ start: cursor, count, parentId, from, depth })
      cursor += count
    }
  }

  if (root !== null && expanded.has(rootId)) emitChildren(rootId, 1)

  const segmentAt = (index: number): Segment | null => {
    let low = 0
    let high = segments.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const segment = segments[mid]
      if (segment === undefined) return null
      if (index < segment.start) high = mid - 1
      else if (index >= segment.start + segment.count) low = mid + 1
      else return segment
    }
    return null
  }

  return {
    count: cursor,
    missingLists,
    rowAt(index) {
      const segment = segmentAt(index)
      if (segment === null) return null
      if (segment.parentId === null) {
        return { row: root, parentId: null, index: 0, depth: 0, setSize: 1 }
      }
      const list = lists[segment.parentId]
      const childIndex = segment.from + (index - segment.start)
      return {
        row: rowInList(list, childIndex),
        parentId: segment.parentId,
        index: childIndex,
        depth: segment.depth,
        setSize: list?.total ?? 0,
      }
    },
    indexOf(id) {
      if (root !== null && id === rootId) return 0
      for (const segment of segments) {
        if (segment.parentId === null) continue
        const list = lists[segment.parentId]
        if (list === undefined) continue
        for (let i = 0; i < segment.count; i += 1) {
          if (rowInList(list, segment.from + i)?.id === id) return segment.start + i
        }
      }
      return -1
    },
  }
}

/** The chunks needed to draw lines `first` to `last` (inclusive) and to fill expanded rows. */
export function chunksFor(model: VisibleModel, first: number, last: number): ChunkRef[] {
  const needed = new Map<string, ChunkRef>()
  const add = (nodeId: NodeId, chunk: number) => needed.set(`${nodeId}:${chunk}`, { nodeId, chunk })
  for (let i = Math.max(0, first); i <= Math.min(last, model.count - 1); i += 1) {
    const line = model.rowAt(i)
    if (line !== null && line.parentId !== null) {
      add(line.parentId, Math.floor(line.index / CHUNK_SIZE))
    }
  }
  for (const nodeId of model.missingLists) add(nodeId, 0)
  return [...needed.values()]
}

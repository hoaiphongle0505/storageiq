import { categoryShares, dominantCategory } from '@shared/file-category'
import {
  FILE_CATEGORIES,
  MAX_TREEMAP_DEPTH,
  modeValue,
  ROOT_NODE_ID,
  type CategoryShare,
  type FileCategory,
  type NodeId,
  type SizeMode,
  type TreemapBlockKind,
  type TreemapLayout,
  type TreemapRect,
} from '@shared/tree-types'
import { childRefs, nodeIdOf, resolveNode, rowOf, type NodeRef } from './tree-queries'
import type { TreeStore } from './tree-store'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Height of the label strip at the top of a block that holds nested blocks. */
export const TREEMAP_HEADER = 18
/** Gap between a nested block's border and its children. */
export const TREEMAP_INSET = 2
/** A block smaller than this (in either direction) gets no nested blocks. */
export const MIN_NESTED_SIDE = 28
/** Most rectangles one layout returns. */
export const MAX_TREEMAP_RECTS = 20_000
/** Children smaller than this many square pixels are left out of the layout. */
export const MIN_RECT_AREA = 4

function worstRatio(rowSum: number, min: number, max: number, side: number): number {
  const sideSquared = side * side
  const sumSquared = rowSum * rowSum
  return Math.max((sideSquared * max) / sumSquared, sumSquared / (sideSquared * min))
}

/**
 * Squarified treemap (Bruls, Huizing and van Wijk, 2000). `values` must be positive and sorted
 * largest first; the boxes come back in the same order and exactly tile `box`.
 */
export function squarify(values: readonly number[], box: Box): Box[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (values.length === 0 || total <= 0 || box.w <= 0 || box.h <= 0) return []
  const scale = (box.w * box.h) / total
  const areas = values.map((value) => value * scale)
  const out: Box[] = []
  let { x, y, w, h } = box
  let i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const first = areas[i] ?? 0
    let rowSum = first
    let worst = worstRatio(rowSum, first, first, side)
    let j = i + 1
    while (j < areas.length) {
      const next = areas[j] ?? 0
      const candidate = worstRatio(rowSum + next, next, first, side)
      if (candidate > worst) break
      rowSum += next
      worst = candidate
      j += 1
    }
    const isLast = j >= areas.length
    if (w >= h) {
      // The row is a column on the left edge.
      const columnWidth = isLast ? w : rowSum / h
      let cy = y
      for (let k = i; k < j; k += 1) {
        const cellHeight = k === j - 1 ? y + h - cy : (areas[k] ?? 0) / columnWidth
        out.push({ x, y: cy, w: columnWidth, h: cellHeight })
        cy += cellHeight
      }
      x += columnWidth
      w -= columnWidth
    } else {
      // The row runs along the top edge.
      const rowHeight = isLast ? h : rowSum / w
      let cx = x
      for (let k = i; k < j; k += 1) {
        const cellWidth = k === j - 1 ? x + w - cx : (areas[k] ?? 0) / rowHeight
        out.push({ x: cx, y, w: cellWidth, h: rowHeight })
        cx += cellWidth
      }
      y += rowHeight
      h -= rowHeight
    }
    i = j
  }
  return out
}

interface Item {
  ref: NodeRef | null
  /** Tie-break key for equal values. */
  key: string
  kind: TreemapBlockKind
  name: string
  value: number
  files: number
  category: FileCategory | null
}

function categoryOf(store: TreeStore, ref: NodeRef): FileCategory | null {
  switch (ref.kind) {
    case 'file':
      return FILE_CATEGORIES[store.fileCategoryOf(ref.index)] ?? 'other'
    case 'folder':
      return dominantCategory(store.folderCategoryBytes(ref.index))
    case 'files':
      return dominantCategory(store.directCategoryBytes(ref.index))
  }
}

function itemsOf(store: TreeStore, ref: NodeRef, mode: SizeMode): Item[] {
  const items: Item[] = []
  for (const child of childRefs(store, ref)) {
    const row = rowOf(store, child)
    const value = modeValue(row, mode)
    if (value > 0) {
      items.push({
        ref: child,
        key: row.id,
        kind: row.kind,
        name: row.name,
        value,
        files: row.files,
        category: categoryOf(store, child),
      })
    }
  }
  // Largest first; equal values keep a stable order by id.
  items.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
  return items
}

/** A list of blocks to lay out inside `box`; `level` is the nesting level of the blocks. */
interface Job {
  items: Item[]
  box: Box
  level: number
}

/** The area a block's children fill: below its label strip, inside a 2 px inset. */
function insetBox(cell: Box): Box {
  return {
    x: cell.x + TREEMAP_INSET,
    y: cell.y + TREEMAP_HEADER,
    w: cell.w - TREEMAP_INSET * 2,
    h: cell.h - TREEMAP_HEADER - TREEMAP_INSET,
  }
}

function categoriesOf(store: TreeStore, ref: NodeRef): CategoryShare[] {
  switch (ref.kind) {
    case 'file': {
      const bytes = new Array<number>(FILE_CATEGORIES.length).fill(0)
      bytes[store.fileCategoryOf(ref.index)] = store.fileSize(ref.index)
      return categoryShares(bytes)
    }
    case 'folder':
      return categoryShares(store.folderCategoryBytes(ref.index))
    case 'files':
      return categoryShares(store.directCategoryBytes(ref.index))
  }
}

/**
 * Treemap of `nodeId`'s children sized by the Mode value, nested `depth` levels deep
 * (0 = children only). At the scanned drive root in Size or Allocated mode, a "Free space"
 * block sits beside the root's own block; the root's block is not a level of its own.
 */
export function treemapLayout(
  store: TreeStore,
  nodeId: NodeId,
  mode: SizeMode,
  depth: number,
  width: number,
  height: number,
): TreemapLayout | null {
  const ref = resolveNode(store, nodeId)
  if (ref === null) return null
  const maxDepth = Math.max(0, Math.min(depth, MAX_TREEMAP_DEPTH))
  const rects: TreemapRect[] = []
  // Breadth first: every block of one level is laid out before any block of the next, so the
  // rectangle cap can only cut the deepest blocks, never a large shallow one.
  const jobs: Job[] = []

  const place = (job: Job): void => {
    const boxes = squarify(
      job.items.map((item) => item.value),
      job.box,
    )
    boxes.forEach((cell, index) => {
      const item = job.items[index]
      if (item === undefined || rects.length >= MAX_TREEMAP_RECTS) return
      if (cell.w * cell.h < MIN_RECT_AREA) return
      const rect: TreemapRect = {
        id: item.ref === null ? null : nodeIdOf(item.ref),
        kind: item.kind,
        name: item.name,
        value: item.value,
        files: item.files,
        depth: job.level,
        x: cell.x,
        y: cell.y,
        w: cell.w,
        h: cell.h,
        nested: false,
        category: item.category,
      }
      rects.push(rect)
      const canNest =
        item.ref !== null &&
        job.level < maxDepth &&
        item.kind !== 'file' &&
        cell.w >= MIN_NESTED_SIDE &&
        cell.h >= MIN_NESTED_SIDE + TREEMAP_HEADER
      if (!canNest || item.ref === null) return
      const children = itemsOf(store, item.ref, mode)
      if (children.length === 0) return
      rect.nested = true
      jobs.push({ items: children, box: insetBox(cell), level: job.level + 1 })
    })
  }

  const full: Box = { x: 0, y: 0, w: width, h: height }
  const showFree =
    nodeId === ROOT_NODE_ID &&
    store.freeBytes !== null &&
    store.freeBytes > 0 &&
    (mode === 'size' || mode === 'allocated')
  if (showFree && store.freeBytes !== null) {
    const root = rowOf(store, ref)
    const used = modeValue(root, mode)
    const candidates: Item[] = [
      {
        ref,
        key: nodeId,
        kind: 'folder',
        name: root.name,
        value: used,
        files: root.files,
        category: categoryOf(store, ref),
      },
      {
        ref: null,
        key: 'free',
        kind: 'free',
        name: 'Free space',
        value: store.freeBytes,
        files: 0,
        category: null,
      },
    ]
    const top = candidates.filter((item) => item.value > 0)
    top.sort((a, b) => b.value - a.value)
    const boxes = squarify(
      top.map((item) => item.value),
      full,
    )
    boxes.forEach((cell, index) => {
      const item = top[index]
      if (item === undefined) return
      if (item.ref === null) {
        rects.push({
          id: null,
          kind: 'free',
          name: item.name,
          value: item.value,
          files: 0,
          depth: 0,
          x: cell.x,
          y: cell.y,
          w: cell.w,
          h: cell.h,
          nested: false,
          category: null,
        })
        return
      }
      const rootRect: TreemapRect = {
        id: nodeId,
        kind: 'folder',
        name: item.name,
        value: item.value,
        files: item.files,
        depth: 0,
        x: cell.x,
        y: cell.y,
        w: cell.w,
        h: cell.h,
        nested: false,
        category: item.category,
      }
      rects.push(rootRect)
      if (cell.w < MIN_NESTED_SIDE || cell.h < MIN_NESTED_SIDE + TREEMAP_HEADER) return
      const children = itemsOf(store, ref, mode)
      if (children.length === 0) return
      rootRect.nested = true
      // The root's children start at level 0, so Level n nests n levels under the root's block.
      jobs.push({ items: children, box: insetBox(cell), level: 0 })
    })
  } else {
    jobs.push({ items: itemsOf(store, ref, mode), box: full, level: 0 })
  }

  for (let next = 0; next < jobs.length && rects.length < MAX_TREEMAP_RECTS; next += 1) {
    const job = jobs[next]
    if (job !== undefined) place(job)
  }
  return { nodeId, width, height, rects, categories: categoriesOf(store, ref) }
}

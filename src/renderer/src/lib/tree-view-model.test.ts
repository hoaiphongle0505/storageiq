import { describe, expect, it } from 'vitest'
import type { TreeRow } from '@shared/tree-types'
import {
  buildVisibleModel,
  CHUNK_SIZE,
  type ChildList,
  type ChildLists,
  chunksFor,
  rowInList,
} from './tree-view-model'

function row(id: string, parentId: string | null, childCount = 0): TreeRow {
  return {
    id,
    parentId,
    kind: 'folder',
    name: id,
    size: 1,
    allocated: 1,
    files: 1,
    folders: 0,
    modifiedMs: 0,
    childCount,
  }
}

function list(parent: TreeRow, total: number, loaded: Record<number, TreeRow[]>): ChildList {
  const chunks = Object.fromEntries(
    Object.entries(loaded).map(([chunk, rows]) => [chunk, { rows, revision: 0 }]),
  )
  return { parent, total, chunks }
}

const root = row('d0', null, 3)
const a = row('d1', 'd0', 2)
const b = row('d2', 'd0', 0)
const c = row('d3', 'd0', 0)
const a1 = row('d4', 'd1', 0)
const a2 = row('d5', 'd1', 0)

const LISTS: ChildLists = {
  d0: list(root, 3, { 0: [a, b, c] }),
  d1: list(a, 2, { 0: [a1, a2] }),
}

describe('buildVisibleModel', () => {
  it('shows only the root while it is collapsed', () => {
    const model = buildVisibleModel(LISTS, new Set(), 'd0')
    expect(model.count).toBe(1)
    expect(model.rowAt(0)).toEqual({ row: root, parentId: null, index: 0, depth: 0, setSize: 1 })
  })

  it('shows nothing before the root is loaded', () => {
    expect(buildVisibleModel({}, new Set(['d0']), 'd0').count).toBe(0)
  })

  it('flattens expanded rows in order, with depth, position and set size', () => {
    const model = buildVisibleModel(LISTS, new Set(['d0', 'd1']), 'd0')
    expect(model.count).toBe(6)
    const lines = Array.from({ length: model.count }, (_, i) => model.rowAt(i))
    expect(lines.map((line) => [line?.row?.id, line?.depth, line?.index, line?.setSize])).toEqual([
      ['d0', 0, 0, 1],
      ['d1', 1, 0, 3],
      ['d4', 2, 0, 2],
      ['d5', 2, 1, 2],
      ['d2', 1, 1, 3],
      ['d3', 1, 2, 3],
    ])
    expect(model.rowAt(6)).toBeNull()
  })

  it('finds a loaded row and reports rows that are not visible', () => {
    const model = buildVisibleModel(LISTS, new Set(['d0', 'd1']), 'd0')
    expect(model.indexOf('d0')).toBe(0)
    expect(model.indexOf('d5')).toBe(3)
    expect(model.indexOf('d3')).toBe(5)
    expect(buildVisibleModel(LISTS, new Set(['d0']), 'd0').indexOf('d4')).toBe(-1)
  })

  it('counts rows of chunks that are not loaded yet as placeholders', () => {
    const big: ChildLists = { d0: list(row('d0', null, 1000), 1000, { 0: [a] }) }
    const model = buildVisibleModel(big, new Set(['d0']), 'd0')
    expect(model.count).toBe(1001)
    expect(model.rowAt(1)?.row?.id).toBe('d1')
    expect(model.rowAt(500)).toEqual({
      row: null,
      parentId: 'd0',
      index: 499,
      depth: 1,
      setSize: 1000,
    })
  })

  it('lists expanded rows whose children are missing', () => {
    const model = buildVisibleModel(LISTS, new Set(['d0', 'd1', 'd2']), 'd0')
    expect(model.missingLists).toEqual([])
    const missing = buildVisibleModel({ d0: LISTS['d0']! }, new Set(['d0', 'd1']), 'd0')
    expect(missing.missingLists).toEqual(['d1'])
  })

  it('handles a million children without one object per line', () => {
    const huge: ChildLists = { d0: list(row('d0', null, 1_000_000), 1_000_000, {}) }
    const started = performance.now()
    const model = buildVisibleModel(huge, new Set(['d0']), 'd0')
    expect(model.count).toBe(1_000_001)
    expect(model.rowAt(999_999)?.index).toBe(999_998)
    expect(performance.now() - started).toBeLessThan(50)
  })
})

describe('chunksFor', () => {
  it('asks for the chunks behind the lines in view and for missing lists', () => {
    const big: ChildLists = {
      d0: list(row('d0', null, 1000), 1000, { 0: [{ ...a, childCount: 2 }] }),
    }
    const model = buildVisibleModel(big, new Set(['d0', 'd1']), 'd0')
    expect(chunksFor(model, 0, 3)).toEqual([
      { nodeId: 'd0', chunk: 0 },
      { nodeId: 'd1', chunk: 0 },
    ])
    expect(chunksFor(model, 450, 451)).toEqual([
      { nodeId: 'd0', chunk: 2 },
      { nodeId: 'd1', chunk: 0 },
    ])
  })
})

describe('rowInList', () => {
  it('reads a row by its index across chunks', () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(`d${100 + i}`, 'd0'))
    const l = list(root, CHUNK_SIZE + 3, { 1: rows })
    expect(rowInList(l, CHUNK_SIZE + 2)?.id).toBe('d102')
    expect(rowInList(l, 0)).toBeNull()
    expect(rowInList(undefined, 0)).toBeNull()
  })
})

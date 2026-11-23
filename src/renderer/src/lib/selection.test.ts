import { describe, expect, it } from 'vitest'
import type { NodeId, TreeRow } from '@shared/tree-types'
import {
  dropDescendants,
  extendBy,
  orderedIds,
  rangeTo,
  selectAll,
  type Selection,
  selectionTotal,
  single,
  toggle,
} from './selection'

const visible: NodeId[] = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5']
const sel = (ids: NodeId[], activeId: NodeId | null, anchorId: NodeId | null): Selection => ({
  ids: new Set(ids),
  activeId,
  anchorId,
})
const idsOf = (selection: Selection) => [...selection.ids].sort()

describe('selection', () => {
  it('single replaces the set and sets the anchor', () => {
    const next = single('d3')
    expect(idsOf(next)).toEqual(['d3'])
    expect(next.activeId).toBe('d3')
    expect(next.anchorId).toBe('d3')
  })

  it('toggle adds and removes a row and moves the active row', () => {
    const added = toggle(single('d1'), 'd3')
    expect(idsOf(added)).toEqual(['d1', 'd3'])
    expect(added.activeId).toBe('d3')
    expect(added.anchorId).toBe('d3')
    const removed = toggle(added, 'd1')
    expect(idsOf(removed)).toEqual(['d3'])
    expect(removed.activeId).toBe('d1')
  })

  it('toggle off the active row leaves the active row on it', () => {
    const off = toggle(single('d2'), 'd2')
    expect(off.ids.size).toBe(0)
    expect(off.activeId).toBe('d2')
    expect(off.anchorId).toBe('d2')
  })

  it('rangeTo selects anchor to target in visible order, both directions', () => {
    const down = rangeTo(single('d1'), visible, 'd3', false)
    expect(idsOf(down)).toEqual(['d1', 'd2', 'd3'])
    expect(down.activeId).toBe('d3')
    expect(down.anchorId).toBe('d1')
    const up = rangeTo(single('d4'), visible, 'd2', false)
    expect(idsOf(up)).toEqual(['d2', 'd3', 'd4'])
    expect(up.activeId).toBe('d2')
    expect(up.anchorId).toBe('d4')
  })

  it('rangeTo skips ids that are not visible', () => {
    const rows: NodeId[] = ['d0', 'd1', 'd4', 'd5'] // d2 and d3 sit under a collapsed folder
    expect(idsOf(rangeTo(single('d1'), rows, 'd5', false))).toEqual(['d1', 'd4', 'd5'])
  })

  it('rangeTo with additive keeps the existing set', () => {
    const base = toggle(single('d0'), 'd4')
    const next = rangeTo(base, visible, 'd5', true)
    expect(idsOf(next)).toEqual(['d0', 'd4', 'd5'])
    expect(next.activeId).toBe('d5')
    // Without additive the old selection is replaced.
    expect(idsOf(rangeTo(base, visible, 'd5', false))).toEqual(['d4', 'd5'])
  })

  it('selectAll takes every visible id and keeps the active row', () => {
    const next = selectAll(visible, single('d2'))
    expect(idsOf(next)).toEqual([...visible].sort())
    expect(next.activeId).toBe('d2')
    expect(next.anchorId).toBe('d2')
    expect(selectAll(visible, sel([], null, null)).activeId).toBe('d0')
  })

  it('extendBy moves the active row and extends from the anchor', () => {
    const one = extendBy(single('d2'), visible, 1)
    expect(idsOf(one)).toEqual(['d2', 'd3'])
    expect(one.activeId).toBe('d3')
    expect(one.anchorId).toBe('d2')
    const two = extendBy(one, visible, 1)
    expect(idsOf(two)).toEqual(['d2', 'd3', 'd4'])
    // Reversing shrinks the range back towards the anchor, then crosses it.
    expect(idsOf(extendBy(two, visible, -2))).toEqual(['d2'])
    expect(idsOf(extendBy(two, visible, -3))).toEqual(['d1', 'd2'])
  })

  it('extendBy clamps at the first and last row', () => {
    expect(idsOf(extendBy(single('d1'), visible, -10))).toEqual(['d0', 'd1'])
    const end = extendBy(single('d4'), visible, 10)
    expect(idsOf(end)).toEqual(['d4', 'd5'])
    expect(end.activeId).toBe('d5')
  })

  it('orderedIds returns tree order and appends ids that are not visible', () => {
    const selection = sel(['d4', 'f12', 'd1', 'f2', 'g9'], 'd4', 'd1')
    expect(orderedIds(selection, visible)).toEqual(['d1', 'd4', 'f2', 'f12', 'g9'])
    expect(orderedIds(sel([], 'd2', 'd2'), visible)).toEqual([])
  })

  it('dropDescendants removes rows whose ancestor is selected', () => {
    const parents: Record<string, NodeId | null> = {
      d0: null,
      d1: 'd0',
      g1: 'd1',
      f1: 'g1',
      d2: 'd0',
      f2: 'g2',
      g2: 'd2',
    }
    const parentOf = (id: NodeId) => parents[id] ?? null
    expect(dropDescendants(['f1', 'd1', 'd2', 'f2', 'g1'], parentOf)).toEqual(['d1', 'd2'])
    expect(dropDescendants(['f1', 'f2'], parentOf)).toEqual(['f1', 'f2'])
    expect(dropDescendants(['d0', 'f2'], parentOf)).toEqual(['d0'])
  })

  it('selectionTotal sums sizes, counts unknown rows and does not double count children', () => {
    const row = (id: NodeId, parentId: NodeId | null, size: number): TreeRow => ({
      id,
      parentId,
      kind: id.startsWith('f') ? 'file' : id.startsWith('g') ? 'files' : 'folder',
      name: id,
      size,
      allocated: size,
      files: 0,
      folders: 0,
      modifiedMs: 0,
      childCount: 0,
    })
    const rows: Record<string, TreeRow> = {
      d1: row('d1', 'd0', 1000),
      f1: row('f1', 'g1', 100),
      g1: row('g1', 'd1', 400),
      d2: row('d2', 'd0', 50),
    }
    const rowOf = (id: NodeId) => rows[id] ?? null
    expect(selectionTotal(new Set(['d1', 'd2']), rowOf)).toEqual({
      count: 2,
      bytes: 1050,
      unknown: 0,
    })
    // f1 and g1 lie inside the selected d1: counted as items, not added twice.
    expect(selectionTotal(new Set(['d1', 'f1', 'g1']), rowOf)).toEqual({
      count: 3,
      bytes: 1000,
      unknown: 0,
    })
    // A row that is not loaded counts as an item and as unknown.
    expect(selectionTotal(new Set(['d2', 'f99']), rowOf)).toEqual({
      count: 2,
      bytes: 50,
      unknown: 1,
    })
  })
})

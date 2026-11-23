import { describe, expect, it } from 'vitest'
import { MAX_TREEMAP_DEPTH } from '@shared/tree-types'
import { TreeStore } from './tree-store'
import { type Box, MAX_TREEMAP_RECTS, squarify, TREEMAP_HEADER, treemapLayout } from './treemap'

const area = (box: Box) => box.w * box.h

function overlaps(a: Box, b: Box): boolean {
  const eps = 1e-6
  return (
    a.x + eps < b.x + b.w && b.x + eps < a.x + a.w && a.y + eps < b.y + b.h && b.y + eps < a.y + a.h
  )
}

describe('squarify', () => {
  const values = [600, 300, 200, 100, 100, 50, 25, 25]
  const box: Box = { x: 0, y: 0, w: 640, h: 400 }

  it('gives every value an area proportional to it', () => {
    const boxes = squarify(values, box)
    const total = values.reduce((sum, v) => sum + v, 0)
    expect(boxes).toHaveLength(values.length)
    boxes.forEach((cell, i) => {
      expect(area(cell)).toBeCloseTo(((values[i] ?? 0) / total) * area(box), 4)
    })
  })

  it('tiles the box with no overlap and no gap', () => {
    const boxes = squarify(values, box)
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false)
      }
      const cell = boxes[i]!
      expect(cell.x).toBeGreaterThanOrEqual(-1e-6)
      expect(cell.y).toBeGreaterThanOrEqual(-1e-6)
      expect(cell.x + cell.w).toBeLessThanOrEqual(640 + 1e-6)
      expect(cell.y + cell.h).toBeLessThanOrEqual(400 + 1e-6)
    }
    expect(boxes.reduce((sum, cell) => sum + area(cell), 0)).toBeCloseTo(area(box), 4)
  })

  it('keeps rectangles close to square', () => {
    for (const cell of squarify(values, box)) {
      expect(Math.max(cell.w / cell.h, cell.h / cell.w)).toBeLessThan(4)
    }
  })

  it('is stable: the same input gives the same output', () => {
    expect(squarify(values, box)).toEqual(squarify([...values], { ...box }))
  })

  it('handles empty, zero and single inputs', () => {
    expect(squarify([], box)).toEqual([])
    expect(squarify([0, 0], box)).toEqual([])
    expect(squarify([5], box)).toEqual([box])
    expect(squarify([5], { x: 0, y: 0, w: 0, h: 10 })).toEqual([])
  })
})

function sample(freeBytes: number | null = null) {
  const store = new TreeStore('C:\\', 4096, freeBytes)
  const big = store.folder(0, 'Big', 0)
  const small = store.folder(0, 'Small', 0)
  const inner = store.folder(big, 'Inner', 0)
  store.file(inner, 600_000, 'a.bin', 0)
  store.file(big, 200_000, 'b.bin', 0)
  store.file(small, 100_000, 'c.bin', 0)
  store.file(0, 100_000, 'root.bin', 0)
  return { store, big, small, inner }
}

describe('treemapLayout', () => {
  it('lays out the children at level 0, sized by the Mode value', () => {
    const { store, big } = sample()
    const layout = treemapLayout(store, 'd0', 'size', 0, 400, 200)
    expect(layout?.rects.map((r) => [r.id, r.kind, r.depth, r.nested])).toEqual([
      [`d${big}`, 'folder', 0, false],
      ['d2', 'folder', 0, false],
      ['g0', 'files', 0, false],
    ])
    const [first] = layout?.rects ?? []
    expect(area(first!)).toBeCloseTo((800_000 / 1_000_000) * 400 * 200, 4)
  })

  it('nests children under a label strip at deeper levels', () => {
    const { store, big } = sample()
    const layout = treemapLayout(store, 'd0', 'size', 2, 400, 200)
    const bigRect = layout?.rects.find((r) => r.id === `d${big}`)
    expect(bigRect?.nested).toBe(true)
    const inside = (r: Box) =>
      r.x >= (bigRect?.x ?? 0) - 1e-6 &&
      r.y >= (bigRect?.y ?? 0) - 1e-6 &&
      r.x + r.w <= (bigRect?.x ?? 0) + (bigRect?.w ?? 0) + 1e-6 &&
      r.y + r.h <= (bigRect?.y ?? 0) + (bigRect?.h ?? 0) + 1e-6
    const nested = layout?.rects.filter((r) => r.depth === 1 && inside(r)) ?? []
    expect(nested.map((r) => [r.kind, r.name]).sort()).toEqual([
      ['files', ''],
      ['folder', 'Inner'],
    ])
    for (const r of nested) {
      expect(r.y).toBeGreaterThanOrEqual((bigRect?.y ?? 0) + TREEMAP_HEADER - 1e-6)
      expect(r.x + r.w).toBeLessThanOrEqual((bigRect?.x ?? 0) + (bigRect?.w ?? 0) + 1e-6)
    }
    expect(layout?.rects.some((r) => r.depth === 2)).toBe(true)
  })

  it('adds a "Free space" block at the drive root in Size and Allocated modes only', () => {
    const { store } = sample(1_000_000)
    const sized = treemapLayout(store, 'd0', 'allocated', 0, 400, 200)
    const free = sized?.rects.find((r) => r.kind === 'free')
    expect(free).toMatchObject({ id: null, name: 'Free space', value: 1_000_000, depth: 0 })
    expect(sized?.rects.find((r) => r.id === 'd0')).toMatchObject({ depth: 0, nested: true })
    // The drive root's own block does not use a level: Level 0 keeps its children flat.
    expect(sized?.rects.filter((r) => r.depth === 1).length).toBe(0)
    const oneLevel = treemapLayout(store, 'd0', 'allocated', 1, 400, 200)
    expect(oneLevel?.rects.filter((r) => r.depth === 1).length).toBeGreaterThan(0)

    const counted = treemapLayout(store, 'd0', 'files', 0, 400, 200)
    expect(counted?.rects.some((r) => r.kind === 'free')).toBe(false)
    const inFolder = treemapLayout(store, 'd1', 'size', 0, 400, 200)
    expect(inFolder?.rects.some((r) => r.kind === 'free')).toBe(false)
  })

  it('sizes by file count in File count mode', () => {
    const { store, big } = sample()
    const layout = treemapLayout(store, 'd0', 'files', 0, 300, 300)
    const bigRect = layout?.rects.find((r) => r.id === `d${big}`)
    expect(bigRect?.value).toBe(2)
  })

  it('returns null for an unknown node and nothing for an empty folder', () => {
    const store = new TreeStore('C:\\', 4096)
    expect(treemapLayout(store, 'd9', 'size', 0, 100, 100)).toBeNull()
    expect(treemapLayout(store, 'd0', 'size', 0, 100, 100)?.rects).toEqual([])
  })
})

describe('treemapLayout limits', () => {
  it('drops blocks under 4 px² and leaves out zero-size children', () => {
    const store = new TreeStore('C:\\', 1)
    store.file(store.folder(0, 'Big', 0), 1_000_000, 'big.bin', 0)
    store.file(store.folder(0, 'Tiny', 0), 1, 'tiny.bin', 0)
    store.folder(0, 'Empty', 0)
    const layout = treemapLayout(store, 'd0', 'size', 0, 100, 100)
    expect(layout?.rects.map((r) => r.name)).toEqual(['Big'])
  })

  it('lays out nothing in a box with no area', () => {
    const { store } = sample()
    expect(treemapLayout(store, 'd0', 'size', 0, 0, 200)?.rects).toEqual([])
    expect(treemapLayout(store, 'd0', 'size', 0, 200, 0)?.rects).toEqual([])
  })

  it('clamps the depth to MAX_TREEMAP_DEPTH and treats a negative depth as 0', () => {
    const store = new TreeStore('C:\\', 1)
    let parent = 0
    for (let i = 0; i < MAX_TREEMAP_DEPTH + 2; i += 1) {
      parent = store.folder(parent, `L${i}`, 0)
      store.file(parent, 1000, `f${i}.bin`, 0)
    }
    const deep = treemapLayout(store, 'd0', 'size', 99, 1000, 1000)
    expect(Math.max(...(deep?.rects.map((r) => r.depth) ?? []))).toBe(MAX_TREEMAP_DEPTH)
    const flat = treemapLayout(store, 'd0', 'size', -3, 1000, 1000)
    expect(flat?.rects.every((r) => r.depth === 0 && !r.nested)).toBe(true)
  })

  it('caps the rectangles and keeps large shallow blocks under the cap', () => {
    const store = new TreeStore('C:\\', 1)
    const big = store.folder(0, 'Big', 0)
    for (let i = 0; i < 30_000; i += 1) store.file(big, 2, `b${i}.bin`, 0)
    const small = store.folder(0, 'Small', 0)
    store.file(small, 40_000, 's.bin', 0)

    // Depth 2: Big's files group (depth 1) holds the 30,000 files (depth 2).
    const layout = treemapLayout(store, 'd0', 'size', 2, 1000, 1000)
    const rects = layout?.rects ?? []
    expect(rects).toHaveLength(MAX_TREEMAP_RECTS)
    expect(rects.some((r) => r.id === `d${small}` && r.depth === 0)).toBe(true)
    const firstDeep = rects.findIndex((r) => r.depth === 1)
    expect(firstDeep).toBeGreaterThan(0)
    expect(rects.slice(0, firstDeep).every((r) => r.depth === 0)).toBe(true)
  })
})

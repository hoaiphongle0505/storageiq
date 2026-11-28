import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGE_BUCKETS } from '@shared/tree-types'
import { ageBreakdown, rankByOf, SideViews, topFiles, typeBreakdown } from './side-views'
import { TreeStore } from './tree-store'

const ROOT = 'C:\\Data'
const DAY = 86_400_000
/** A whole number of seconds, because the store keeps modification times in seconds. */
const NOW = Date.UTC(2026, 10, 28, 12)

/**
 * Data
 *   A
 *     big.MP4 3000 (f0)
 *     B: mid.jpg 1500 (f1), tie.jpg 1500 (f2)
 *   C: tiny.txt 10 (f3)
 *   root.bin 2000 (f4)
 */
function sample() {
  const store = new TreeStore(ROOT, 1024)
  const a = store.folder(0, 'A', 0)
  const b = store.folder(a, 'B', 0)
  const c = store.folder(0, 'C', 0)
  store.file(a, 3000, 'big.MP4', NOW)
  store.file(b, 1500, 'mid.jpg', NOW)
  store.file(b, 1500, 'tie.jpg', NOW)
  store.file(c, 10, 'tiny.txt', NOW)
  store.file(0, 2000, 'root.bin', NOW)
  return { store, a, b, c }
}

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id)

describe('topFiles', () => {
  it('lists the biggest files first and keeps the earlier file on a tie', () => {
    const { store } = sample()
    expect(ids(topFiles(store, 0, 'size', 10))).toEqual(['f0', 'f4', 'f1', 'f2', 'f3'])
    expect(ids(topFiles(store, 0, 'size', 2))).toEqual(['f0', 'f4'])
    expect(topFiles(store, 0, 'size', 0)).toEqual([])
  })

  it('ranks by allocated size (whole clusters) when asked', () => {
    const { store } = sample()
    // Allocated: f0 3072, f1 2048, f2 2048, f4 2048, f3 1024.
    expect(ids(topFiles(store, 0, 'allocated', 10))).toEqual(['f0', 'f1', 'f2', 'f4', 'f3'])
  })

  it('describes each row and covers only the subtree of the folder', () => {
    const { store, a } = sample()
    const rows = topFiles(store, a, 'size', 10)
    expect(ids(rows)).toEqual(['f0', 'f1', 'f2'])
    expect(rows[0]).toEqual({
      id: 'f0',
      name: 'big.MP4',
      folder: path.join(ROOT, 'A'),
      size: 3000,
      allocated: 3072,
      modifiedMs: NOW,
    })
    expect(rows[1]?.folder).toBe(path.join(ROOT, 'A', 'B'))
  })

  it('matches a full sort for many files, with and without the root shortcut', () => {
    const store = new TreeStore(ROOT, 4096)
    const sub = store.folder(0, 'Sub', 0)
    const sizes: number[] = []
    for (let i = 0; i < 300; i += 1) {
      const size = (i * 7919) % 211 // many ties
      sizes.push(size)
      store.file(i % 2 === 0 ? sub : 0, size, `f${i}.dat`, NOW)
    }
    const expected = sizes
      .map((size, index) => ({ size, index }))
      .sort((x, y) => y.size - x.size || x.index - y.index)
      .slice(0, 25)
      .map((entry) => `f${entry.index}`)
    expect(ids(topFiles(store, 0, 'size', 25))).toEqual(expected)
  })

  it('leaves out files of a folder that was reset', () => {
    const { store, a } = sample()
    store.resetFolder(a)
    expect(ids(topFiles(store, 0, 'size', 10))).toEqual(['f4', 'f3'])
  })
})

describe('typeBreakdown', () => {
  function extensions() {
    const store = new TreeStore(ROOT, 1024)
    store.file(0, 100, 'a.JPG', NOW)
    store.file(0, 50, 'b.jpg', NOW)
    store.file(0, 10, '.gitignore', NOW)
    store.file(0, 5, 'README', NOW)
    store.file(0, 1, 'dot.', NOW)
    store.file(0, 200, 'x.tar.gz', NOW)
    store.file(0, 7, 'c.xyz1', NOW)
    return store
  }

  it('groups by lower-case extension, biggest first, with files without one together', () => {
    expect(typeBreakdown(extensions(), 0, 500)).toEqual([
      { kind: 'extension', ext: 'gz', category: 'archive', size: 200, allocated: 1024, files: 1 },
      { kind: 'extension', ext: 'jpg', category: 'image', size: 150, allocated: 2048, files: 2 },
      { kind: 'none', ext: '', category: 'other', size: 16, allocated: 3072, files: 3 },
      { kind: 'extension', ext: 'xyz1', category: 'other', size: 7, allocated: 1024, files: 1 },
    ])
  })

  it('sums the groups beyond the limit into one "other" row', () => {
    expect(typeBreakdown(extensions(), 0, 2)).toEqual([
      { kind: 'extension', ext: 'gz', category: 'archive', size: 200, allocated: 1024, files: 1 },
      { kind: 'extension', ext: 'jpg', category: 'image', size: 150, allocated: 2048, files: 2 },
      { kind: 'other', ext: '', category: null, size: 23, allocated: 4096, files: 4 },
    ])
  })

  it('covers only the subtree of the folder', () => {
    const { store, c } = sample()
    expect(typeBreakdown(store, c, 500).map((row) => row.ext)).toEqual(['txt'])
  })
})

describe('ageBreakdown', () => {
  it('puts files in the right bucket at every edge and keeps all 8 buckets in order', () => {
    const store = new TreeStore(ROOT, 1024)
    const at = (ageMs: number) => store.file(0, 100, `f${store.fileLength}.dat`, NOW - ageMs)
    at(30 * DAY - 1000) // just under 30 days
    at(30 * DAY)
    at(91 * DAY)
    at(182 * DAY)
    at(365 * DAY)
    at(730 * DAY)
    at(1826 * DAY)
    at(-12 * 3_600_000) // modified 12 hours in the future: still "Last 30 days"
    store.file(0, 100, 'zero.dat', 0)
    store.file(0, 100, 'future.dat', NOW + 2 * DAY)
    const rows = ageBreakdown(store, 0, NOW)
    expect(rows.map((row) => row.id)).toEqual(AGE_BUCKETS.map((bucket) => bucket.id))
    expect(rows.map((row) => row.label)).toContain('Unknown date')
    expect(rows.map((row) => row.files)).toEqual([2, 1, 1, 1, 1, 1, 1, 2])
    expect(rows[0]).toMatchObject({ size: 200, allocated: 2048 })
  })

  it('lists empty buckets too', () => {
    const rows = ageBreakdown(new TreeStore(ROOT, 1024), 0, NOW)
    expect(rows).toHaveLength(8)
    expect(rows.every((row) => row.files === 0 && row.size === 0)).toBe(true)
  })
})

describe('SideViews', () => {
  it('maps the Mode to the ranking: allocated for Allocated, size for the others', () => {
    expect(rankByOf('allocated')).toBe('allocated')
    expect(['size', 'files', 'percent'].map((mode) => rankByOf(mode as 'size'))).toEqual([
      'size',
      'size',
      'size',
    ])
  })

  it('answers for a folder, a "[N files]" row and a file as for their folder', () => {
    const { store, a } = sample()
    const views = new SideViews(store, () => NOW)
    expect(ids(views.topFiles(`d${a}`, 'size') ?? [])).toEqual(['f0', 'f1', 'f2'])
    expect(ids(views.topFiles(`g${a}`, 'size') ?? [])).toEqual(['f0', 'f1', 'f2'])
    expect(ids(views.topFiles('f0', 'size') ?? [])).toEqual(['f0', 'f1', 'f2'])
    expect(views.types('d0')?.map((row) => row.ext)).toEqual(['jpg', 'mp4', 'bin', 'txt'])
    expect(views.age('d0')?.[0]?.files).toBe(5)
  })

  it('answers null for a node that does not exist', () => {
    const { store } = sample()
    const views = new SideViews(store, () => NOW)
    expect(views.topFiles('d99', 'size')).toBeNull()
    expect(views.types('f99')).toBeNull()
    expect(views.age('../x')).toBeNull()
  })

  it('keeps a result until the tree changes, per folder and ranking', () => {
    const { store, a } = sample()
    const views = new SideViews(store, () => NOW)
    const first = views.topFiles('d0', 'size')
    expect(views.topFiles('d0', 'files')).toBe(first) // the same ranking
    expect(views.topFiles('d0', 'allocated')).not.toBe(first)
    expect(views.topFiles(`d${a}`, 'size')).not.toBe(first)
    expect(views.topFiles('d0', 'size')).toBe(first)
    store.file(0, 9999, 'new.bin', NOW)
    const second = views.topFiles('d0', 'size')
    expect(second).not.toBe(first)
    expect(second?.[0]?.name).toBe('new.bin')
  })
})

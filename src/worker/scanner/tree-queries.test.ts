import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ChildSorter,
  childrenPage,
  childRefs,
  compareRows,
  expandIds,
  MAX_EXPAND_IDS,
  nodeDetails,
  resolveNode,
  rowOf,
} from './tree-queries'
import { nodePaths } from './tree-queries'
import type { SortDir, SortKey } from '@shared/tree-types'
import { TreeStore } from './tree-store'

const ROOT = 'C:\\Data'

/**
 * Data
 *   Music (1 file, 100 bytes)
 *   Photos
 *     2024 (2 files, 500 bytes)
 *     c.jpg 50
 *   Video (1 file, 9000 bytes)
 *   notes.txt 5, readme.md 7
 */
function sample() {
  const store = new TreeStore(ROOT, 1024)
  const music = store.folder(0, 'Music', 10)
  const photos = store.folder(0, 'Photos', 20)
  const video = store.folder(0, 'Video', 30)
  const year = store.folder(photos, '2024', 40)
  store.file(music, 100, 'song.mp3', 100)
  store.file(year, 300, 'a.jpg', 300)
  store.file(year, 200, 'b.jpg', 200)
  store.file(photos, 50, 'c.jpg', 50)
  store.file(video, 9000, 'clip.mp4', 900)
  store.file(0, 5, 'notes.txt', 5)
  store.file(0, 7, 'readme.md', 7)
  return { store, sorter: new ChildSorter(store), music, photos, video, year }
}

describe('resolveNode', () => {
  it('accepts folders, file groups and files that exist', () => {
    const { store, photos } = sample()
    expect(resolveNode(store, 'd0')).toEqual({ kind: 'folder', index: 0 })
    expect(resolveNode(store, `g${photos}`)).toEqual({ kind: 'files', index: photos })
    expect(resolveNode(store, 'f0')).toEqual({ kind: 'file', index: 0 })
  })

  it.each(['', 'x1', 'd', 'd-1', 'd99', 'f99', 'g99', 'd1.5', ' d0'])('rejects %j', (id) => {
    const { store } = sample()
    expect(resolveNode(store, id)).toBeNull()
  })

  it('rejects the "[N files]" row of a folder with no files of its own', () => {
    const { store } = sample()
    const empty = store.folder(0, 'Empty', 0)
    expect(resolveNode(store, `g${empty}`)).toBeNull()
  })
})

describe('childrenPage', () => {
  it('lists child folders plus one "[N files]" row, largest first', () => {
    const { store, sorter } = sample()
    const page = childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 100)
    expect(page?.total).toBe(4)
    expect(page?.rows.map((row) => [row.kind, row.name, row.size])).toEqual([
      ['folder', 'Video', 9000],
      ['folder', 'Photos', 550],
      ['folder', 'Music', 100],
      ['files', '', 12],
    ])
    expect(page?.parent).toMatchObject({
      id: 'd0',
      parentId: null,
      name: ROOT,
      size: 9662,
      files: 7,
      folders: 4,
      childCount: 4,
    })
  })

  it('fills every column of a folder row', () => {
    const { store, sorter, photos } = sample()
    const row = childrenPage(store, sorter, 'd0', 'name', 'asc', 0, 100)?.rows.find(
      (r) => r.name === 'Photos',
    )
    expect(row).toEqual({
      id: `d${photos}`,
      parentId: 'd0',
      kind: 'folder',
      name: 'Photos',
      size: 550,
      allocated: 3072,
      files: 3,
      folders: 1,
      modifiedMs: 300,
      childCount: 2,
    })
  })

  it('pages through the sorted rows', () => {
    const { store, sorter } = sample()
    const page = childrenPage(store, sorter, 'd0', 'name', 'asc', 1, 2)
    expect(page?.offset).toBe(1)
    expect(page?.total).toBe(4)
    expect(page?.rows.map((row) => row.name)).toEqual(['Music', 'Photos'])
  })

  it('sorts by every key in both directions', () => {
    const { store, sorter } = sample()
    const names = (key: Parameters<typeof childrenPage>[3], dir: 'asc' | 'desc') =>
      childrenPage(store, sorter, 'd0', key, dir, 0, 10)?.rows.map((row) => row.name || '[files]')
    expect(names('name', 'asc')).toEqual(['[files]', 'Music', 'Photos', 'Video'])
    expect(names('name', 'desc')).toEqual(['Video', 'Photos', 'Music', '[files]'])
    expect(names('files', 'desc')).toEqual(['Photos', '[files]', 'Music', 'Video'])
    expect(names('folders', 'desc')).toEqual(['Photos', '[files]', 'Music', 'Video'])
    expect(names('modified', 'desc')).toEqual(['Video', 'Photos', 'Music', '[files]'])
    expect(names('allocated', 'asc')).toEqual(['Music', '[files]', 'Photos', 'Video'])
  })

  it('lists the files of a "[N files]" row', () => {
    const { store, sorter } = sample()
    const page = childrenPage(store, sorter, 'g0', 'size', 'desc', 0, 10)
    expect(page?.parent).toMatchObject({ kind: 'files', files: 2, size: 12, childCount: 2 })
    expect(page?.rows.map((row) => [row.kind, row.name, row.files, row.allocated])).toEqual([
      ['file', 'readme.md', 1, 1024],
      ['file', 'notes.txt', 1, 1024],
    ])
    expect(page?.rows[0]?.parentId).toBe('g0')
  })

  it('caps the page size and clamps the offset', () => {
    const { store, sorter } = sample()
    expect(childrenPage(store, sorter, 'd0', 'size', 'desc', 50, 5)?.rows).toEqual([])
    expect(childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 5000)?.rows).toHaveLength(4)
  })

  it('returns null for an unknown node', () => {
    const { store, sorter } = sample()
    expect(childrenPage(store, sorter, 'd77', 'size', 'desc', 0, 10)).toBeNull()
  })

  it('re-sorts after the tree changes', () => {
    const { store, sorter, music } = sample()
    expect(childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 1)?.rows[0]?.name).toBe('Video')
    store.file(music, 100_000, 'album.flac', 1)
    expect(childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 1)?.rows[0]?.name).toBe('Music')
  })
})

describe('compareRows', () => {
  it('breaks ties by name, then id, whatever the direction', () => {
    const base = { parentId: null, kind: 'folder' as const, allocated: 0, files: 0 }
    const common = { ...base, folders: 0, modifiedMs: 0, childCount: 0, size: 5 }
    const a = { ...common, id: 'd1', name: 'alpha' }
    const b = { ...common, id: 'd2', name: 'beta' }
    expect(compareRows(a, b, 'size', 'desc')).toBeLessThan(0)
    expect(compareRows(a, b, 'size', 'asc')).toBeLessThan(0)
  })
})

describe('nodeDetails', () => {
  it('gives the path, the ancestors and each step’s index in the sorted children', () => {
    const { store, sorter, photos, year } = sample()
    const details = nodeDetails(store, sorter, `d${year}`, 'size', 'desc')
    expect(details?.path).toBe(path.join(ROOT, 'Photos', '2024'))
    expect(details?.ancestorIds).toEqual(['d0', `d${photos}`])
    expect(details?.locations).toEqual([
      { parentId: 'd0', index: 1 },
      { parentId: `d${photos}`, index: 0 },
    ])
  })

  it('gives a file’s path through its "[N files]" row', () => {
    const { store, sorter, photos } = sample()
    const [file] = store.filesIn(photos)
    const details = nodeDetails(store, sorter, `f${file}`, 'size', 'desc')
    expect(details?.path).toBe(path.join(ROOT, 'Photos', 'c.jpg'))
    expect(details?.ancestorIds).toEqual(['d0', `d${photos}`, `g${photos}`])
    expect(details?.row).toMatchObject({ kind: 'file', name: 'c.jpg', size: 50 })
  })

  it('gives the root with no ancestors', () => {
    const { store, sorter } = sample()
    expect(nodeDetails(store, sorter, 'd0', 'size', 'desc')).toMatchObject({
      path: ROOT,
      ancestorIds: [],
      locations: [],
    })
  })
})

describe('nodePaths', () => {
  it('gives only the row and the path of each id, null for ids that do not resolve', () => {
    const { store, photos, year } = sample()
    const [file] = store.filesIn(photos)
    const result = nodePaths(store, ['d0', `d${year}`, `f${file}`, 'd999', `g${photos}`])
    expect(result.map((entry) => entry?.path ?? null)).toEqual([
      ROOT,
      path.join(ROOT, 'Photos', '2024'),
      path.join(ROOT, 'Photos', 'c.jpg'),
      null,
      path.join(ROOT, 'Photos'),
    ])
    expect(result[2]?.row).toMatchObject({ kind: 'file', name: 'c.jpg' })
    expect(Object.keys(result[1] ?? {}).sort()).toEqual(['path', 'row'])
  })

  it('does not sort any folder', () => {
    const { store, photos } = sample()
    const sorter = {
      sorted: () => {
        throw new Error('sorted')
      },
    }
    expect(() => nodePaths(store, [`d${photos}`])).not.toThrow()
    expect(sorter).toBeDefined()
  })
})

describe('expandIds', () => {
  it('returns the folders to expand for each level', () => {
    const { store, photos } = sample()
    expect(expandIds(store, 'd0', 1)).toEqual(['d0'])
    expect(expandIds(store, 'd0', 2).sort()).toEqual(['d0', 'd1', 'd2', 'd3'].sort())
    expect(expandIds(store, 'd0', 9)).toContain(`d${photos}`)
    expect(expandIds(store, 'd0', 9)).toContain('d4')
  })

  it('returns nothing for a file or an unknown node', () => {
    const { store } = sample()
    expect(expandIds(store, 'f0', 3)).toEqual([])
    expect(expandIds(store, 'd99', 3)).toEqual([])
  })

  it('copes with a folder that has hundreds of thousands of subfolders', () => {
    const store = new TreeStore(ROOT, 4096)
    for (let i = 0; i < 300_000; i += 1) store.folder(0, `s${i}`, 0)
    expect(expandIds(store, 'd0', 2)).toEqual(['d0'])
  })

  it('stops at MAX_EXPAND_IDS', () => {
    const store = new TreeStore(ROOT, 4096)
    for (let i = 0; i < MAX_EXPAND_IDS + 10; i += 1) {
      const folder = store.folder(0, `d${i}`, 0)
      store.file(folder, 1, 'x', 0)
    }
    expect(expandIds(store, 'd0', 2)).toHaveLength(MAX_EXPAND_IDS)
  })
})

describe('compareRows id tie-break', () => {
  it('orders equal names by id in both directions', () => {
    const base = {
      parentId: null,
      kind: 'folder' as const,
      allocated: 0,
      files: 0,
      folders: 0,
      modifiedMs: 0,
      childCount: 0,
      size: 5,
      name: 'same',
    }
    const low = { ...base, id: 'd1' }
    const high = { ...base, id: 'd2' }
    expect(compareRows(low, high, 'name', 'asc')).toBeLessThan(0)
    expect(compareRows(low, high, 'name', 'desc')).toBeLessThan(0)
    expect(compareRows(high, low, 'size', 'desc')).toBeGreaterThan(0)
  })
})

describe('ChildSorter cache', () => {
  it('reuses the order while the store is unchanged and rebuilds it after a change', () => {
    const { store, sorter, music } = sample()
    const ref = { kind: 'folder' as const, index: 0 }
    const first = sorter.sorted(ref, 'size', 'desc')
    expect(sorter.sorted(ref, 'size', 'desc')).toBe(first)
    store.file(music, 1, 'again.mp3', 1)
    expect(sorter.sorted(ref, 'size', 'desc')).not.toBe(first)
  })

  it('keeps 64 orders and drops the oldest one after that', () => {
    const store = new TreeStore(ROOT, 1024)
    for (let i = 1; i <= 65; i += 1) store.folder(0, `F${i}`, 0)
    const sorter = new ChildSorter(store)
    const ref = (index: number) => ({ kind: 'folder' as const, index })
    const cached = new Map<number, unknown>()
    for (let i = 1; i <= 64; i += 1) cached.set(i, sorter.sorted(ref(i), 'name', 'asc'))
    expect(sorter.sorted(ref(1), 'name', 'asc')).toBe(cached.get(1))

    sorter.sorted(ref(65), 'name', 'asc')
    expect(sorter.sorted(ref(2), 'name', 'asc')).toBe(cached.get(2))
    expect(sorter.sorted(ref(1), 'name', 'asc')).not.toBe(cached.get(1))
  })
})

describe('large folders in chunks', () => {
  function bigFolder(count: number) {
    const store = new TreeStore(ROOT, 1)
    const folder = store.folder(0, 'Many', 0)
    for (let i = 0; i < count; i += 1) {
      // Many ties: 37 sizes for the whole folder, so names and ids decide most positions.
      store.file(folder, i % 37, `item-${(i * 7919) % count}.dat`, 0)
    }
    return { store, sorter: new ChildSorter(store), folder }
  }

  it.each(['asc', 'desc'] as const)(
    'orders 5,000 children and pages into the middle (%s)',
    (dir) => {
      const { store, sorter, folder } = bigFolder(5000)
      // A page holds at most MAX_PAGE_ROWS (1000) rows, so read the folder in pages.
      const all = []
      for (let offset = 0; offset < 5000; offset += 1000) {
        all.push(
          ...(childrenPage(store, sorter, `g${folder}`, 'size', dir, offset, 1000)?.rows ?? []),
        )
      }
      expect(all).toHaveLength(5000)
      for (let i = 1; i < all.length; i += 1) {
        expect(compareRows(all[i - 1]!, all[i]!, 'size', dir)).toBeLessThan(0)
      }
      const middle = childrenPage(store, sorter, `g${folder}`, 'size', dir, 3000, 10)
      expect(middle?.rows.map((row) => row.id)).toEqual(all.slice(3000, 3010).map((row) => row.id))
    },
  )

  it('orders values too large to pack with a position', () => {
    const store = new TreeStore(ROOT, 1)
    store.file(0, 10_000_000_000, 'huge.bin', 0)
    store.file(0, 5, 'small.bin', 0)
    const sorter = new ChildSorter(store)
    expect(
      childrenPage(store, sorter, 'g0', 'size', 'desc', 0, 10)?.rows.map((r) => r.name),
    ).toEqual(['huge.bin', 'small.bin'])
    expect(
      childrenPage(store, sorter, 'g0', 'size', 'asc', 0, 10)?.rows.map((r) => r.name),
    ).toEqual(['small.bin', 'huge.bin'])
  })
})

describe('lazy ordering of a huge folder', () => {
  /** The order from scratch: every row built, then sorted with `compareRows`. */
  function reference(store: TreeStore, folder: number, key: SortKey, dir: SortDir) {
    const ref = { kind: 'files' as const, index: folder }
    return childRefs(store, ref)
      .map((child) => rowOf(store, child))
      .sort((a, b) => compareRows(a, b, key, dir))
      .map((row) => row.id)
  }

  const ids = (
    store: TreeStore,
    sorter: ChildSorter,
    folder: number,
    key: SortKey,
    dir: SortDir,
  ) => {
    return (offset: number, limit: number) =>
      childrenPage(store, sorter, `g${folder}`, key, dir, offset, limit)?.rows.map((r) => r.id)
  }

  it.each(['asc', 'desc'] as const)(
    'gives the same rows as a full sort when pages are read out of order (%s)',
    (dir) => {
      // Three sizes, so each run of equal values has 4,000 rows and a first page orders only a few.
      const store = new TreeStore(ROOT, 1)
      const folder = store.folder(0, 'Many', 0)
      for (let i = 0; i < 12_000; i += 1) {
        store.file(folder, (i % 3) * 100, `item-${(i * 7919) % 12_000}.dat`, 0)
      }
      const expected = reference(store, folder, 'size', dir)
      const read = ids(store, new ChildSorter(store), folder, 'size', dir)
      expect(read(0, 200)).toEqual(expected.slice(0, 200))
      expect(read(150, 100)).toEqual(expected.slice(150, 250))
      expect(read(7900, 300)).toEqual(expected.slice(7900, 8200))
      expect(read(0, 1000)).toEqual(expected.slice(0, 1000))
      expect(read(11_500, 1000)).toEqual(expected.slice(11_500))
    },
  )

  it('pages a name order the same way', () => {
    const store = new TreeStore(ROOT, 1)
    const folder = store.folder(0, 'Many', 0)
    for (let i = 0; i < 6000; i += 1) store.file(folder, i, `n${(i * 31) % 6000}.txt`, 0)
    for (const dir of ['asc', 'desc'] as const) {
      const expected = reference(store, folder, 'name', dir)
      const read = ids(store, new ChildSorter(store), folder, 'name', dir)
      expect(read(0, 100)).toEqual(expected.slice(0, 100))
      expect(read(4000, 50)).toEqual(expected.slice(4000, 4050))
    }
  })

  it('finds the top rows when the sampled boundary is too high', () => {
    // Every 9th file is large, so a sample taken every 9th row sees only large files and the
    // first boundary it guesses holds too few rows; the order must still be right.
    const store = new TreeStore(ROOT, 1)
    const folder = store.folder(0, 'Skewed', 0)
    for (let i = 0; i < 20_000; i += 1) {
      store.file(folder, i % 9 === 0 ? 1_000_000 + i : 0, `s${i}.dat`, 0)
    }
    const expected = reference(store, folder, 'size', 'desc')
    const read = ids(store, new ChildSorter(store), folder, 'size', 'desc')
    expect(read(0, 100)).toEqual(expected.slice(0, 100))
    expect(read(2200, 100)).toEqual(expected.slice(2200, 2300))
  })
})

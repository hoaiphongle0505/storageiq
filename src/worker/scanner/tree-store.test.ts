import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { allocatedSize, MAX_SCAN_ERRORS, scanErrorReason, TreeStore } from './tree-store'

const ROOT = 'C:\\Data'

/** Data\Photos\2024\{a 300, b 200}, Data\Photos\c 50, Data\notes 5. */
function sample() {
  const store = new TreeStore(ROOT, 4096)
  const photos = store.folder(0, 'Photos', 1_000)
  const year = store.folder(photos, '2024', 2_000)
  store.file(year, 300, 'a.jpg', 5_000)
  store.file(year, 200, 'b.jpg', 4_000)
  store.file(photos, 50, 'c.jpg', 3_000)
  store.file(0, 5, 'notes.txt', 9_000)
  return { store, photos, year }
}

describe('allocatedSize', () => {
  it.each([
    [0, 4096, 0],
    [1, 4096, 4096],
    [4096, 4096, 4096],
    [4097, 4096, 8192],
    [10_000, 512, 10_240],
    [123, 0, 123],
  ])('size %d with %d-byte clusters takes %d bytes', (size, cluster, expected) => {
    expect(allocatedSize(size, cluster)).toBe(expected)
  })
})

describe('TreeStore', () => {
  it('starts with only the root', () => {
    const store = new TreeStore(ROOT, 4096)
    expect(store.totals()).toEqual({ files: 0, folders: 0, bytes: 0, allocatedBytes: 0 })
    expect(store.folderName(0)).toBe(ROOT)
    expect(store.folderParent(0)).toBe(-1)
    expect(store.currentPath).toBe(ROOT)
    expect(store.folderLength).toBe(1)
  })

  it('bubbles size, allocated size and counts up to every ancestor', () => {
    const { store, photos, year } = sample()
    expect(store.folderSize(year)).toBe(500)
    expect(store.folderAllocated(year)).toBe(8192)
    expect(store.folderFiles(year)).toBe(2)
    expect(store.folderFolders(photos)).toBe(1)
    expect(store.folderSize(photos)).toBe(550)
    expect(store.folderAllocated(photos)).toBe(12_288)
    expect(store.totals()).toEqual({ files: 4, folders: 2, bytes: 555, allocatedBytes: 16_384 })
  })

  it('keeps the files directly in each folder as their own totals', () => {
    const { store, photos } = sample()
    expect(store.directFiles(photos)).toBe(1)
    expect(store.directSize(photos)).toBe(50)
    expect(store.directAllocated(photos)).toBe(4096)
    expect(store.directModified(photos)).toBe(3_000)
    expect(store.directFiles(0)).toBe(1)
  })

  it('takes the newest modification time below each folder', () => {
    const { store, photos, year } = sample()
    expect(store.folderModified(year)).toBe(5_000)
    expect(store.folderModified(photos)).toBe(5_000)
    expect(store.folderModified(0)).toBe(9_000)
  })

  it('lists children and files and builds full paths', () => {
    const { store, photos, year } = sample()
    expect(store.childFolders(0)).toEqual([photos])
    expect(store.childFolders(photos)).toEqual([year])
    expect(
      store
        .filesIn(year)
        .map((f) => store.fileName(f))
        .sort(),
    ).toEqual(['a.jpg', 'b.jpg'])
    expect(store.folderPath(year)).toBe(path.join(ROOT, 'Photos', '2024'))
    expect(store.folderPath(0)).toBe(ROOT)
    const [first] = store.filesIn(year)
    expect(store.filePath(first ?? -1)).toMatch(/^C:\\Data\\Photos\\2024\\[ab]\.jpg$/)
  })

  it('grows past its initial capacity', () => {
    const store = new TreeStore(ROOT, 4096)
    let parent = 0
    for (let i = 0; i < 3000; i += 1) parent = store.folder(parent, `d${i}`, i)
    for (let i = 0; i < 20_000; i += 1) store.file(parent, 1, `f${i}`, i)
    expect(store.totals()).toEqual({
      files: 20_000,
      folders: 3000,
      bytes: 20_000,
      allocatedBytes: 20_000 * 4096,
    })
    expect(store.folderFiles(store.folderChain(parent)[1] ?? -1)).toBe(20_000)
  })

  it('resetFolder removes a subtree from every total and detaches its entries', () => {
    const { store, photos, year } = sample()
    const [file] = store.filesIn(year)
    store.resetFolder(photos)

    expect(store.totals()).toEqual({ files: 1, folders: 1, bytes: 5, allocatedBytes: 4096 })
    expect(store.folderSize(photos)).toBe(0)
    expect(store.childFolders(photos)).toEqual([])
    expect(store.isLiveFolder(photos)).toBe(true)
    expect(store.isLiveFolder(year)).toBe(false)
    expect(store.isLiveFile(file ?? -1)).toBe(false)
    expect(store.folderModified(0)).toBe(9_000)
    expect(store.folderModified(photos)).toBe(1_000)
  })

  it('refills a reset folder through the walk sink', () => {
    const { store, photos } = sample()
    store.resetFolder(photos)
    store.file(photos, 7, 'new.txt', 10_000)
    expect(store.totals()).toEqual({ files: 2, folders: 1, bytes: 12, allocatedBytes: 8192 })
    expect(store.folderModified(0)).toBe(10_000)
  })

  it('bumps its version on every change', () => {
    const store = new TreeStore(ROOT, 4096)
    const before = store.version
    store.file(0, 1, 'a', 0)
    expect(store.version).toBeGreaterThan(before)
  })

  it('rejects ids outside the tree', () => {
    const { store } = sample()
    expect(store.isLiveFolder(99)).toBe(false)
    expect(store.isLiveFolder(-1)).toBe(false)
    expect(store.isLiveFile(4)).toBe(false)
    expect(store.isLiveFile(0)).toBe(true)
  })

  it('tracks the folder being listed', () => {
    const store = new TreeStore(ROOT, 4096)
    store.visiting(path.join(ROOT, 'Photos'))
    expect(store.currentPath).toBe(path.join(ROOT, 'Photos'))
  })

  it('keeps the first 1000 errors and counts every one', () => {
    const store = new TreeStore(ROOT, 4096)
    for (let i = 0; i < MAX_SCAN_ERRORS + 5; i += 1) {
      store.error(path.join(ROOT, `locked-${i}`), 'EPERM', 'folder')
    }
    expect(store.errors).toHaveLength(1000)
    expect(store.errorCount).toBe(1005)
    expect(store.errors[0]).toEqual({
      path: path.join(ROOT, 'locked-0'),
      kind: 'folder',
      reason: 'access-denied',
      code: 'EPERM',
    })
  })
})

describe('scanErrorReason', () => {
  it.each([
    ['EACCES', 'access-denied'],
    ['EPERM', 'access-denied'],
    ['ENAMETOOLONG', 'path-too-long'],
    ['ENOENT', 'not-found'],
    ['EBUSY', 'other'],
  ])('maps %s to %s', (code, reason) => {
    expect(scanErrorReason(code)).toBe(reason)
  })
})

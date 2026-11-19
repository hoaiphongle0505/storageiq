import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScanTree, MAX_SCAN_ERRORS, scanErrorReason } from './tree'

const ROOT = 'C:\\Data'

describe('createScanTree', () => {
  it('starts empty at the root', () => {
    const tree = createScanTree(ROOT)
    expect(tree.totals()).toEqual({ files: 0, folders: 0, bytes: 0 })
    expect(tree.currentPath).toBe(ROOT)
    expect(tree.errors).toEqual([])
    expect(tree.errorCount).toBe(0)
  })

  it('bubbles file sizes and counts up to every ancestor', () => {
    const tree = createScanTree(ROOT)
    const photos = tree.folder(tree.root, 'Photos')
    const year = tree.folder(photos, '2024')
    tree.file(year, 300)
    tree.file(year, 200)
    tree.file(photos, 50)
    tree.file(tree.root, 5)

    expect(year).toMatchObject({ bytes: 500, files: 2, folders: 0 })
    expect(photos).toMatchObject({ bytes: 550, files: 3, folders: 1 })
    expect(tree.totals()).toEqual({ files: 4, folders: 2, bytes: 555 })
    expect(tree.root.children).toHaveLength(1)
    expect(tree.root.children[0]).toBe(photos)
  })

  it('builds full paths from folder names', () => {
    const tree = createScanTree(ROOT)
    const year = tree.folder(tree.folder(tree.root, 'Photos'), '2024')
    expect(tree.pathOf(year)).toBe(path.join(ROOT, 'Photos', '2024'))
    expect(tree.pathOf(tree.root)).toBe(ROOT)
  })

  it('tracks the folder being listed', () => {
    const tree = createScanTree(ROOT)
    tree.visiting(path.join(ROOT, 'Photos'))
    expect(tree.currentPath).toBe(path.join(ROOT, 'Photos'))
  })

  it('keeps the first 1000 errors and counts every one', () => {
    const tree = createScanTree(ROOT)
    for (let i = 0; i < MAX_SCAN_ERRORS + 5; i += 1) {
      tree.error(path.join(ROOT, `locked-${i}`), 'EPERM')
    }
    expect(MAX_SCAN_ERRORS).toBe(1000)
    expect(tree.errors).toHaveLength(1000)
    expect(tree.errorCount).toBe(1005)
    expect(tree.errors[0]).toEqual({
      path: path.join(ROOT, 'locked-0'),
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
    ['UNKNOWN', 'other'],
  ])('maps %s to %s', (code, reason) => {
    expect(scanErrorReason(code)).toBe(reason)
  })
})

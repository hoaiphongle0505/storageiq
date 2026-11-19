import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVERYTHING_ELSE_LABEL, TOP_FOLDER_LIMIT, topFolders } from './top-folders'
import { createScanTree } from './tree'

const ROOT = 'C:\\Data'

/** One child folder per entry, each holding one file of the given size. */
function treeWith(children: Array<[string, number]>, rootFileBytes?: number) {
  const tree = createScanTree(ROOT)
  for (const [name, bytes] of children) tree.file(tree.folder(tree.root, name), bytes)
  if (rootFileBytes !== undefined) tree.file(tree.root, rootFileBytes)
  return tree
}

describe('topFolders', () => {
  it('lists the direct children of the root, largest first, with full paths', () => {
    const rows = topFolders(
      treeWith([
        ['Music', 100],
        ['Videos', 900],
        ['Photos', 500],
      ]),
    )
    expect(rows).toEqual([
      {
        kind: 'folder',
        name: 'Videos',
        path: path.join(ROOT, 'Videos'),
        bytes: 900,
        files: 1,
        folders: 0,
      },
      {
        kind: 'folder',
        name: 'Photos',
        path: path.join(ROOT, 'Photos'),
        bytes: 500,
        files: 1,
        folders: 0,
      },
      {
        kind: 'folder',
        name: 'Music',
        path: path.join(ROOT, 'Music'),
        bytes: 100,
        files: 1,
        folders: 0,
      },
    ])
  })

  it('keeps the top 10 and sums everything else into one row', () => {
    const children = Array.from({ length: 12 }, (_, i): [string, number] => [
      `c${String(i + 1).padStart(2, '0')}`,
      (i + 1) * 100,
    ])
    const tree = treeWith(children, 7)
    const first = tree.root.children.find((node) => node.name === 'c01')
    if (!first) throw new Error('c01 missing')
    tree.folder(first, 'nested')

    const rows = topFolders(tree)

    expect(TOP_FOLDER_LIMIT).toBe(10)
    expect(rows).toHaveLength(11)
    expect(rows.slice(0, 10).map((row) => row.name)).toEqual([
      'c12',
      'c11',
      'c10',
      'c09',
      'c08',
      'c07',
      'c06',
      'c05',
      'c04',
      'c03',
    ])
    expect(rows[10]).toEqual({
      kind: 'everything-else',
      name: EVERYTHING_ELSE_LABEL,
      path: ROOT,
      bytes: 307, // c01 (100) + c02 (200) + the root file (7)
      files: 3,
      folders: 3, // c01, c01\nested and c02
    })
  })

  it('adds an "Everything else" row for files directly in the root', () => {
    const rows = topFolders(treeWith([['Photos', 500]], 20))
    expect(rows.map((row) => [row.kind, row.bytes])).toEqual([
      ['folder', 500],
      ['everything-else', 20],
    ])
  })

  it('leaves the row out when nothing is left over', () => {
    const rows = topFolders(
      treeWith([
        ['Photos', 500],
        ['Music', 100],
      ]),
    )
    expect(rows.every((row) => row.kind === 'folder')).toBe(true)
  })

  it('breaks size ties by name', () => {
    const rows = topFolders(
      treeWith([
        ['b', 100],
        ['c', 100],
        ['a', 100],
      ]),
    )
    expect(rows.map((row) => row.name)).toEqual(['a', 'b', 'c'])
  })
})

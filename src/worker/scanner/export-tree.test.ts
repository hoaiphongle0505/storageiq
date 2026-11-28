import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportTree, TREE_HEADER, treeRows } from './export-tree'
import { SideViews } from './side-views'
import { unzip } from './test/unzip'
import { TreeStore } from './tree-store'

const ROOT = 'C:\\Data'
/** A whole number of seconds, because the store keeps modification times in seconds. */
const NOW = Date.UTC(2026, 10, 28, 12)

/**
 * Data
 *   A
 *     B: mid.jpg 1500 (f1), tie.jpg 1500 (f2)
 *     big.MP4 3000 (f0)
 *   C: tiny.txt 10 (f3)
 *   root.bin 2000 (f4)
 *   =cmd.txt 1 (f5)
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
  store.file(0, 1, '=cmd.txt', 0)
  return { store, views: new SideViews(store, () => NOW + 1000) }
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'storageiq-export-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('treeRows', () => {
  it('lists every folder and file below the folder, depth first, biggest first', () => {
    const { store } = sample()
    const rows = [...treeRows(store, 0)]
    expect(rows.map((row) => row[0])).toEqual([
      path.join(ROOT, 'A'),
      path.join(ROOT, 'A', 'B'),
      path.join(ROOT, 'A', 'B', 'mid.jpg'),
      path.join(ROOT, 'A', 'B', 'tie.jpg'),
      path.join(ROOT, 'A', 'big.MP4'),
      path.join(ROOT, 'root.bin'),
      path.join(ROOT, 'C'),
      path.join(ROOT, 'C', 'tiny.txt'),
      path.join(ROOT, '=cmd.txt'),
    ])
  })

  it('fills the columns for a folder and for a file', () => {
    const { store } = sample()
    const rows = [...treeRows(store, 0)]
    expect(TREE_HEADER).toHaveLength(rows[0]?.length ?? -1)
    // Folder A: 6000 bytes of the root's 8011, in 3 files and 1 folder.
    expect(rows[0]).toEqual([
      path.join(ROOT, 'A'),
      'A',
      'Folder',
      '',
      6000,
      7168,
      3,
      1,
      expect.any(Date),
      74.9,
    ])
    // big.MP4: half of A.
    expect(rows[4]).toEqual([
      path.join(ROOT, 'A', 'big.MP4'),
      'big.MP4',
      'File',
      'mp4',
      3000,
      3072,
      1,
      0,
      new Date(NOW),
      50,
    ])
    // A file with an unknown date has an empty date.
    expect(rows[8]?.[8]).toBeNull()
  })

  it('starts below the folder it is given, with shares of that folder', () => {
    const { store } = sample()
    const rows = [...treeRows(store, 1)]
    expect(rows.map((row) => row[1])).toEqual(['B', 'mid.jpg', 'tie.jpg', 'big.MP4'])
    expect(rows[0]?.[9]).toBe(50) // B is 3000 of A's 6000
  })
})

describe('exportTree to CSV', () => {
  it('writes a BOM, the header and one CRLF line per row, with no formula injection', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'out.csv')
    expect(await exportTree(store, views, 'd0', 'csv', file)).toEqual({ rows: 9, truncated: false })
    const text = readFileSync(file, 'utf8')
    expect(text.startsWith('\uFEFFPath,Name,Type,Extension,Size (bytes),')).toBe(true)
    const lines = text.slice(1).split('\r\n')
    expect(lines).toHaveLength(1 + 9 + 1)
    const iso = new Date(NOW).toISOString()
    expect(lines[5]).toBe(
      `${path.join(ROOT, 'A', 'big.MP4')},big.MP4,File,mp4,3000,3072,1,0,${iso},50`,
    )
    // The name starts with "=": it gets a leading quote; the path starts with the drive and does not.
    expect(lines[9]).toBe(`${path.join(ROOT, '=cmd.txt')},'=cmd.txt,File,txt,1,1024,1,0,,0`)
    expect(lines[10]).toBe('')
  })

  it('has no row limit', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'out.csv')
    expect(await exportTree(store, views, 'd0', 'csv', file, 2)).toMatchObject({ rows: 9 })
  })

  it('answers null for a node that is gone and writes no file', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'none.csv')
    expect(await exportTree(store, views, 'd99', 'csv', file)).toBeNull()
    expect(() => readFileSync(file)).toThrow()
  })

  it('fails with the system’s message when the file cannot be created', async () => {
    const { store, views } = sample()
    const folder = path.join(dir, 'a-folder')
    mkdirSync(folder)
    await expect(exportTree(store, views, 'd0', 'csv', folder)).rejects.toThrow()
    await expect(
      exportTree(store, views, 'd0', 'csv', path.join(dir, 'missing', 'out.csv')),
    ).rejects.toThrow(/ENOENT|no such file/i)
  })
})

describe('exportTree to Excel', () => {
  it('writes four sheets: the tree, the top files, the types and the age', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'out.xlsx')
    expect(await exportTree(store, views, 'd0', 'xlsx', file)).toEqual({
      rows: 9,
      truncated: false,
    })
    const files = unzip(readFileSync(file))
    expect(files.get('xl/workbook.xml')).toMatch(
      /name="Tree".*name="Top files".*name="Types".*name="Age"/,
    )
    const tree = files.get('xl/worksheets/sheet1.xml') ?? ''
    expect(tree).toContain('<t>Path</t>')
    expect(tree.match(/<row /g)).toHaveLength(1 + 9)
    // Text is never a formula, so the "=" file name needs no prefix here.
    expect(tree).toContain('<t>=cmd.txt</t>')
    expect(tree).not.toContain('<f>')
    const top = files.get('xl/worksheets/sheet2.xml') ?? ''
    expect(top.match(/<row /g)).toHaveLength(1 + 6)
    expect(top).toContain('<t>big.MP4</t>')
    const types = files.get('xl/worksheets/sheet3.xml') ?? ''
    expect(types).toContain('<t>.jpg</t>')
    const age = files.get('xl/worksheets/sheet4.xml') ?? ''
    expect(age.match(/<row /g)).toHaveLength(1 + 8)
  })

  it('stops the Tree sheet at the row limit and says so', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'out.xlsx')
    expect(await exportTree(store, views, 'd0', 'xlsx', file, 4)).toEqual({
      rows: 4,
      truncated: true,
    })
    const tree = unzip(readFileSync(file)).get('xl/worksheets/sheet1.xml') ?? ''
    expect(tree.match(/<row /g)).toHaveLength(1 + 4)
  })

  it('removes a file it could not finish', async () => {
    const { store } = sample()
    const file = path.join(dir, 'half.xlsx')
    const broken = new SideViews(store)
    broken.topFiles = () => {
      throw new Error('boom')
    }
    await expect(exportTree(store, broken, 'd0', 'xlsx', file)).rejects.toThrow('boom')
    expect(() => readFileSync(file)).toThrow()
  })
})

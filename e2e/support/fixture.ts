import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Expected values of one tree row, before cluster rounding is applied. */
export interface ExpectedRow {
  name: string
  /** Sizes of the files below the row, to compute the allocated size for any cluster size. */
  fileSizes: number[]
  files: number
  folders: number
}

export interface ScanFixture {
  /** The folder to scan. */
  root: string
  expected: {
    files: number
    folders: number
    bytes: number
    /** The 12 top-level folders, largest first. */
    folders12: ExpectedRow[]
    /** The "[N files]" row of the root: root-file.txt and the junction (0 bytes). */
    rootFiles: ExpectedRow
    rootFileSizes: number[]
  }
  remove(): void
}

export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/** `ceil(size / cluster) * cluster` per file; 0-byte entries take 0 (spec §4). */
export function allocated(fileSizes: number[], clusterBytes: number): number {
  return sum(
    fileSizes.map((size) => (size === 0 ? 0 : Math.ceil(size / clusterBytes) * clusterBytes)),
  )
}

/**
 * 12 top-level folders of different sizes, each with a nested folder; one file directly in the
 * root; and a junction to a folder outside the root, which must be counted as one 0-byte entry
 * and never entered.
 */
export function createScanFixture(): ScanFixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'storageiq-e2e-'))
  const root = path.join(base, 'scan-me')
  const outside = path.join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'not-counted.bin'), Buffer.alloc(50_000))

  const tops: ExpectedRow[] = []
  for (let i = 1; i <= 12; i += 1) {
    const name = `folder-${String(i).padStart(2, '0')}`
    const folder = path.join(root, name)
    const nested = path.join(folder, 'nested')
    mkdirSync(nested, { recursive: true })
    const size = i * 1000
    for (let f = 0; f < 3; f += 1)
      writeFileSync(path.join(folder, `file-${f}.bin`), Buffer.alloc(size))
    for (let f = 0; f < 2; f += 1)
      writeFileSync(path.join(nested, `file-${f}.bin`), Buffer.alloc(size))
    tops.push({ name, fileSizes: Array(5).fill(size) as number[], files: 5, folders: 1 })
  }
  writeFileSync(path.join(root, 'root-file.txt'), Buffer.alloc(777))
  symlinkSync(outside, path.join(root, 'link-to-outside'), 'junction')
  const rootFiles: ExpectedRow = { name: '[2 files]', fileSizes: [777, 0], files: 2, folders: 0 }

  const rootFileSizes = [...tops.flatMap((top) => top.fileSizes), ...rootFiles.fileSizes]
  return {
    root,
    expected: {
      files: rootFileSizes.length, // 62
      folders: tops.length * 2, // 24
      bytes: sum(rootFileSizes), // 390,777
      folders12: [...tops].sort((a, b) => sum(b.fileSizes) - sum(a.fileSizes)),
      rootFiles,
      rootFileSizes,
    },
    remove: () => rmSync(base, { recursive: true, force: true }),
  }
}

export interface LargeFixture {
  root: string
  files: number
  remove(): void
}

/** `fileCount` files of 1 KB, 100 per folder, for the report-only scan-time metric. */
export function createLargeFixture(fileCount: number): LargeFixture {
  const root = mkdtempSync(path.join(os.tmpdir(), 'storageiq-metrics-'))
  const filesPerFolder = 100
  const payload = Buffer.alloc(1024)
  for (let i = 0; i < fileCount; i += 1) {
    const folder = path.join(
      root,
      `group-${String(Math.floor(i / filesPerFolder)).padStart(3, '0')}`,
    )
    if (i % filesPerFolder === 0) mkdirSync(folder)
    writeFileSync(path.join(folder, `file-${i}.bin`), payload)
  }
  return { root, files: fileCount, remove: () => rmSync(root, { recursive: true, force: true }) }
}

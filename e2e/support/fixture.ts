import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface ScanFixture {
  /** The folder to scan. */
  root: string
  expected: { files: number; folders: number; bytes: number; topFolderNames: string[] }
  remove(): void
}

/**
 * 12 top-level folders of different sizes (so the list shows 10 plus "Everything else"), each
 * with a nested folder; one file directly in the root; and a junction to a folder outside the
 * root, which must be counted as one 0-byte entry and never entered.
 */
export function createScanFixture(): ScanFixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'storageiq-e2e-'))
  const root = path.join(base, 'scan-me')
  const outside = path.join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'not-counted.bin'), Buffer.alloc(50_000))

  let files = 0
  let folders = 0
  let bytes = 0
  const tops: Array<{ name: string; bytes: number }> = []
  for (let i = 1; i <= 12; i += 1) {
    const name = `folder-${String(i).padStart(2, '0')}`
    const folder = path.join(root, name)
    const nested = path.join(folder, 'nested')
    mkdirSync(nested, { recursive: true })
    folders += 2
    const size = i * 1000
    for (let f = 0; f < 3; f += 1)
      writeFileSync(path.join(folder, `file-${f}.bin`), Buffer.alloc(size))
    for (let f = 0; f < 2; f += 1)
      writeFileSync(path.join(nested, `file-${f}.bin`), Buffer.alloc(size))
    files += 5
    bytes += size * 5
    tops.push({ name, bytes: size * 5 })
  }
  writeFileSync(path.join(root, 'root-file.txt'), Buffer.alloc(777))
  files += 1
  bytes += 777
  symlinkSync(outside, path.join(root, 'link-to-outside'), 'junction')
  files += 1 // the junction: one 0-byte entry

  const topFolderNames = [...tops]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10)
    .map((top) => top.name)
  return {
    root,
    expected: { files, folders, bytes, topFolderNames }, // 62 files, 24 folders, 390,777 bytes
    remove: () => rmSync(base, { recursive: true, force: true }),
  }
}

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOP_FILES_LIMIT, TYPE_ROWS_LIMIT } from '@shared/tree-types'
import { exportTree } from './export-tree'
import { ageBreakdown, SideViews, topFiles, typeBreakdown } from './side-views'
import { ChildSorter, childrenPage } from './tree-queries'
import { TreeStore } from './tree-store'
import { treemapLayout } from './treemap'

/** Spec §5 limits (1M generated files). */
export const PERF_LIMITS = {
  files: 1_000_000,
  /** Worker memory for the tree: typed arrays plus names. */
  maxMemoryMb: 300,
  /** Spec §4: about 250 MB for 2M entries, so at most 125 bytes per file. */
  maxBytesPerFile: 125,
  maxFirstPageMs: 100,
  maxTreemapMs: 100,
  /** Phase 4 spec §3.1: each side view of the root, one walk over every file. */
  maxSideViewMs: 300,
  /** Phase 5 spec §5: exporting the whole 1M-file tree to a file. */
  maxCsvExportMs: 10_000,
  maxXlsxExportMs: 20_000,
} as const

function usedBytes(): number {
  const { heapUsed, arrayBuffers } = process.memoryUsage()
  return heapUsed + arrayBuffers
}

/** Needs `--expose-gc` (set in vitest.perf.config.mts), so garbage is not counted as tree memory. */
function collect(): void {
  const gc = (globalThis as { gc?: () => void }).gc
  if (gc === undefined) throw new Error('Run with npm run test:perf (it exposes gc).')
  gc()
}

/**
 * A flat string, like the names `fs.opendir` returns. (A template literal would make a "cons"
 * string of two parts, which costs more memory than a real file name.)
 */
function flat(text: string): string {
  return Buffer.from(text, 'latin1').toString('latin1')
}

/**
 * 1,000,000 files in a 3-level tree: 100 top folders × 100 subfolders × 100 files, with
 * realistic names (about 20 characters). Built straight into the store, as the walk would.
 */
function generate(): TreeStore {
  const store = new TreeStore('C:\\', 4096, 50 * 1024 ** 3)
  let file = 0
  for (let a = 0; a < 100; a += 1) {
    const top = store.folder(0, `Top folder ${a}`, 1_700_000_000_000)
    for (let b = 0; b < 100; b += 1) {
      const sub = store.folder(top, `Subfolder ${a}-${b}`, 1_700_000_000_000)
      for (let c = 0; c < 100; c += 1) {
        const name = flat(`document-${file}.dat`)
        store.file(sub, (file * 7919) % 5_000_000, name, 1_700_000_000_000 + c)
        file += 1
      }
    }
  }
  return store
}

describe('tree store performance (1M files)', () => {
  it('stays inside the memory and latency limits', () => {
    collect()
    const before = usedBytes()
    const store = generate()
    collect()
    const memoryMb = (usedBytes() - before) / 1024 / 1024
    expect(store.totals().files).toBe(PERF_LIMITS.files)

    const sorter = new ChildSorter(store)
    let started = performance.now()
    const page = childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 200)
    const firstPageMs = performance.now() - started
    expect(page?.rows).toHaveLength(100)

    // The treemap is timed after one warm-up run (the first call also pays for JIT compiling),
    // as the median of three layouts at the default level.
    treemapLayout(store, 'd0', 'allocated', 1, 1600, 400)
    const times: number[] = []
    let rects = 0
    for (let run = 0; run < 3; run += 1) {
      started = performance.now()
      rects = treemapLayout(store, 'd0', 'allocated', 1, 1600, 400)?.rects.length ?? 0
      times.push(performance.now() - started)
    }
    const treemapMs = times.sort((a, b) => a - b)[1] ?? Infinity
    // Level 1 nests the 100 top folders' 10,000 subfolders under them, so this is the full load.
    expect(rects).toBeGreaterThanOrEqual(10_000)

    const bytesPerFile = (memoryMb * 1024 * 1024) / PERF_LIMITS.files
    const report = {
      files: PERF_LIMITS.files,
      memoryMb,
      bytesPerFile,
      firstPageMs,
      treemapMs,
      treemapRects: rects,
    }
    mkdirSync('metrics', { recursive: true })
    writeFileSync('metrics/perf.json', JSON.stringify(report, null, 2))
    console.log(`[perf] ${JSON.stringify(report)}`)

    expect(memoryMb).toBeLessThanOrEqual(PERF_LIMITS.maxMemoryMb)
    expect((memoryMb * 1024 * 1024) / PERF_LIMITS.files).toBeLessThanOrEqual(
      PERF_LIMITS.maxBytesPerFile,
    )
    expect(firstPageMs).toBeLessThanOrEqual(PERF_LIMITS.maxFirstPageMs)
    expect(treemapMs).toBeLessThanOrEqual(PERF_LIMITS.maxTreemapMs)
  }, 60_000)

  it('gives the first page of a flat folder of 200,000 files inside the first-page limit', () => {
    collect()
    const store = new TreeStore('C:\\', 4096, null)
    const flatFolder = store.folder(0, 'Flat folder', 1_700_000_000_000)
    for (let i = 0; i < 200_000; i += 1) {
      // Only 50 distinct sizes, so most rows tie and the order falls to the name, then the id.
      store.file(flatFolder, (i % 50) * 4096, flat(`file-${i}.dat`), 1_700_000_000_000)
    }
    // Build garbage is collected before the clock starts, so a GC pause is not timed as sort work.
    collect()
    const sorter = new ChildSorter(store)
    const started = performance.now()
    // The files sit under the folder's "[N files]" row (`g`), which is where the 200,000 rows are.
    const page = childrenPage(store, sorter, `g${flatFolder}`, 'size', 'desc', 0, 200)
    const firstPageMs = performance.now() - started
    expect(page?.total).toBe(200_000)
    expect(page?.rows).toHaveLength(200)
    console.log(`[perf] ${JSON.stringify({ flatFolderFiles: 200_000, firstPageMs })}`)
    expect(firstPageMs).toBeLessThanOrEqual(PERF_LIMITS.maxFirstPageMs)
  }, 60_000)
})

let shared: TreeStore | undefined
/** The 1M-file tree, built once for the three side-view cases. */
const sharedStore = () => (shared ??= generate())

/** The median of three runs after one warm-up run (the first call also pays for JIT compiling). */
function medianMs(run: () => void): number {
  run()
  const times: number[] = []
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now()
    run()
    times.push(performance.now() - started)
  }
  return times.sort((a, b) => a - b)[1] ?? Infinity
}

describe('side views (1M files)', () => {
  it('lists the top 1,000 files of the root inside the limit', () => {
    const store = sharedStore()
    let rows = 0
    const ms = medianMs(() => {
      rows = topFiles(store, 0, 'size', TOP_FILES_LIMIT).length
    })
    console.log(`[perf] ${JSON.stringify({ topFilesMs: ms })}`)
    expect(rows).toBe(TOP_FILES_LIMIT)
    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxSideViewMs)
  }, 60_000)

  it('breaks the root down by file type inside the limit', () => {
    const store = sharedStore()
    let rows = 0
    const ms = medianMs(() => {
      rows = typeBreakdown(store, 0, TYPE_ROWS_LIMIT).length
    })
    console.log(`[perf] ${JSON.stringify({ typesMs: ms })}`)
    expect(rows).toBe(1) // every generated file is "document-N.dat"
    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxSideViewMs)
  }, 60_000)

  it('breaks the root down by file age inside the limit', () => {
    const store = sharedStore()
    let files = 0
    const ms = medianMs(() => {
      files = ageBreakdown(store, 0, 1_700_000_000_000 + 86_400_000).reduce(
        (sum, row) => sum + row.files,
        0,
      )
    })
    console.log(`[perf] ${JSON.stringify({ ageMs: ms })}`)
    expect(files).toBe(PERF_LIMITS.files)
    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxSideViewMs)
  }, 60_000)
})

describe('export (1M files)', () => {
  const exportMs = async (format: 'csv' | 'xlsx') => {
    const store = sharedStore()
    const dir = mkdtempSync(path.join(os.tmpdir(), 'storageiq-perf-export-'))
    try {
      const file = path.join(dir, `tree.${format}`)
      const started = performance.now()
      const summary = await exportTree(store, new SideViews(store), 'd0', format, file)
      const ms = performance.now() - started
      const mb = statSync(file).size / 1024 / 1024
      console.log(
        `[perf] ${JSON.stringify({ [`${format}ExportMs`]: ms, [`${format}ExportMb`]: mb })}`,
      )
      return { summary, ms }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  // The tree has 1M files and 10,100 folders; Excel's sheet holds 1,048,575 data rows, so it fits.
  const ROWS = PERF_LIMITS.files + 100 + 10_000

  it('writes every row to a CSV inside the limit', async () => {
    const { summary, ms } = await exportMs('csv')
    expect(summary).toEqual({ rows: ROWS, truncated: false })
    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxCsvExportMs)
  }, 120_000)

  it('writes every row to an Excel workbook inside the limit', async () => {
    const { summary, ms } = await exportMs('xlsx')
    expect(summary).toEqual({ rows: ROWS, truncated: false })
    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxXlsxExportMs)
  }, 120_000)
})

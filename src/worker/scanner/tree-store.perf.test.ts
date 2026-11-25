import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
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

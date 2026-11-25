import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { walk, type WalkSink } from './walk'
import { createWalkerPool, type WalkerPort } from './walker-pool'
import { createWinFindLister } from './win-find'

/**
 * Real worker threads. The worker is TypeScript, so a worker bundle is built once into
 * node_modules/.cache (inside the repo, so `require('koffi')` resolves) with the same bundler the
 * app uses; the walk then runs on `walker.js` exactly like the packaged app runs `out/main/walker.js`.
 */
const isWindows = process.platform === 'win32'
const cacheDir = path.resolve('node_modules', '.cache', 'storageiq-walker-test')
const script = path.join(cacheDir, 'walker.js')
const poolDir = path.resolve('node_modules', '.cache', 'storageiq-walker-pool-test')

/**
 * Runs in a child process: many tiny walks over a real pool. A tiny tree is finished by the first
 * ready worker while the others are still loading koffi, which is exactly when the pool used to
 * terminate a thread inside koffi's native init and abort the whole process.
 */
const stressChild = `
const { Worker } = require('node:worker_threads')
const { createWalkerPool } = require(process.argv[2])
const script = process.argv[3]
const root = process.argv[4]
const sink = { folder: () => 0, file: () => undefined, error: () => undefined, visiting: () => undefined }
const pool = createWalkerPool({
  walkers: 7,
  createPort: (index, abortFlag) => new Worker(script, { workerData: { abortFlag, index } }),
})
;(async () => {
  for (let i = 0; i < 40; i += 1) {
    await pool.walk(root, 0, sink, new AbortController().signal)
  }
  console.log('walks-done')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
`

type Row = [string, number]

function record() {
  const paths = new Map<number, string>([[0, '']])
  let next = 1
  let calls = 0
  const rows: Row[] = []
  const totals = { files: 0, folders: 0, bytes: 0 }
  const sink: WalkSink<number> = {
    folder(parent, name) {
      calls += 1
      const handle = next
      next += 1
      const full = path.join(paths.get(parent) ?? '', name)
      paths.set(handle, full)
      rows.push([full, -1])
      totals.folders += 1
      return handle
    },
    file(parent, bytes, name) {
      calls += 1
      rows.push([path.join(paths.get(parent) ?? '', name), bytes])
      totals.files += 1
      totals.bytes += bytes
    },
    error() {
      calls += 1
    },
    visiting() {},
  }
  return {
    sink,
    totals,
    calls: () => calls,
    sorted: () => [...rows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    setRoot: (root: string) => paths.set(0, root),
  }
}

describe.runIf(isWindows)('the real walker pool', () => {
  let base: string
  let live = 0

  const createPort = (index: number, abortFlag: SharedArrayBuffer): WalkerPort => {
    const worker = new Worker(script, { workerData: { abortFlag, index } })
    live += 1
    worker.on('exit', () => {
      live -= 1
    })
    return worker
  }

  beforeAll(async () => {
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@shared': path.resolve('src/shared') } },
      build: {
        ssr: path.resolve('src/worker/scanner/walker-worker.ts'),
        outDir: cacheDir,
        emptyOutDir: true,
        minify: false,
        rolldownOptions: { output: { format: 'cjs', entryFileNames: 'walker.js' } },
      },
    })
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@shared': path.resolve('src/shared') } },
      build: {
        ssr: path.resolve('src/worker/scanner/walker-pool.ts'),
        outDir: poolDir,
        emptyOutDir: true,
        minify: false,
        rolldownOptions: { output: { format: 'cjs', entryFileNames: 'walker-pool.js' } },
      },
    })
    base = mkdtempSync(path.join(os.tmpdir(), 'storageiq-pool-'))
    for (let a = 0; a < 5; a += 1) {
      for (let b = 0; b < 8; b += 1) {
        for (let c = 0; c < 4; c += 1) {
          const folder = path.join(base, `a${a}`, `b${b}`, `c${c}`)
          mkdirSync(folder, { recursive: true })
          const files = 2000 / 160
          for (let f = 0; f < files; f += 1) {
            writeFileSync(path.join(folder, `file${f}.txt`), 'x'.repeat((a + b + c + f) % 40))
          }
        }
      }
    }
    mkdirSync(path.join(base, 'empty'))
    const target = path.join(base, 'a0', 'b0')
    try {
      symlinkSync(target, path.join(base, 'junction'), 'junction')
    } catch {
      // creating a junction was refused: the comparison still holds without one
    }
  }, 120_000)

  afterAll(() => {
    if (base !== undefined) rmSync(base, { recursive: true, force: true })
    rmSync(cacheDir, { recursive: true, force: true })
    rmSync(poolDir, { recursive: true, force: true })
  })

  it('40 tiny walks in a row end with exit code 0 (no thread is terminated inside koffi init)', () => {
    const tiny = mkdtempSync(path.join(os.tmpdir(), 'storageiq-tiny-'))
    try {
      for (const name of ['one', 'two', 'three']) {
        mkdirSync(path.join(tiny, name))
        writeFileSync(path.join(tiny, name, 'f.txt'), 'x')
      }
      const childScript = path.join(poolDir, 'stress-child.js')
      writeFileSync(childScript, stressChild)
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = spawnSync(
        process.execPath,
        [childScript, path.join(poolDir, 'walker-pool.js'), script, tiny],
        { encoding: 'utf8', timeout: 100_000, env },
      )
      expect(result.stderr).not.toMatch(/FATAL ERROR/)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('walks-done')
    } finally {
      rmSync(tiny, { recursive: true, force: true })
    }
  }, 110_000)

  it('the real pool matches the single-thread walk on a temp tree', async () => {
    const lister = await createWinFindLister()
    const reference = record()
    reference.setRoot(base)
    await walk(base, 0, reference.sink, { lister, signal: new AbortController().signal })
    expect(reference.totals.folders).toBeGreaterThanOrEqual(200)
    expect(reference.totals.files).toBeGreaterThanOrEqual(2000)

    const run = record()
    run.setRoot(base)
    const pool = createWalkerPool({ walkers: 4, createPort })
    const result = await pool.walk(base, 0, run.sink, new AbortController().signal)

    expect(result.walkers).toBe(4)
    expect(run.totals).toEqual(reference.totals)
    expect(run.sorted()).toEqual(reference.sorted())
  }, 60_000)

  it('aborting a real pool walk leaves no worker running', async () => {
    const controller = new AbortController()
    const run = record()
    run.setRoot(base)
    const counting: WalkSink<number> = {
      ...run.sink,
      folder: (parent, name, modifiedMs) => {
        controller.abort()
        return run.sink.folder(parent, name, modifiedMs)
      },
    }
    const pool = createWalkerPool({ walkers: 4, createPort })
    await pool.walk(base, 0, counting, controller.signal)
    const callsAtEnd = run.calls()
    // A worker that was still loading koffi is not terminated: it gets `exit` and closes by
    // itself once it has loaded, so give those a moment.
    const deadline = Date.now() + 10_000
    while (live > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    expect(live).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(run.calls()).toBe(callsAtEnd)
  }, 60_000)
})

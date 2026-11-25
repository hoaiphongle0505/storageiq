import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { plainMenuLabel } from './menu-commands'
import { createShellWorkerPool, type ShellWorkerPool, type WorkerLike } from './shell-worker-pool'
import { FALLBACK_RECYCLE_VERB, SHELL_WORKER_TEST_DATA } from './shell-worker-protocol'

/**
 * Native tests of the shell worker thread (Windows only). Everything is created under
 * `os.tmpdir()/storageiq-t11-<random>` and only that folder is ever deleted by the tests'
 * cleanup. The Explorer menu is never shown: the tests drive the worker through its test entries
 * (`invoke-verb` runs a verb on a menu built with the same routing as a real request, `probe`
 * lists a menu's labels). The tests recycle files, so the user's Recycle Bin receives them; the
 * tests never remove anything from the bin.
 */
const onWindows = process.platform === 'win32'

const bundleDir = path.resolve('out', 'test-shell-worker')
let workRoot = ''
let pool: ShellWorkerPool

/** Builds the worker the way electron.vite.config.ts does (self-contained CJS, koffi external). */
async function buildWorkerBundle(): Promise<string> {
  await build({
    configFile: false,
    logLevel: 'warn',
    resolve: { alias: { '@shared': path.resolve('src/shared') } },
    build: {
      ssr: path.resolve('src/main/shell-menu/shell-worker.ts'),
      outDir: bundleDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: 'shell-worker.js' } },
    },
  })
  return path.join(bundleDir, 'shell-worker.js')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function makeFiles(folder: string, count: number): void {
  mkdirSync(folder, { recursive: true })
  const body = Buffer.alloc(16, 65)
  for (let i = 0; i < count; i += 1) {
    writeFileSync(path.join(folder, `f${String(i).padStart(5, '0')}.txt`), body)
  }
}

function makeFile(...segments: string[]): string {
  const file = path.join(workRoot, ...segments)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, 'x')
  return file
}

/** Original paths of the items in the user's Recycle Bin (`$I` records) under `prefix`. */
function recycledUnder(prefix: string): string[] | null {
  const drive = path.parse(prefix).root
  const bin = path.join(drive, '$RECYCLE.BIN')
  if (!existsSync(bin)) return null // this drive has no Recycle Bin: skip the bin assertions
  let sid: string
  try {
    // The system copy by full path: a Git for Windows `whoami` earlier on PATH rejects /user.
    const whoami = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'whoami.exe')
    sid = execFileSync(whoami, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
      .split(',')[1]!
      .replace(/[\r\n"]/g, '')
  } catch {
    return null
  }
  let names: string[]
  try {
    names = readdirSync(path.join(bin, sid))
  } catch {
    return null
  }
  const found: string[] = []
  for (const name of names) {
    if (!name.startsWith('$I')) continue
    try {
      const record = readFileSync(path.join(bin, sid, name))
      const length = Number(record.readUInt32LE(24))
      const original = record
        .subarray(28, 28 + length * 2)
        .toString('utf16le')
        .replace(/\0.*$/, '')
      if (original.toLowerCase().startsWith(prefix.toLowerCase())) found.push(original)
    } catch {
      // a record that cannot be read is not ours to judge
    }
  }
  return found
}

describe.skipIf(!onWindows)('the shell worker thread (native)', () => {
  beforeAll(async () => {
    const script = await buildWorkerBundle()
    // The long form of the path: os.tmpdir() can be an 8.3 short name (C:\Users\RUNNER~1\…) on
    // CI, while the Recycle Bin records the long original path the shell resolved.
    workRoot = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'storageiq-t11-')))
    pool = createShellWorkerPool({
      spawn: () =>
        new Worker(script, { workerData: SHELL_WORKER_TEST_DATA }) as unknown as WorkerLike,
      maxWorkers: 3,
      idleMs: 30_000,
      schedule: (callback, ms) => {
        const timer = setTimeout(callback, ms)
        timer.unref()
        return () => clearTimeout(timer)
      },
    })
  }, 120_000)

  afterAll(() => {
    pool?.dispose()
    // Only the folder this file created.
    if (workRoot.includes('storageiq-t11-')) rmSync(workRoot, { recursive: true, force: true })
    rmSync(bundleDir, { recursive: true, force: true })
  })

  it('delete on one temp file recycles it', async () => {
    const file = makeFile('one', 'only.txt')
    await expect(pool.invokeVerb([file], 'delete')).resolves.toEqual({ ok: true })
    expect(existsSync(file)).toBe(false)
    const bin = recycledUnder(path.join(workRoot, 'one'))
    if (bin !== null) expect(bin).toContain(file)
  }, 60_000)

  it('delete on three temp files in one folder recycles all three', async () => {
    const files = ['a.txt', 'b.txt', 'c.txt'].map((name) => makeFile('three', name))
    await expect(pool.invokeVerb(files, 'delete')).resolves.toEqual({ ok: true })
    expect(files.map((file) => existsSync(file))).toEqual([false, false, false])
    const bin = recycledUnder(path.join(workRoot, 'three'))
    if (bin !== null) expect(bin.sort()).toEqual([...files].sort())
  }, 60_000)

  it('delete on files in two folders recycles all and leaves a sibling file untouched', async () => {
    const a = makeFile('two', 'left', 'a.txt')
    const sibling = makeFile('two', 'left', 'keep.txt')
    const b = makeFile('two', 'right', 'b.txt')
    await expect(pool.invokeVerb([a, b], 'delete')).resolves.toEqual({ ok: true })
    expect(existsSync(a)).toBe(false)
    expect(existsSync(b)).toBe(false)
    expect(existsSync(sibling)).toBe(true)
    const bin = recycledUnder(path.join(workRoot, 'two'))
    if (bin !== null) expect(bin.sort()).toEqual([a, b].sort())
  }, 60_000)

  it('delete on a folder and a file in different parents recycles both', async () => {
    const inner = makeFile('mixed', 'folder', 'inner.txt')
    const folder = path.dirname(inner)
    const loose = makeFile('mixed-other', 'loose.txt')
    await expect(pool.invokeVerb([folder, loose], 'delete')).resolves.toEqual({ ok: true })
    expect(existsSync(folder)).toBe(false)
    expect(existsSync(loose)).toBe(false)
  }, 60_000)

  it('the menu for files in different folders lists Delete and Properties', async () => {
    const a = makeFile('menu', 'x', 'a.txt')
    const b = makeFile('menu', 'y', 'b.txt')
    const labels = (await pool.probe([a, b])).map(plainMenuLabel)
    expect(labels).toContain('Delete')
    expect(labels).toContain('Properties')
    // StorageIQ's own submenu comes first, then the shell's items.
    expect(labels[0]).toBe('StorageIQ')
    // One folder gives the full menu, which is at least as long as the reduced one.
    const same = (await pool.probe([a, makeFile('menu', 'x', 'c.txt')])).map(plainMenuLabel)
    expect(same.length).toBeGreaterThanOrEqual(labels.length)
  }, 60_000)

  it('does not block the event loop: a 20 ms timer on the main thread never has a gap over 250 ms while 3000 temp files are deleted in a worker', async () => {
    const folder = path.join(workRoot, 'big')
    makeFiles(folder, 3000)
    let last = performance.now()
    let maxGap = 0
    const timer = setInterval(() => {
      const now = performance.now()
      maxGap = Math.max(maxGap, now - last)
      last = now
    }, 20)
    const started = performance.now()
    let finish
    try {
      last = performance.now()
      finish = await pool.invokeVerb([folder], 'delete')
    } finally {
      clearInterval(timer)
    }
    const seconds = (performance.now() - started) / 1000
    process.stdout.write(
      `[native] 3000-file delete took ${seconds.toFixed(1)} s, max timer gap ${Math.round(maxGap)} ms\n`,
    )
    expect(finish).toEqual({ ok: true })
    expect(existsSync(folder)).toBe(false)
    // The old synchronous call produced a 4400 ms gap in the spike.
    expect(maxGap).toBeLessThanOrEqual(250)
  }, 120_000)

  it('a second delete can be started while the first runs', async () => {
    const first = path.join(workRoot, 'run-a')
    const second = path.join(workRoot, 'run-b')
    makeFiles(first, 1500)
    makeFiles(second, 1500)
    let firstDone = false
    const one = pool.invokeVerb([first], 'delete').then((result) => {
      firstDone = true
      return result
    })
    // Give the first worker a moment to be well into its operation.
    await sleep(300)
    expect(firstDone).toBe(false)
    const two = pool.invokeVerb([second], 'delete')
    // Two workers are busy at the same time.
    expect(pool.size).toBe(2)
    expect(firstDone).toBe(false)
    await expect(Promise.all([one, two])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(existsSync(first)).toBe(false)
    expect(existsSync(second)).toBe(false)
  }, 120_000)

  it('the fallback IFileOperation delete recycles items in two folders', async () => {
    const a = makeFile('fallback', 'p', 'a.txt')
    const b = makeFile('fallback', 'q', 'b.txt')
    await expect(pool.invokeVerb([a, b], FALLBACK_RECYCLE_VERB)).resolves.toEqual({ ok: true })
    expect(existsSync(a)).toBe(false)
    expect(existsSync(b)).toBe(false)
    const bin = recycledUnder(path.join(workRoot, 'fallback'))
    if (bin !== null) expect(bin.sort()).toEqual([a, b].sort())
  }, 60_000)

  it('hideDestructive removes delete, cut and rename of a real shell menu', async () => {
    const file = makeFile('hide', 'f.txt')
    const shown = (await pool.probe([file], false)).map(plainMenuLabel)
    expect(shown).toContain('Delete')
    const hidden = (await pool.probe([file], true)).map(plainMenuLabel)
    expect(hidden).not.toContain('Delete')
    expect(hidden).not.toContain('Cut')
    expect(hidden).not.toContain('Rename')
    expect(hidden).toContain('Properties')
  }, 60_000)

  it('the root of a drive hides delete, cut and rename', async () => {
    // Nothing is ever invoked on the drive root: the menu is only built and listed.
    const root = `${path.parse(workRoot).root}`
    const labels = (await pool.probe([root], true)).map(plainMenuLabel)
    expect(labels).not.toContain('Delete')
    expect(labels).not.toContain('Cut')
    expect(labels).not.toContain('Rename')
    expect(labels.length).toBeGreaterThan(3)
  }, 60_000)
})

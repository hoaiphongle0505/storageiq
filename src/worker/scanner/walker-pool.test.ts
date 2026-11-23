import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScanErrorKind } from '@shared/scan-types'
import { createFakeWalkFs, dir, type FakeNode, file, link } from './test/fake-walk-fs'
import { FakeWalkerPort, type FakeWalkerPortOptions } from './test/fake-walker-port'
import { walk, type WalkSink } from './walk'
import {
  ABORT_GRACE_MS,
  createWalkerPool,
  walkerCount,
  walkerCountFromEnv,
  WalkerStartupError,
} from './walker-pool'

const ROOT = 'C:\\Data'

interface Recorded {
  sink: WalkSink<number>
  rows: Array<[string, string, number, number]>
  errors: Array<[string, string, ScanErrorKind]>
  totals: { files: number; folders: number; bytes: number }
  calls: () => number
}

/** A sink that rebuilds full paths from the handles it hands out (ids differ between walks). */
function record(
  onCall?: (kind: 'file' | 'folder', calls: number) => void,
  throwAt?: number,
): Recorded {
  const paths = new Map<number, string>([[0, ROOT]])
  let next = 1
  let calls = 0
  const rows: Recorded['rows'] = []
  const errors: Recorded['errors'] = []
  const totals = { files: 0, folders: 0, bytes: 0 }
  const sink: WalkSink<number> = {
    folder(parent, name, modifiedMs) {
      calls += 1
      const full = path.join(paths.get(parent) ?? '?', name)
      const handle = next
      next += 1
      paths.set(handle, full)
      rows.push([full, 'folder', 0, modifiedMs])
      totals.folders += 1
      onCall?.('folder', calls)
      return handle
    },
    file(parent, bytes, name, modifiedMs) {
      calls += 1
      if (throwAt !== undefined && calls >= throwAt) throw new Error('sink broke')
      rows.push([path.join(paths.get(parent) ?? '?', name), 'file', bytes, modifiedMs])
      totals.files += 1
      totals.bytes += bytes
      onCall?.('file', calls)
    },
    error(errorPath, code, kind) {
      calls += 1
      errors.push([errorPath, code, kind])
    },
    visiting() {},
  }
  return { sink, rows, errors, totals, calls: () => calls }
}

const sorted = (rows: Recorded['rows']) =>
  [...rows].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

/** About 300 folders, 8 levels deep, thousands of files, links and unreadable folders. */
function bigTree(): {
  root: FakeNode
  listErrors: Record<string, string>
  partialErrors: Record<string, string>
} {
  const listErrors: Record<string, string> = {}
  const partialErrors: Record<string, string> = {}
  let counter = 0
  const make = (here: string, depth: number): FakeNode => {
    counter += 1
    const id = counter
    const children: Record<string, FakeNode> = {}
    const fileCount = (id * 7) % 31
    for (let i = 0; i < fileCount; i += 1) {
      children[`file${i}.dat`] = file(((id + i) * 977) % 100_000, 1000 + id * 10 + i)
    }
    if (id % 9 === 0) {
      children['junction'] = link(true)
      children['alias.bin'] = link(false)
    }
    const fan = depth === 0 ? 4 : depth < 3 ? 3 : depth < 8 ? (id % 3 === 0 ? 2 : 1) : 0
    for (let i = 0; i < fan; i += 1) {
      const name = `d${depth}_${i}`
      const child = path.join(here, name)
      if (id % 17 === 5 && i === 0) listErrors[child] = 'EACCES'
      if (id % 23 === 7 && i === 1) partialErrors[child] = 'ENOENT'
      children[name] = make(child, depth + 1)
    }
    return dir(children, 5000 + id)
  }
  return { root: make(ROOT, 0), listErrors, partialErrors }
}

function poolOf(
  tree: ReturnType<typeof bigTree> | { root: FakeNode },
  walkers: number,
  options: (index: number) => FakeWalkerPortOptions = () => ({}),
) {
  const fs = createFakeWalkFs(ROOT, tree.root, {
    listErrors: 'listErrors' in tree ? tree.listErrors : {},
    partialErrors: 'partialErrors' in tree ? tree.partialErrors : {},
  })
  const ports: FakeWalkerPort[] = []
  const flags: SharedArrayBuffer[] = []
  const pool = createWalkerPool({
    walkers,
    createPort: (index, flag) => {
      const port = new FakeWalkerPort(fs.syncLister(), flag, options(index))
      ports.push(port)
      flags.push(flag)
      return port
    },
  })
  return { pool, ports, flags }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('walkerCount', () => {
  it('walkerCount clamps to 2..8', () => {
    const table: Array<[number, number]> = [
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 3],
      [8, 7],
      [9, 8],
      [64, 8],
    ]
    for (const [parallelism, expected] of table) expect(walkerCount(parallelism)).toBe(expected)
  })

  it('walkerCountFromEnv accepts 1 to 8 and ignores anything else', () => {
    expect(walkerCountFromEnv('1', 5)).toBe(1)
    expect(walkerCountFromEnv('4', 5)).toBe(4)
    for (const bad of ['0', '9', 'abc', '', '4x', undefined]) {
      expect(walkerCountFromEnv(bad, 5)).toBe(5)
    }
  })

  it('walkerCountFromEnv ignores the override in a packaged app', () => {
    expect(walkerCountFromEnv('1', 5, true)).toBe(5)
    expect(walkerCountFromEnv('4', 5, true)).toBe(5)
    expect(walkerCountFromEnv('4', 5, false)).toBe(4)
  })
})

describe('the walker pool', () => {
  it('a pool walk gives the same tree as the single-thread walk', async () => {
    const tree = bigTree()
    const fs = createFakeWalkFs(ROOT, tree.root, tree)
    const reference = record()
    await walk(ROOT, 0, reference.sink, { lister: fs, signal: new AbortController().signal })
    expect(reference.rows.length).toBeGreaterThan(3000)
    expect(reference.totals.folders).toBeGreaterThan(200)
    expect(reference.errors.length).toBeGreaterThan(0)

    for (const walkers of [1, 3, 8]) {
      const run = record()
      const { pool } = poolOf(tree, walkers)
      const result = await pool.walk(ROOT, 0, run.sink, new AbortController().signal)
      expect(result.walkers).toBe(walkers)
      expect(sorted(run.rows)).toEqual(sorted(reference.rows))
      expect([...run.errors].sort()).toEqual([...reference.errors].sort())
      expect(run.totals).toEqual(reference.totals)
    }
  })

  it('batches arriving out of order map nested folders to the right parents', async () => {
    const tree = bigTree()
    const reference = record()
    const fs = createFakeWalkFs(ROOT, tree.root, tree)
    await walk(ROOT, 0, reference.sink, { lister: fs, signal: new AbortController().signal })

    const run = record()
    const { pool } = poolOf(tree, 3, () => ({ replyDelayMs: (jobId) => (jobId * 7) % 5 }))
    await pool.walk(ROOT, 0, run.sink, new AbortController().signal)
    expect(sorted(run.rows)).toEqual(sorted(reference.rows))
    expect(run.totals).toEqual(reference.totals)
  })

  it('all workers are used and idle workers pick up pending folders', async () => {
    const children: Record<string, FakeNode> = {}
    for (let i = 0; i < 500; i += 1) children[`sub${i}`] = dir({ 'f.txt': file(i) })
    const { pool, ports } = poolOf({ root: dir(children) }, 8)
    const run = record()
    await pool.walk(ROOT, 0, run.sink, new AbortController().signal)
    expect(run.totals.files).toBe(500)
    for (const port of ports) expect(port.jobsSeen).toBeGreaterThanOrEqual(1)
    expect(ports[0]?.firstJobPending).toBeGreaterThan(0)
  })

  it('a worker crash fails the walk and terminates every port', async () => {
    const { pool, ports } = poolOf(bigTree(), 3, (index) => (index < 2 ? { crashOnJob: 2 } : {}))
    await expect(pool.walk(ROOT, 0, record().sink, new AbortController().signal)).rejects.toThrow(
      /^The disk reader stopped unexpectedly/,
    )
    for (const port of ports) expect(port.terminated).toBeGreaterThanOrEqual(1)
  }, 2000)

  it('startup failure on every port rejects with WalkerStartupError and dispatches nothing', async () => {
    const { pool, ports } = poolOf(bigTree(), 3, () => ({ startupFails: true }))
    const failure = pool.walk(ROOT, 0, record().sink, new AbortController().signal)
    await expect(failure).rejects.toBeInstanceOf(WalkerStartupError)
    for (const port of ports) {
      expect(port.jobsSeen).toBe(0)
      expect(port.terminated).toBeGreaterThanOrEqual(1)
    }
  })

  it('one worker failing at startup leaves a smaller pool with the same totals', async () => {
    const tree = bigTree()
    const reference = record()
    const fs = createFakeWalkFs(ROOT, tree.root, tree)
    await walk(ROOT, 0, reference.sink, { lister: fs, signal: new AbortController().signal })

    const run = record()
    const { pool, ports } = poolOf(tree, 4, (index) => (index === 1 ? { startupFails: true } : {}))
    const result = await pool.walk(ROOT, 0, run.sink, new AbortController().signal)
    expect(result.walkers).toBe(3)
    expect(ports[1]?.jobsSeen).toBe(0)
    expect(sorted(run.rows)).toEqual(sorted(reference.rows))
    expect(run.totals).toEqual(reference.totals)
    for (const port of ports) expect(port.terminated).toBeGreaterThanOrEqual(1)
  })

  it('an abort while workers are mid-batch stops all sink calls and exits all workers', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const run = record((kind, calls) => {
      if (kind === 'file' && calls >= 10) controller.abort()
    })
    const { pool, ports, flags } = poolOf(bigTree(), 4, () => ({ replyDelayMs: () => 5 }))
    const walking = pool.walk(ROOT, 0, run.sink, controller.signal)
    await vi.advanceTimersByTimeAsync(1000)
    await walking
    const callsAtEnd = run.calls()
    await vi.advanceTimersByTimeAsync(100)
    expect(run.calls()).toBe(callsAtEnd)
    expect(callsAtEnd).toBeLessThan(200)
    for (const flag of flags) expect(Atomics.load(new Int32Array(flag), 0)).toBe(1)
    for (const port of ports) expect(port.terminated).toBeGreaterThanOrEqual(1)
  })

  it('an abort with a worker that never replies resolves after ABORT_GRACE_MS', async () => {
    vi.useFakeTimers()
    const children: Record<string, FakeNode> = {}
    for (let i = 0; i < 200; i += 1) children[`d${i}`] = dir({ 'f.txt': file(1) })
    const controller = new AbortController()
    const { pool, ports } = poolOf({ root: dir(children) }, 2, (index) =>
      index === 1 ? { neverReply: true } : {},
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let settled = false
    const walking = pool.walk(ROOT, 0, record().sink, controller.signal).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(ports[1]?.jobsSeen).toBeGreaterThan(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(ABORT_GRACE_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await walking
    expect(settled).toBe(true)
    expect(ports[1]?.terminated).toBeGreaterThanOrEqual(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a rejecting sink rejects the walk and stops the workers', async () => {
    const { pool, ports } = poolOf(bigTree(), 3)
    await expect(
      pool.walk(ROOT, 0, record(undefined, 50).sink, new AbortController().signal),
    ).rejects.toThrow('sink broke')
    for (const port of ports) expect(port.terminated).toBeGreaterThanOrEqual(1)
  })

  it('a signal that is already aborted starts no job', async () => {
    const controller = new AbortController()
    controller.abort()
    const { pool, ports } = poolOf(bigTree(), 3)
    const run = record()
    await pool.walk(ROOT, 0, run.sink, controller.signal)
    expect(run.calls()).toBe(0)
    for (const port of ports) {
      expect(port.jobsSeen).toBe(0)
      expect(port.terminated).toBeGreaterThanOrEqual(1)
    }
  })
})

// Walk benchmark: the koffi FindFirstFileExW walk (async opens on one thread, or a pool of worker
// threads) against the old opendir + lstat walk.
//
//   node scripts/bench-walk.mjs <dir> [--async] [--pool N] [--legacy] [--async-next] [--concurrency N]
//
// Without flags it runs each variant once and prints one line per variant: `async` (the single
// thread walk, up to 8 opens in flight), then `pool 1`, `pool 2`, `pool 4`, `pool 8` (N worker
// threads, each doing synchronous listings; the main thread plays the single writer). `--async`,
// `--pool N` and `--legacy` run only that variant; `--concurrency N` sets the opens in flight of
// `--async` (default 8); `--async-next` reads every FindNextFileW through koffi's async call.
//
// Plain Node ESM, no build step, so it keeps its own small copies of the listers and of the batch
// idea (workers return parallel arrays plus one names string; the main thread pushes every name
// into an array and bumps counters, which approximates the writer-side cost). It reads folders
// only and is not run in CI. The first run on a folder warms the file cache, so run each twice
// and compare the second figures.
import { createRequire } from 'node:module'
import { opendir, lstat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'

const require = createRequire(import.meta.url)

const args = isMainThread ? process.argv.slice(2) : []
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : Number(args[at + 1])
}
const valueFlags = ['--concurrency', '--pool']
const positional = args.filter(
  (arg, i) => !arg.startsWith('--') && !valueFlags.includes(args[i - 1]),
)
const root = positional[0]
if (isMainThread && root === undefined) {
  console.error(
    'usage: node scripts/bench-walk.mjs <dir> [--async] [--pool N] [--legacy] [--async-next] [--concurrency N]',
  )
  process.exit(2)
}

const IO_REPARSE_TAG_SYMLINK = 0xa000000c
const IO_REPARSE_TAG_MOUNT_POINT = 0xa0000003

/** `\\?\` form, so the walk reads exactly what the app reads (no 260 limit, no trimming). */
function pattern(dir) {
  const clean = dir.replace(/\//g, '\\')
  const p = clean.endsWith('\\') ? `${clean}*` : `${clean}\\*`
  return /^[A-Za-z]:\\/.test(p) ? `\\\\?\\${p}` : p
}

function bindKernel() {
  const koffi = require('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const fileTime = koffi.struct('BENCH_FILETIME', { low: 'uint32_t', high: 'uint32_t' })
  koffi.struct('BENCH_FIND_DATAW', {
    dwFileAttributes: 'uint32_t',
    ftCreationTime: fileTime,
    ftLastAccessTime: fileTime,
    ftLastWriteTime: fileTime,
    nFileSizeHigh: 'uint32_t',
    nFileSizeLow: 'uint32_t',
    dwReserved0: 'uint32_t',
    dwReserved1: 'uint32_t',
    cFileName: koffi.array('char16_t', 260, 'String'),
    cAlternateFileName: koffi.array('char16_t', 14, 'String'),
  })
  return {
    findFirst: kernel32.func(
      'intptr_t __stdcall FindFirstFileExW(const char16_t *p, int lvl, _Out_ BENCH_FIND_DATAW *d, int op, void *f, uint32_t fl)',
    ),
    findNext: kernel32.func('int __stdcall FindNextFileW(intptr_t h, _Out_ BENCH_FIND_DATAW *d)'),
    findClose: kernel32.func('int __stdcall FindClose(intptr_t h)'),
  }
}

const isLinkOf = (d) =>
  (d.dwFileAttributes & 0x400) !== 0 &&
  (d.dwReserved0 === IO_REPARSE_TAG_SYMLINK || d.dwReserved0 === IO_REPARSE_TAG_MOUNT_POINT)

function createFindLister(useAsyncNext) {
  const { findFirst, findNext, findClose } = bindKernel()
  const call = (fn, ...fnArgs) =>
    new Promise((resolve, reject) => {
      fn.async(...fnArgs, (error, result) => (error ? reject(error) : resolve(result)))
    })
  const entryOf = (d) => {
    if (d.cFileName === '.' || d.cFileName === '..') return null
    const isDirectory = (d.dwFileAttributes & 0x10) !== 0
    return { name: d.cFileName, isDirectory, isLink: isLinkOf(d) }
  }
  return async (dir) => {
    const data = {}
    const handle = await call(findFirst, pattern(dir), 1, data, 0, null, 2)
    if (Number(handle) === -1) return []
    const entries = []
    try {
      const first = entryOf(data)
      if (first) entries.push(first)
      for (;;) {
        const more = useAsyncNext ? await call(findNext, handle, data) : findNext(handle, data)
        if (more === 0) break
        const entry = entryOf(data)
        if (entry) entries.push(entry)
      }
    } finally {
      findClose(handle)
    }
    return entries
  }
}

/** Synchronous listing (what a pool worker does): the open blocks this thread. */
function createSyncFindLister() {
  const { findFirst, findNext, findClose } = bindKernel()
  return (dir, visit) => {
    const data = {}
    const handle = findFirst(pattern(dir), 1, data, 0, null, 2)
    if (Number(handle) === -1) return
    try {
      let more = true
      while (more) {
        const name = data.cFileName
        if (name !== '.' && name !== '..') {
          const isDirectory = (data.dwFileAttributes & 0x10) !== 0
          visit(name, isDirectory && !isLinkOf(data))
        }
        more = findNext(handle, data) !== 0
      }
    } finally {
      findClose(handle)
    }
  }
}

const JOB_ENTRIES = 2000
const JOB_DIRECTORIES = 64
const SEPARATOR = '\u0000'

if (!isMainThread) {
  // Pool worker: one job = a depth-first walk with the same budget as the app's walker job.
  const listSync = createSyncFindLister()
  parentPort.on('message', (dir) => {
    const stack = [dir]
    const kinds = []
    const names = []
    let listed = 0
    while (
      stack.length > 0 &&
      listed < JOB_DIRECTORIES &&
      (listed === 0 || kinds.length < JOB_ENTRIES)
    ) {
      const here = stack.pop()
      listed += 1
      listSync(here, (name, isFolder) => {
        kinds.push(isFolder ? 1 : 0)
        names.push(name)
        if (isFolder) stack.push(path.join(here, name))
      })
    }
    parentPort.postMessage({ kinds, names: names.join(SEPARATOR), pending: stack })
  })
  parentPort.postMessage('ready')
}

async function legacyList(dir) {
  const entries = []
  let handle
  try {
    handle = await opendir(dir, { bufferSize: 128 })
  } catch {
    return entries
  }
  const names = []
  try {
    for await (const dirent of handle) names.push(dirent.name)
  } catch {
    // keep what was read
  }
  for (let i = 0; i < names.length; i += 64) {
    const batch = names.slice(i, i + 64)
    const stats = await Promise.all(
      batch.map((name) =>
        lstat(path.join(dir, name)).then(
          (s) => ({ name, s }),
          () => null,
        ),
      ),
    )
    for (const item of stats) {
      if (item === null) continue
      const isLink = item.s.isSymbolicLink()
      entries.push({ name: item.name, isDirectory: !isLink && item.s.isDirectory(), isLink })
    }
  }
  return entries
}

async function run(list, concurrency) {
  const started = performance.now()
  let files = 0
  let folders = 0
  const queue = [root]
  let inFlight = 0
  await new Promise((resolve, reject) => {
    const pump = () => {
      while (inFlight < concurrency && queue.length > 0) {
        const dir = queue.pop()
        inFlight += 1
        list(dir).then((entries) => {
          for (const entry of entries) {
            if (entry.isLink) files += 1
            else if (entry.isDirectory) {
              folders += 1
              queue.push(path.join(dir, entry.name))
            } else files += 1
          }
          inFlight -= 1
          pump()
        }, reject)
      }
      if (inFlight === 0 && queue.length === 0) resolve()
    }
    pump()
  })
  const seconds = (performance.now() - started) / 1000
  return { files, folders, seconds, rate: Math.round(files / seconds) }
}

async function runPool(count) {
  const started = performance.now()
  let files = 0
  let folders = 0
  const all = [] // the coordinator keeps every name, like the tree store does
  const queue = [root]
  const workers = Array.from({ length: count }, () => new Worker(new URL(import.meta.url)))
  await new Promise((resolve, reject) => {
    let busy = 0
    const idle = []
    const feed = () => {
      while (idle.length > 0 && queue.length > 0) {
        busy += 1
        idle.pop().postMessage(queue.pop())
      }
      if (busy === 0 && queue.length === 0 && idle.length === count) resolve()
    }
    for (const worker of workers) {
      worker.on('error', reject)
      worker.on('message', (message) => {
        if (message === 'ready') {
          idle.push(worker)
        } else {
          busy -= 1
          idle.push(worker)
          const names = message.names === '' ? [] : message.names.split(SEPARATOR)
          for (let i = 0; i < message.kinds.length; i += 1) {
            all.push(names[i])
            if (message.kinds[i] === 1) folders += 1
            else files += 1
          }
          for (const pending of message.pending) queue.push(pending)
        }
        feed()
      })
    }
  })
  const seconds = (performance.now() - started) / 1000
  await Promise.all(workers.map((worker) => worker.terminate()))
  return { files, folders, seconds, rate: Math.round(files / seconds) }
}

function print(label, result) {
  console.log(
    `${label}: files=${result.files} folders=${result.folders} seconds=${result.seconds.toFixed(2)} files/s=${result.rate}`,
  )
}

if (isMainThread) {
  const concurrency = option('--concurrency', 8)
  console.log(`logical cores (os.availableParallelism): ${os.availableParallelism()}`)
  if (flag('--legacy')) {
    print('legacy', await run(legacyList, 16))
  } else if (flag('--async-next')) {
    print('async-next', await run(createFindLister(true), concurrency))
  } else if (flag('--async')) {
    print('async', await run(createFindLister(false), concurrency))
  } else if (flag('--pool')) {
    const count = option('--pool', 4)
    print(`pool ${count}`, await runPool(count))
  } else {
    print('async', await run(createFindLister(false), concurrency))
    for (const count of [1, 2, 4, 8]) print(`pool ${count}`, await runPool(count))
  }
}

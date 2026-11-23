// Walk benchmark: the koffi FindFirstFileExW lister against the old opendir + lstat walk.
//
//   node scripts/bench-walk.mjs <dir> [--concurrency N] [--legacy] [--async-next]
//
// Without flags it runs the new walk, then the legacy walk, and prints a one-line summary.
// `--legacy` runs only the old walk (16 directories in flight); `--concurrency N` sets the
// directories in flight of the new walk (default 8). `--async-next` runs the variant that also
// reads each FindNextFileW through koffi's async call (one thread-pool hop per entry).
//
// Plain Node ESM, no build step, so it keeps its own small copy of the two listers. It reads
// folders only and is not run in CI. The first run on a folder warms the file cache, so run
// each twice and compare the second figures.
import { createRequire } from 'node:module'
import { opendir, lstat } from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : Number(args[at + 1])
}
const positional = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--concurrency')
const root = positional[0]
if (root === undefined) {
  console.error(
    'usage: node scripts/bench-walk.mjs <dir> [--concurrency N] [--legacy] [--async-next]',
  )
  process.exit(2)
}

const IO_REPARSE_TAG_SYMLINK = 0xa000000c
const IO_REPARSE_TAG_MOUNT_POINT = 0xa0000003

function createFindLister(useAsyncNext) {
  const koffi = require('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const fileTime = koffi.struct('BENCH_FILETIME', { low: 'uint32_t', high: 'uint32_t' })
  const findData = koffi.struct('BENCH_FIND_DATAW', {
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
  const findFirst = kernel32.func(
    'intptr_t __stdcall FindFirstFileExW(const char16_t *p, int lvl, _Out_ BENCH_FIND_DATAW *d, int op, void *f, uint32_t fl)',
  )
  const findNext = kernel32.func(
    'int __stdcall FindNextFileW(intptr_t h, _Out_ BENCH_FIND_DATAW *d)',
  )
  const findClose = kernel32.func('int __stdcall FindClose(intptr_t h)')
  void findData
  const call = (fn, ...fnArgs) =>
    new Promise((resolve, reject) => {
      fn.async(...fnArgs, (error, result) => (error ? reject(error) : resolve(result)))
    })
  const entryOf = (d) => {
    if (d.cFileName === '.' || d.cFileName === '..') return null
    const isDirectory = (d.dwFileAttributes & 0x10) !== 0
    const isLink =
      (d.dwFileAttributes & 0x400) !== 0 &&
      (d.dwReserved0 === IO_REPARSE_TAG_SYMLINK || d.dwReserved0 === IO_REPARSE_TAG_MOUNT_POINT)
    return { name: d.cFileName, isDirectory, isLink }
  }
  return async (dir) => {
    const pattern = (dir.endsWith('\\') ? dir : `${dir}\\`) + '*'
    const data = {}
    const handle = await call(findFirst, pattern, 1, data, 0, null, 2)
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

function print(label, result) {
  console.log(
    `${label}: files=${result.files} folders=${result.folders} seconds=${result.seconds.toFixed(2)} files/s=${result.rate}`,
  )
}

const concurrency = option('--concurrency', 8)
if (flag('--legacy')) {
  print('legacy', await run(legacyList, 16))
} else if (flag('--async-next')) {
  print('async-next', await run(createFindLister(true), concurrency))
} else if (args.includes('--concurrency')) {
  print('new', await run(createFindLister(false), concurrency))
} else {
  const fresh = await run(createFindLister(false), concurrency)
  print('new', fresh)
  const legacy = await run(legacyList, 16)
  print('legacy', legacy)
  console.log(
    `new=${fresh.rate}/s legacy=${legacy.rate}/s ratio=${(fresh.rate / legacy.rate).toFixed(1)}`,
  )
}

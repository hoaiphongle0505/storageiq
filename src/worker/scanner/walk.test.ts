import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeWalkFs, dir, file, link } from './test/fake-walk-fs'
import { errorCode, MAX_DIRECTORIES_IN_FLIGHT, nodeWalkFs, walk, type WalkSink } from './walk'

const ROOT = 'C:\\Data'

/** A sink whose folder handle is simply the folder's path. */
function recordingSink() {
  const folders: string[] = []
  const files: Array<{ parent: string; bytes: number }> = []
  const errors: Array<{ path: string; code: string }> = []
  const visited: string[] = []
  const sink: WalkSink<string> = {
    folder: (parent, name) => {
      const folderPath = path.join(parent, name)
      folders.push(folderPath)
      return folderPath
    },
    file: (parent, bytes) => {
      files.push({ parent, bytes })
    },
    error: (errorPath, code) => {
      errors.push({ path: errorPath, code })
    },
    visiting: (dirPath) => {
      visited.push(dirPath)
    },
  }
  return { sink, folders, files, errors, visited }
}

const never = () => new AbortController().signal
const totalBytes = (files: Array<{ bytes: number }>) => files.reduce((sum, f) => sum + f.bytes, 0)

function siblings(count: number) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`d${i}`, dir({ 'f.bin': file(1) })]),
  )
}

describe('walk with an injected file system', () => {
  it('reports every folder and file with its size', async () => {
    const fs = createFakeWalkFs(
      ROOT,
      dir({
        Photos: dir({ '2024': dir({ 'a.jpg': file(300) }), 'b.jpg': file(200) }),
        'notes.txt': file(5),
      }),
    )
    const { sink, folders, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect([...folders].sort()).toEqual([
      path.join(ROOT, 'Photos'),
      path.join(ROOT, 'Photos', '2024'),
    ])
    expect(files).toHaveLength(3)
    expect(totalBytes(files)).toBe(505)
    expect(errors).toEqual([])
  })

  it('counts links as 0-byte entries and never lists them', async () => {
    const fs = createFakeWalkFs(ROOT, dir({ Shortcut: link(), Real: dir({ 'x.bin': file(10) }) }))
    const { sink, folders, files } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(folders).toEqual([path.join(ROOT, 'Real')])
    expect(files).toContainEqual({ parent: ROOT, bytes: 0 })
    expect(totalBytes(files)).toBe(10)
    expect(fs.opendirCalls).not.toContain(path.join(ROOT, 'Shortcut'))
  })

  it('records unreadable folders with their error code and keeps going', async () => {
    const locked = path.join(ROOT, 'Locked')
    const deep = path.join(ROOT, 'Deep')
    const fs = createFakeWalkFs(
      ROOT,
      dir({ Locked: dir({ 's.bin': file(1) }), Deep: dir(), Open: dir({ 'o.bin': file(7) }) }),
      { opendirErrors: { [locked]: 'EACCES', [deep]: 'ENAMETOOLONG' } },
    )
    const { sink, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(errors).toHaveLength(2)
    expect(errors).toContainEqual({ path: locked, code: 'EACCES' })
    expect(errors).toContainEqual({ path: deep, code: 'ENAMETOOLONG' })
    expect(files).toEqual([{ parent: path.join(ROOT, 'Open'), bytes: 7 }])
  })

  it('records entries that cannot be inspected', async () => {
    const gone = path.join(ROOT, 'gone.txt')
    const fs = createFakeWalkFs(ROOT, dir({ 'gone.txt': file(9), 'kept.txt': file(4) }), {
      lstatErrors: { [gone]: 'ENOENT' },
    })
    const { sink, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(errors).toEqual([{ path: gone, code: 'ENOENT' }])
    expect(files).toEqual([{ parent: ROOT, bytes: 4 }])
  })

  it('keeps what was read when a listing fails part-way', async () => {
    const flaky = path.join(ROOT, 'Flaky')
    const fs = createFakeWalkFs(
      ROOT,
      dir({ Flaky: dir({ 'a.bin': file(10), 'b.bin': file(20) }) }),
      {
        iterationErrors: { [flaky]: 'EIO' },
      },
    )
    const { sink, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(errors).toEqual([{ path: flaky, code: 'EIO' }])
    expect(files).toEqual([{ parent: flaky, bytes: 10 }])
  })

  it('reports an unreadable root as a single error', async () => {
    const fs = createFakeWalkFs(ROOT, dir({ 'a.bin': file(1) }), {
      opendirErrors: { [ROOT]: 'EPERM' },
    })
    const { sink, folders, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(errors).toEqual([{ path: ROOT, code: 'EPERM' }])
    expect(folders).toEqual([])
    expect(files).toEqual([])
  })

  it('lists at most 16 directories at the same time', async () => {
    const fs = createFakeWalkFs(ROOT, dir(siblings(40)), {
      beforeOpendir: () => new Promise((resolve) => setTimeout(resolve, 2)),
    })
    const { sink, files } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(MAX_DIRECTORIES_IN_FLIGHT).toBe(16)
    expect(fs.maxListingAtOnce).toBe(16)
    expect(files).toHaveLength(40)
  })

  it('honours a lower concurrency', async () => {
    const fs = createFakeWalkFs(ROOT, dir(siblings(12)), {
      beforeOpendir: () => new Promise((resolve) => setTimeout(resolve, 2)),
    })
    const { sink } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never(), concurrency: 4 })

    expect(fs.maxListingAtOnce).toBe(4)
  })

  it('stops starting new directories as soon as the signal aborts', async () => {
    const controller = new AbortController()
    let childListings = 0
    let startedAfterAbort = 0
    const fs = createFakeWalkFs(ROOT, dir(siblings(30)), {
      beforeOpendir: async (dirPath) => {
        if (controller.signal.aborted) startedAfterAbort += 1
        if (dirPath === ROOT) return
        childListings += 1
        if (childListings === 5) controller.abort()
      },
    })
    const { sink, files, visited } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: controller.signal })

    expect(startedAfterAbort).toBe(0)
    expect(visited).toHaveLength(6) // the root plus the five folders started before the abort
    expect(files).toEqual([]) // every listing checks the signal before handling an entry
  })

  it('does nothing when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fs = createFakeWalkFs(ROOT, dir({ 'a.bin': file(1) }))
    const { sink, visited } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: controller.signal })

    expect(visited).toEqual([])
    expect(fs.opendirCalls).toEqual([])
  })

  it('reads the Node.js error code', () => {
    expect(errorCode(Object.assign(new Error('denied'), { code: 'EPERM' }))).toBe('EPERM')
    expect(errorCode(new Error('no code'))).toBe('UNKNOWN')
    expect(errorCode('not an error')).toBe('UNKNOWN')
  })
})

describe('walk on disk', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'storageiq-walk-'))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('measures a real folder tree and does not follow a junction', async () => {
    const root = path.join(base, 'root')
    const outside = path.join(base, 'outside')
    const docs = path.join(root, 'docs')
    const deep = path.join(docs, 'deep')
    const empty = path.join(root, 'empty')
    mkdirSync(deep, { recursive: true })
    mkdirSync(empty)
    mkdirSync(outside)
    writeFileSync(path.join(root, 'a.bin'), Buffer.alloc(100))
    writeFileSync(path.join(docs, 'b.bin'), Buffer.alloc(250))
    writeFileSync(path.join(docs, 'c.bin'), Buffer.alloc(0))
    writeFileSync(path.join(deep, 'd.bin'), Buffer.alloc(1000))
    writeFileSync(path.join(outside, 'big.bin'), Buffer.alloc(5000))
    symlinkSync(outside, path.join(root, 'junction'), 'junction') // no admin rights needed

    const { sink, folders, files, errors, visited } = recordingSink()
    await walk(root, root, sink, { fs: nodeWalkFs, signal: never() })

    expect(errors).toEqual([])
    expect([...folders].sort()).toEqual([docs, deep, empty].sort())
    expect(files).toHaveLength(5) // a, b, c, d and the junction
    expect(totalBytes(files)).toBe(1350)
    expect(files).toContainEqual({ parent: root, bytes: 0 }) // the junction
    expect([...visited].sort()).toEqual([root, docs, deep, empty].sort())
  })

  it('reports a missing root as not found', async () => {
    const missing = path.join(base, 'missing')
    const { sink, errors } = recordingSink()

    await walk(missing, missing, sink, { fs: nodeWalkFs, signal: never() })

    expect(errors).toEqual([{ path: missing, code: 'ENOENT' }])
  })
})

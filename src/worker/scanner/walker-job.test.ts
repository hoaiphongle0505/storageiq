import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WalkSink } from './walk'
import { createFakeWalkFs, dir, type FakeNode, file, link } from './test/fake-walk-fs'
import { decodeBatch } from './walker-batch'
import { ABORT_CHECK_ENTRIES, runJob, WALKER_BUDGET_DIRECTORIES } from './walker-job'

const ROOT = 'C:\\Data'

function job(
  children: Record<string, FakeNode>,
  options: Parameters<typeof createFakeWalkFs>[2] = {},
  shouldStop: () => boolean = () => false,
  budget?: { entries: number; directories: number },
  dirPath = ROOT,
) {
  const fs = createFakeWalkFs(ROOT, dir(children), options)
  return runJob(dirPath, fs.syncLister(), shouldStop, budget)
}

function names(batch: ReturnType<typeof runJob>): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < batch.count; i += 1) {
    const end = batch.nameEnds[i] ?? start
    out.push(batch.names.slice(start, end))
    start = end
  }
  return out
}

function manyFiles(count: number): Record<string, FakeNode> {
  const files: Record<string, FakeNode> = {}
  for (let i = 0; i < count; i += 1) files[`f${i}`] = file(1)
  return files
}

describe('runJob', () => {
  it('walks depth-first inside one job and numbers folders in record order', () => {
    const batch = job({
      a: dir({ 'x.txt': file(1), inner: dir({ 'y.txt': file(2) }) }),
      b: dir({ 'z.txt': file(3) }),
      'top.txt': file(4),
    })
    expect(batch.pendingLocal.length).toBe(0)
    // Folders get local ids in record order: a=1, b=2 (listed from the root), then the
    // local stack pops b (LIFO) before a, so b's file comes before a's records.
    const decoded: string[] = []
    const sink: WalkSink<string> = {
      folder: (parent, name) => {
        decoded.push(`folder ${parent}/${name}`)
        return `${parent}/${name}`
      },
      file: (parent, bytes, name) => {
        decoded.push(`file ${parent}/${name}=${bytes}`)
      },
      error: () => undefined,
      visiting: () => undefined,
    }
    decodeBatch(batch, '', sink)
    expect(decoded).toEqual([
      'folder /a',
      'folder /b',
      'file /top.txt=4',
      'file /b/z.txt=3',
      'file /a/x.txt=1',
      'folder /a/inner',
      'file /a/inner/y.txt=2',
    ])
    expect(Array.from(batch.parents)).toEqual([0, 0, 0, 2, 1, 1, 3])
  })

  it('a link that is a directory is counted as a 0-byte file and never entered', () => {
    const batch = job({ junction: link(true), real: dir({ 'a.txt': file(1) }) })
    expect(names(batch)).toContain('junction')
    const index = names(batch).indexOf('junction')
    expect(batch.kinds[index]).toBe(0)
    expect(batch.sizes[index]).toBe(0)
    expect(batch.pendingLocal.length).toBe(0)
    expect(names(batch)).toEqual(expect.arrayContaining(['junction', 'real', 'a.txt']))
    expect(names(batch)).toHaveLength(3)
  })

  it('stops starting directories after 64 directories and returns the rest as pending', () => {
    const children: Record<string, FakeNode> = {}
    for (let i = 0; i < 200; i += 1) children[`d${i}`] = dir({ 'f.txt': file(1) })
    const batch = job(children)
    // the root plus 63 siblings were listed
    let filesSeen = 0
    for (let i = 0; i < batch.count; i += 1) if (batch.kinds[i] === 0) filesSeen += 1
    expect(WALKER_BUDGET_DIRECTORIES).toBe(64)
    expect(filesSeen).toBe(63)
    expect(batch.pendingLocal.length).toBe(200 - 63)
    for (const pending of batch.pendingPaths) {
      expect(pending).toMatch(/^C:\\Data\\d\d*$/)
    }
    expect(new Set(batch.pendingPaths).size).toBe(batch.pendingPaths.length)
  })

  it('stops after 2000 records between directories and never splits a listing', () => {
    // The root lists three folders, then the local stack pops `big` (last pushed) first: its
    // 5_000 entries come back whole, and the two siblings are returned as pending.
    const batch = job({ s1: dir({ 'a.txt': file(1) }), s2: dir(), big: dir(manyFiles(5000)) })
    expect(batch.count).toBe(3 + 5000)
    expect(batch.pendingPaths.sort()).toEqual([path.join(ROOT, 's1'), path.join(ROOT, 's2')])
    expect(batch.pendingLocal.length).toBe(2)
  })

  it('a listing error becomes an error record and the job continues', () => {
    const base = path.join(ROOT, 'locked')
    const partial = path.join(ROOT, 'half')
    const batch = job(
      { locked: dir({ 'x.txt': file(1) }), half: dir({ 'a.txt': file(1), 'b.txt': file(2) }) },
      { listErrors: { [base]: 'EACCES' }, partialErrors: { [partial]: 'ENOENT' } },
    )
    expect(batch.errors).toEqual([
      { path: partial, code: 'ENOENT', kind: 'folder' },
      { path: base, code: 'EACCES', kind: 'folder' },
    ])
    expect(names(batch)).toContain('a.txt')
    expect(names(batch)).not.toContain('b.txt')
    expect(names(batch)).not.toContain('x.txt')
  })

  it('shouldStop during a listing stops within ABORT_CHECK_ENTRIES', () => {
    expect(ABORT_CHECK_ENTRIES).toBe(4096)
    // check 1 is before the root listing; then one every 4096 entries; true from the second
    let checks = 0
    const batch = job({ a: dir({ x: file(1) }), b: dir(), ...manyFiles(20_000) }, {}, () => {
      checks += 1
      return checks >= 2
    })
    expect(batch.count).toBeLessThan(4_200)
    expect(batch.count).toBeGreaterThan(0)
    expect(batch.pendingLocal.length).toBe(2) // a and b were not walked
  })
})

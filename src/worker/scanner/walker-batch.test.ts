import { describe, expect, it } from 'vitest'
import type { ScanErrorKind } from '@shared/scan-types'
import type { WalkSink } from './walk'
import {
  BatchBuilder,
  batchTransferList,
  decodeBatch,
  KIND_FILE,
  KIND_FOLDER,
  type ResultBatch,
} from './walker-batch'

type Call =
  | ['folder', number, string, number]
  | ['file', number, number, string, number]
  | ['error', string, string, ScanErrorKind]
  | ['visiting', string]

function recordingSink(): { sink: WalkSink<number>; calls: Call[] } {
  const calls: Call[] = []
  let next = 100
  const sink: WalkSink<number> = {
    folder(parent, name, modifiedMs) {
      calls.push(['folder', parent, name, modifiedMs])
      next += 1
      return next
    },
    file(parent, bytes, name, modifiedMs) {
      calls.push(['file', parent, bytes, name, modifiedMs])
    },
    error(path, code, kind) {
      calls.push(['error', path, code, kind])
    },
    visiting(path) {
      calls.push(['visiting', path])
    },
  }
  return { sink, calls }
}

describe('walker batch wire format', () => {
  it('a batch round-trips files, folders and nested folders', () => {
    const b = new BatchBuilder()
    b.addFile(0, 'root.txt', 10, 1000)
    const a = b.addFolder(0, 'A', 2000)
    b.addFile(a, 'a.bin', 2 ** 40 + 7, 3000)
    const inner = b.addFolder(a, 'B', 4000)
    b.addFile(inner, 'b.bin', 5, 5000)
    const batch = b.finish()
    expect(batch.count).toBe(5)
    expect(batch.kinds[0]).toBe(KIND_FILE)
    expect(batch.kinds[1]).toBe(KIND_FOLDER)
    expect(a).toBe(1)
    expect(inner).toBe(2)

    const { sink, calls } = recordingSink()
    const pending = decodeBatch(batch, 7, sink)

    expect(pending).toEqual([])
    expect(calls).toEqual([
      ['file', 7, 10, 'root.txt', 1000],
      ['folder', 7, 'A', 2000],
      ['file', 101, 2 ** 40 + 7, 'a.bin', 3000],
      ['folder', 101, 'B', 4000],
      ['file', 102, 5, 'b.bin', 5000],
    ])
  })

  it('sizes above 4 GB and names with lone surrogates survive', () => {
    const b = new BatchBuilder()
    b.addFile(0, '\ud800x', 5_000_000_000, 1)
    const batch = b.finish()
    const cloned = structuredClone(batch, { transfer: batchTransferList(batch) })
    const { sink, calls } = recordingSink()
    decodeBatch(cloned, 0, sink)
    expect(calls).toEqual([['file', 0, 5_000_000_000, '\ud800x', 1]])
  })

  it('errors are applied first and visiting last', () => {
    const b = new BatchBuilder()
    b.addFile(0, 'f', 1, 0)
    b.addError('C:\\x', 'EACCES', 'folder')
    b.addFolder(0, 'd', 0)
    b.addError('C:\\y', 'ENOENT', 'folder')
    b.setVisited('C:\\last')
    const { sink, calls } = recordingSink()
    decodeBatch(b.finish(), 0, sink)
    expect(calls.map((c) => c[0])).toEqual(['error', 'error', 'file', 'folder', 'visiting'])
    expect(calls[4]).toEqual(['visiting', 'C:\\last'])
  })

  it('pending folders come back with their mapped handles and paths', () => {
    const b = new BatchBuilder()
    const one = b.addFolder(0, 'one', 0)
    const two = b.addFolder(one, 'two', 0)
    b.addPending(one, 'C:\\r\\one')
    b.addPending(two, 'C:\\r\\one\\two')
    const { sink } = recordingSink()
    const pending = decodeBatch(b.finish(), 0, sink)
    expect(pending).toEqual([
      { handle: 101, path: 'C:\\r\\one' },
      { handle: 102, path: 'C:\\r\\one\\two' },
    ])
  })

  it('an empty batch decodes to nothing', () => {
    const { sink, calls } = recordingSink()
    expect(decodeBatch(new BatchBuilder().finish(), 0, sink)).toEqual([])
    expect(calls).toEqual([])
  })

  it('batchTransferList lists the typed-array buffers and a transferred batch still decodes', () => {
    const b = new BatchBuilder()
    b.addFile(0, 'x', 3, 4)
    b.addFolder(0, 'y', 5)
    const batch = b.finish()
    const list = batchTransferList(batch)
    expect(list.length).toBeGreaterThanOrEqual(6)
    expect(new Set(list).size).toBe(list.length)
    const cloned: ResultBatch = structuredClone(batch, { transfer: list })
    expect(batch.kinds.byteLength).toBe(0) // moved, not copied
    const { sink, calls } = recordingSink()
    decodeBatch(cloned, 0, sink)
    expect(calls).toEqual([
      ['file', 0, 3, 'x', 4],
      ['folder', 0, 'y', 5],
    ])
  })

  it('encode and decode of 200_000 records takes under 1500 ms', () => {
    const started = performance.now()
    const b = new BatchBuilder()
    for (let i = 0; i < 200_000; i += 1) {
      if (i % 20 === 0) b.addFolder(0, `folder${i}`, i)
      else b.addFile(0, `file${i}.txt`, i, i)
    }
    const batch = b.finish()
    const cloned = structuredClone(batch, { transfer: batchTransferList(batch) })
    let seen = 0
    decodeBatch(cloned, 0, {
      folder: () => (seen += 1),
      file: () => {
        seen += 1
      },
      error: () => undefined,
      visiting: () => undefined,
    })
    expect(seen).toBe(200_000)
    expect(performance.now() - started).toBeLessThan(1500)
  })
})

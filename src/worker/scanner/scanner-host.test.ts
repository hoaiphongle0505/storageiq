import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerMessage, ScannerQuery, ScanVolume } from '@shared/scanner-protocol'
import {
  createScannerHost,
  parseScannerRequest,
  REFRESH_BUSY_MESSAGE,
  SNAPSHOT_INTERVAL_MS,
} from './scanner-host'
import {
  createFakeWalkFs,
  dir,
  type FakeNode,
  type FakeWalkFsOptions,
  file,
} from './test/fake-walk-fs'

const ROOT = 'C:\\Data'
const VOLUME: ScanVolume = { clusterBytes: 4096, freeBytes: null }

function tree(): Record<string, FakeNode> {
  return {
    Photos: dir({ 'a.jpg': file(300, 50), 'b.jpg': file(200, 60) }),
    Music: dir({ 'c.mp3': file(100, 70) }),
    'notes.txt': file(5, 80),
  }
}

function setup(options: FakeWalkFsOptions = {}, children: Record<string, FakeNode> = tree()) {
  const root = dir(children)
  const fs = createFakeWalkFs(ROOT, root, options)
  const posted: ScannerMessage[] = []
  let tick: (() => void) | null = null
  let intervalMs = 0
  let clock = 1_000
  const host = createScannerHost({
    fs,
    post: (message) => {
      posted.push(message)
    },
    now: () => clock,
    startTicker: (callback, ms) => {
      tick = callback
      intervalMs = ms
      return () => {
        if (tick === callback) tick = null
      }
    },
  })
  let nextRequest = 1
  const query = async (q: ScannerQuery): Promise<unknown> => {
    const requestId = nextRequest
    nextRequest += 1
    host.handle({ type: 'query', requestId, query: q })
    await vi.waitFor(() =>
      expect(posted.some((m) => m.type === 'reply' && m.requestId === requestId)).toBe(true),
    )
    const reply = posted.find((m) => m.type === 'reply' && m.requestId === requestId)
    if (reply?.type !== 'reply') throw new Error('no reply')
    if (!reply.ok) throw new Error(reply.message)
    return reply.result
  }
  return {
    host,
    root,
    query,
    tick: () => tick?.(),
    isTicking: () => tick !== null,
    intervalMs: () => intervalMs,
    advance: (ms: number) => {
      clock += ms
    },
    progress: (): ScanProgress[] =>
      posted.flatMap((message) => (message.type === 'progress' ? [message.payload] : [])),
    done: (): ScanDone[] =>
      posted.flatMap((message) => (message.type === 'done' ? [message.payload] : [])),
  }
}

describe('createScannerHost', () => {
  it('reports totals, allocated size and the elapsed time when a scan completes', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    t.advance(40)
    await t.host.idle()

    expect(t.done()).toEqual([
      {
        scanId: 's1',
        status: 'complete',
        files: 4,
        folders: 2,
        bytes: 605,
        allocatedBytes: 4 * 4096,
        elapsedMs: 40,
        errors: [],
        errorCount: 0,
      },
    ])
  })

  it('posts a snapshot on every tick and stops ticking when the scan ends', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })

    expect(SNAPSHOT_INTERVAL_MS).toBe(250)
    expect(t.intervalMs()).toBe(SNAPSHOT_INTERVAL_MS)
    t.tick()
    expect(t.progress()).toEqual([
      {
        scanId: 's1',
        files: 0,
        folders: 0,
        bytes: 0,
        allocatedBytes: 0,
        currentPath: ROOT,
        elapsedMs: 0,
        errorCount: 0,
      },
    ])

    await t.host.idle()
    expect(t.isTicking()).toBe(false)
  })

  it('cancels the running scan and reports partial results as canceled', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    t.host.handle({ type: 'cancel', scanId: 's1' })
    await t.host.idle()

    expect(t.done()).toHaveLength(1)
    expect(t.done()[0]).toMatchObject({ scanId: 's1', status: 'canceled', files: 0, bytes: 0 })
  })

  it('ignores a cancel for a different scan', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    t.host.handle({ type: 'cancel', scanId: 'someone-else' })
    await t.host.idle()

    expect(t.done()[0]).toMatchObject({ scanId: 's1', status: 'complete' })
  })

  it('lets a new start supersede the running scan and drops the old tree', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    const first = t.host.currentStore()
    t.host.handle({ type: 'start', scanId: 's2', root: ROOT, volume: VOLUME })
    expect(t.host.currentStore()).not.toBe(first)
    await t.host.idle()

    await vi.waitFor(() => expect(t.done()).toHaveLength(2))
    const statusById = Object.fromEntries(t.done().map((done) => [done.scanId, done.status]))
    expect(statusById).toEqual({ s1: 'canceled', s2: 'complete' })
    expect(await t.query({ kind: 'totals', scanId: 's1' })).toBeNull()
  })

  it('counts a locked file at 0 bytes and reports it as a file', async () => {
    const notes = path.join(ROOT, 'notes.txt')
    const t = setup({ lstatErrors: { [notes]: 'EPERM' } })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()

    expect(t.done()[0]).toMatchObject({
      files: 4,
      bytes: 600,
      errors: [{ path: notes, kind: 'file', reason: 'access-denied', code: 'EPERM' }],
      errorCount: 1,
    })
  })

  it('answers tree queries for the current scan, during and after it', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const t = setup({
      beforeOpendir: async (dirPath) => {
        if (dirPath === path.join(ROOT, 'Music')) await gate
      },
    })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await vi.waitFor(async () => {
      const live = (await t.query({ kind: 'totals', scanId: 's1' })) as { files: number }
      expect(live.files).toBe(3) // Photos and notes.txt are in; Music is still listing
    })
    release()
    await t.host.idle()

    const page = await t.query({
      kind: 'children',
      scanId: 's1',
      nodeId: 'd0',
      sortKey: 'size',
      sortDir: 'desc',
      offset: 0,
      limit: 10,
    })
    expect(page).toMatchObject({ total: 3, parent: { size: 605, files: 4 } })
    expect(await t.query({ kind: 'expand', scanId: 's1', nodeId: 'd0', levels: 1 })).toEqual(['d0'])
    expect(
      await t.query({ kind: 'node', scanId: 's1', nodeId: 'd0', sortKey: 'size', sortDir: 'desc' }),
    ).toMatchObject({ path: ROOT })
    const layout = await t.query({
      kind: 'treemap',
      scanId: 's1',
      nodeId: 'd0',
      mode: 'size',
      depth: 0,
      width: 100,
      height: 100,
    })
    expect(layout).toMatchObject({ nodeId: 'd0', width: 100, height: 100 })
  })

  it('answers queries for another scan id with nothing', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()
    expect(await t.query({ kind: 'expand', scanId: 'old', nodeId: 'd0', levels: 2 })).toEqual([])
    expect(
      await t.query({ kind: 'node', scanId: 'old', nodeId: 'd0', sortKey: 'name', sortDir: 'asc' }),
    ).toBeNull()
  })

  it('refresh rescans the folder from disk and updates its ancestors', async () => {
    const children = tree()
    const t = setup({}, children)
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()
    const page = (await t.query({
      kind: 'children',
      scanId: 's1',
      nodeId: 'd0',
      sortKey: 'name',
      sortDir: 'asc',
      offset: 0,
      limit: 10,
    })) as { rows: Array<{ id: string; name: string }> }
    const photosId = page.rows.find((row) => row.name === 'Photos')?.id ?? ''

    // The disk changes: Photos loses b.jpg and gains a 5000-byte file.
    const photos = children['Photos']
    if (photos?.type !== 'dir') throw new Error('fixture')
    delete photos.children['b.jpg']
    photos.children['new.jpg'] = file(5000, 99)

    const details = await t.query({ kind: 'refresh', scanId: 's1', nodeId: photosId })
    expect(details).toMatchObject({ row: { id: photosId, size: 5300, files: 2, modifiedMs: 99 } })
    expect(await t.query({ kind: 'totals', scanId: 's1' })).toEqual({
      files: 4,
      folders: 2,
      bytes: 5405,
      allocatedBytes: 5 * 4096,
    })
  })

  it('refuses to refresh while the same scan is running', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const t = setup({ beforeOpendir: () => gate })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await expect(t.query({ kind: 'refresh', scanId: 's1', nodeId: 'd0' })).rejects.toThrow(
      REFRESH_BUSY_MESSAGE,
    )
    release()
    await t.host.idle()
  })
})

describe('parseScannerRequest', () => {
  it('accepts start, cancel and query requests', () => {
    expect(
      parseScannerRequest({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME }),
    ).toEqual({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    expect(parseScannerRequest({ type: 'cancel', scanId: 's1' })).toEqual({
      type: 'cancel',
      scanId: 's1',
    })
    const query: ScannerQuery = {
      kind: 'children',
      scanId: 's1',
      nodeId: 'd0',
      sortKey: 'size',
      sortDir: 'desc',
      offset: 0,
      limit: 100,
    }
    expect(parseScannerRequest({ type: 'query', requestId: 3, query })).toEqual({
      type: 'query',
      requestId: 3,
      query,
    })
  })

  it.each([
    null,
    'start',
    { type: 'start', scanId: 's1', root: ROOT },
    { type: 'start', scanId: 's1', root: ROOT, volume: { clusterBytes: 0, freeBytes: null } },
    { type: 'cancel' },
    { type: 'delete', scanId: 's1' },
    { type: 'query', requestId: 1, query: { kind: 'drop', scanId: 's1' } },
    { type: 'query', requestId: 'x', query: { kind: 'totals', scanId: 's1' } },
    {
      type: 'query',
      requestId: 1,
      query: {
        kind: 'treemap',
        scanId: 's1',
        nodeId: 'd0',
        mode: 'huge',
        depth: 0,
        width: 1,
        height: 1,
      },
    },
  ])('rejects %j', (data) => {
    expect(parseScannerRequest(data)).toBeNull()
  })
})

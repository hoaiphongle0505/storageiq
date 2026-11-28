import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerMessage, ScannerQuery, ScanVolume } from '@shared/scanner-protocol'
import {
  createScannerHost,
  type ScannerHostDeps,
  parseScannerRequest,
  REFRESH_BUSY_MESSAGE,
  ROOT_REFRESH_MESSAGE,
  SNAPSHOT_INTERVAL_MS,
} from './scanner-host'
import { walk } from './walk'
import { WalkerStartupError } from './walker-pool'
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

function setup(
  options: FakeWalkFsOptions = {},
  children: Record<string, FakeNode> = tree(),
  extra: Partial<ScannerHostDeps> = {},
) {
  const root = dir(children)
  const lister = createFakeWalkFs(ROOT, root, options)
  const posted: ScannerMessage[] = []
  let tick: (() => void) | null = null
  let intervalMs = 0
  let clock = 1_000
  const host = createScannerHost({
    lister,
    post: (message) => {
      posted.push(message)
    },
    now: () => clock,
    ...extra,
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
    posted,
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
  it('a scan uses walkParallel when given and reports its walker count in done', async () => {
    const walkParallel = vi.fn<NonNullable<ScannerHostDeps['walkParallel']>>(
      async (_root, handle, sink) => {
        const folder = sink.folder(handle, 'Pool', 5)
        sink.file(folder, 700, 'p.bin', 6)
        return { walkers: 4 }
      },
    )
    const t = setup({}, tree(), { walkParallel })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()

    expect(walkParallel).toHaveBeenCalledTimes(1)
    expect(walkParallel.mock.calls[0]?.[0]).toBe(ROOT)
    expect(t.done()).toHaveLength(1)
    expect(t.done()[0]).toMatchObject({
      status: 'complete',
      files: 1,
      folders: 1,
      bytes: 700,
      walkers: 4,
    })
  })

  it('a scan without walkParallel reports walkers 1', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()
    expect(t.done()[0]?.walkers).toBe(1)
  })

  it('a rejected parallel walk posts a failed message and clears the running scan', async () => {
    let calls = 0
    const walkParallel: NonNullable<ScannerHostDeps['walkParallel']> = async (
      _root,
      handle,
      sink,
    ) => {
      calls += 1
      if (calls === 1) throw new Error('The disk reader stopped unexpectedly: boom')
      sink.file(handle, 9, 'ok.bin', 1)
      return { walkers: 3 }
    }
    const t = setup({}, tree(), { walkParallel })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()

    expect(t.posted.filter((m) => m.type === 'failed')).toEqual([
      {
        type: 'failed',
        payload: { scanId: 's1', message: 'The disk reader stopped unexpectedly: boom' },
      },
    ])
    expect(t.done()).toEqual([])
    expect(t.isTicking()).toBe(false)

    t.host.handle({ type: 'start', scanId: 's2', root: ROOT, volume: VOLUME })
    await t.host.idle()
    expect(t.done()[0]).toMatchObject({ scanId: 's2', files: 1, walkers: 3 })
  })

  it('a WalkerStartupError falls back to the single-thread walk', async () => {
    const walkParallel = vi.fn(async () => {
      throw new WalkerStartupError('cannot start')
    })
    const t = setup({}, tree(), { walkParallel })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()

    expect(walkParallel).toHaveBeenCalledTimes(1)
    expect(t.posted.some((m) => m.type === 'failed')).toBe(false)
    expect(t.done()[0]).toMatchObject({ files: 4, folders: 2, bytes: 605, walkers: 1 })
  })

  it('refresh uses the single-thread walk even when walkParallel is set', async () => {
    const lister = createFakeWalkFs(ROOT, dir(tree()))
    const walkParallel = vi.fn<NonNullable<ScannerHostDeps['walkParallel']>>(
      async (root, handle, sink, signal) => {
        await walk(root, handle, sink, { lister, signal })
        return { walkers: 2 }
      },
    )
    const t = setup({}, tree(), { walkParallel })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()
    expect(walkParallel).toHaveBeenCalledTimes(1)
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

    const details = await t.query({ kind: 'refresh', scanId: 's1', nodeId: photosId })

    expect(details).toMatchObject({ row: { id: photosId, files: 2 } })
    expect(walkParallel).toHaveBeenCalledTimes(1) // the refresh did not use it
  })

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
        walkers: 1,
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

  it('answers tree queries for the current scan, during and after it', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const t = setup({
      beforeList: async (dirPath) => {
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

  it('answers the three side-view queries and null for a node that does not exist', async () => {
    const t = setup({}, tree(), { wallClock: () => 1_000_000 })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()

    const top = (await t.query({
      kind: 'top-files',
      scanId: 's1',
      nodeId: 'd0',
      mode: 'size',
    })) as Array<{ name: string }> | null
    expect(top?.map((row) => row.name)).toEqual(['a.jpg', 'b.jpg', 'c.mp3', 'notes.txt'])
    const types = (await t.query({ kind: 'types', scanId: 's1', nodeId: 'd0' })) as Array<{
      ext: string
      size: number
    }> | null
    expect(types?.map((row) => [row.ext, row.size])).toEqual([
      ['jpg', 500],
      ['mp3', 100],
      ['txt', 5],
    ])
    const age = (await t.query({ kind: 'age', scanId: 's1', nodeId: 'd0' })) as Array<{
      id: string
      files: number
    }> | null
    expect(age).toHaveLength(8)
    // The fake files were modified within the first second of 1970: that is not a usable date.
    expect(age?.find((row) => row.id === 'unknown')?.files).toBe(4)
    expect(await t.query({ kind: 'types', scanId: 's1', nodeId: 'd99' })).toBeNull()
    expect(await t.query({ kind: 'age', scanId: 'old', nodeId: 'd0' })).toBeNull()
    expect(
      await t.query({ kind: 'top-files', scanId: 'old', nodeId: 'd0', mode: 'size' }),
    ).toBeNull()
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

  it('stops a running refresh when a new scan starts and never touches the new tree', async () => {
    let gateOn = false
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const opened: string[] = []
    const t = setup({
      beforeList: async (dirPath) => {
        opened.push(dirPath)
        if (gateOn && dirPath === path.join(ROOT, 'Photos')) await gate
      },
    })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()
    const photosId = (
      (await t.query({
        kind: 'children',
        scanId: 's1',
        nodeId: 'd0',
        sortKey: 'name',
        sortDir: 'asc',
        offset: 0,
        limit: 10,
      })) as { rows: Array<{ id: string; name: string }> }
    ).rows.find((row) => row.name === 'Photos')?.id as string

    gateOn = true
    const refresh = t.query({ kind: 'refresh', scanId: 's1', nodeId: photosId })
    await vi.waitFor(() => expect(opened.filter((p) => p.endsWith('Photos'))).toHaveLength(2))
    const oldStore = t.host.currentStore()
    t.host.handle({ type: 'start', scanId: 's2', root: ROOT, volume: VOLUME })
    expect(t.host.currentStore()).not.toBe(oldStore)
    gateOn = false
    release()

    await expect(refresh).resolves.toBeNull()
    await t.host.idle()
    expect(await t.query({ kind: 'totals', scanId: 's2' })).toEqual({
      files: 4,
      folders: 2,
      bytes: 605,
      allocatedBytes: 4 * 4096,
    })
  })

  it('answers a queued refresh of a superseded scan with nothing', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()
    t.host.handle({ type: 'start', scanId: 's2', root: ROOT, volume: VOLUME })
    await expect(t.query({ kind: 'refresh', scanId: 's1', nodeId: 'd1' })).resolves.toBeNull()
    await t.host.idle()
  })

  it('refuses to refresh the scan root; the root is rescanned as a normal scan', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()
    await expect(t.query({ kind: 'refresh', scanId: 's1', nodeId: 'd0' })).rejects.toThrow(
      ROOT_REFRESH_MESSAGE,
    )
  })

  it('refuses to refresh while the same scan is running', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const t = setup({ beforeList: () => gate })
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
    { type: 'query', requestId: 1, query: { kind: 'top-files', scanId: 's1', nodeId: 'd0' } },
    {
      type: 'query',
      requestId: 1,
      query: { kind: 'top-files', scanId: 's1', nodeId: 'd0', mode: 'huge' },
    },
    { type: 'query', requestId: 1, query: { kind: 'types', scanId: 's1', nodeId: 7 } },
    { type: 'query', requestId: 1, query: { kind: 'age', scanId: 's1' } },
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

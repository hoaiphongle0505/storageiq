import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerMessage } from '@shared/scanner-protocol'
import { createScannerHost, parseScannerRequest, SNAPSHOT_INTERVAL_MS } from './scanner-host'
import { createFakeWalkFs, dir, type FakeWalkFsOptions, file } from './test/fake-walk-fs'

const ROOT = 'C:\\Data'
const PHOTOS = path.join(ROOT, 'Photos')
const MUSIC = path.join(ROOT, 'Music')

function setup(options: FakeWalkFsOptions = {}) {
  const fs = createFakeWalkFs(
    ROOT,
    dir({
      Photos: dir({ 'a.jpg': file(300), 'b.jpg': file(200) }),
      Music: dir({ 'c.mp3': file(100) }),
      'notes.txt': file(5),
    }),
    options,
  )
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
  return {
    host,
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
  it('reports totals, the largest folders and the elapsed time when a scan completes', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    t.advance(40)
    await t.host.idle()

    expect(t.done()).toEqual([
      {
        scanId: 's1',
        status: 'complete',
        files: 4,
        folders: 2,
        bytes: 605,
        elapsedMs: 40,
        topFolders: [
          { kind: 'folder', name: 'Photos', path: PHOTOS, bytes: 500, files: 2, folders: 0 },
          { kind: 'folder', name: 'Music', path: MUSIC, bytes: 100, files: 1, folders: 0 },
          {
            kind: 'everything-else',
            name: 'Everything else',
            path: ROOT,
            bytes: 5,
            files: 1,
            folders: 0,
          },
        ],
        errors: [],
        errorCount: 0,
      },
    ])
  })

  it('posts a snapshot on every tick and stops ticking when the scan ends', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })

    expect(SNAPSHOT_INTERVAL_MS).toBe(250)
    expect(t.intervalMs()).toBe(SNAPSHOT_INTERVAL_MS)
    t.tick()
    expect(t.progress()).toEqual([
      {
        scanId: 's1',
        files: 0,
        folders: 0,
        bytes: 0,
        currentPath: ROOT,
        elapsedMs: 0,
        topFolders: [],
      },
    ])

    await t.host.idle()
    expect(t.isTicking()).toBe(false)
  })

  it('cancels the running scan and reports partial results as canceled', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    t.host.handle({ type: 'cancel', scanId: 's1' })
    await t.host.idle()

    expect(t.done()).toHaveLength(1)
    expect(t.done()[0]).toMatchObject({ scanId: 's1', status: 'canceled', files: 0, bytes: 0 })
  })

  it('ignores a cancel for a different scan', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    t.host.handle({ type: 'cancel', scanId: 'someone-else' })
    await t.host.idle()

    expect(t.done()[0]).toMatchObject({ scanId: 's1', status: 'complete' })
  })

  it('lets a new start supersede the running scan', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    t.host.handle({ type: 'start', scanId: 's2', root: ROOT })
    await t.host.idle()

    await vi.waitFor(() => expect(t.done()).toHaveLength(2))
    const statusById = Object.fromEntries(t.done().map((done) => [done.scanId, done.status]))
    expect(statusById).toEqual({ s1: 'canceled', s2: 'complete' })
  })

  it('keeps the newest scan’s tree when a superseded scan settles after it', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const t = setup({
      beforeOpendir: async () => {
        calls += 1
        if (calls === 1) await gate // only the first scan's first listing is held back
      },
    })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    t.host.handle({ type: 'start', scanId: 's2', root: ROOT })
    await vi.waitFor(() => expect(t.done()).toHaveLength(1))
    expect(t.done()[0]).toMatchObject({ scanId: 's2', status: 'complete' })

    release()
    await vi.waitFor(() => expect(t.done()).toHaveLength(2))
    expect(t.done()[1]).toMatchObject({ scanId: 's1', status: 'canceled' })
    expect(t.host.lastTree()?.totals()).toEqual({ files: 4, folders: 2, bytes: 605 })
  })

  it('ends a scan of an unreadable root as complete with zero totals and one error', async () => {
    const t = setup({ opendirErrors: { [ROOT]: 'EACCES' } })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    await t.host.idle()

    expect(t.done()[0]).toMatchObject({
      status: 'complete',
      files: 0,
      folders: 0,
      bytes: 0,
      topFolders: [],
      errors: [{ path: ROOT, reason: 'access-denied', code: 'EACCES' }],
      errorCount: 1,
    })
  })

  it('keeps the finished tree for later queries', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    await t.host.idle()

    expect(t.host.lastTree()?.totals()).toEqual({ files: 4, folders: 2, bytes: 605 })
  })
})

describe('parseScannerRequest', () => {
  it('accepts start and cancel requests', () => {
    expect(parseScannerRequest({ type: 'start', scanId: 's1', root: ROOT })).toEqual({
      type: 'start',
      scanId: 's1',
      root: ROOT,
    })
    expect(parseScannerRequest({ type: 'cancel', scanId: 's1' })).toEqual({
      type: 'cancel',
      scanId: 's1',
    })
  })

  it.each([
    null,
    'start',
    { type: 'start', scanId: 's1' },
    { type: 'cancel' },
    { type: 'delete', scanId: 's1' },
  ])('rejects %j', (data) => {
    expect(parseScannerRequest(data)).toBeNull()
  })
})

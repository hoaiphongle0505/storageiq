import { describe, expect, it } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerRequest, ScanVolume } from '@shared/scanner-protocol'
import type { SendEvent } from '../ipc/send-event'
import {
  createScanService,
  QUERY_TIMEOUT_MESSAGE,
  SCAN_CRASH_MESSAGE,
  SCANNER_GONE_MESSAGE,
  type ScannerChild,
} from './scan-service'

const V: ScanVolume = { clusterBytes: 4096, freeBytes: null }

interface FakeChild extends ScannerChild {
  posted: ScannerRequest[]
  killed: boolean
  emit(message: unknown): void
  exit(code: number): void
}

function createFakeChild(): FakeChild {
  const messageListeners: Array<(message: unknown) => void> = []
  const exitListeners: Array<(code: number) => void> = []
  const child: FakeChild = {
    posted: [],
    killed: false,
    postMessage: (message) => {
      child.posted.push(message)
    },
    onMessage: (listener) => {
      messageListeners.push(listener)
    },
    onExit: (listener) => {
      exitListeners.push(listener)
    },
    kill: () => {
      child.killed = true
    },
    emit: (message) => {
      for (const listener of messageListeners) listener(message)
    },
    exit: (code) => {
      for (const listener of exitListeners) listener(code)
    },
  }
  return child
}

function progress(scanId: string): ScanProgress {
  return {
    scanId,
    files: 1,
    folders: 0,
    bytes: 10,
    allocatedBytes: 4096,
    currentPath: 'C:\\Data',
    elapsedMs: 250,
    errorCount: 0,
  }
}

function done(scanId: string, status: ScanDone['status'] = 'complete'): ScanDone {
  return {
    scanId,
    status,
    files: 1,
    folders: 0,
    bytes: 10,
    allocatedBytes: 4096,
    elapsedMs: 300,
    errors: [],
    errorCount: 0,
  }
}

function setup() {
  const timers: Array<() => void> = []
  const children: FakeChild[] = []
  const events: Array<[string, unknown]> = []
  const sendEvent: SendEvent = (channel, payload) => {
    events.push([channel, payload])
  }
  let counter = 0
  const service = createScanService({
    forkScanner: () => {
      const child = createFakeChild()
      children.push(child)
      return child
    },
    sendEvent,
    setTimer: (callback) => {
      timers.push(callback)
      return () => {
        const index = timers.indexOf(callback)
        if (index !== -1) timers.splice(index, 1)
      }
    },
    createScanId: () => {
      counter += 1
      return `scan-${counter}`
    },
  })
  const child = (index = 0): FakeChild => {
    const found = children[index]
    if (!found) throw new Error(`no scanner child #${index}`)
    return found
  }
  return { service, children, events, child, timers }
}

describe('createScanService', () => {
  it('forks the scanner on the first start only and posts each start request', () => {
    const t = setup()
    expect(t.children).toHaveLength(0)

    expect(t.service.start('C:\\Data', V)).toEqual({ scanId: 'scan-1' })
    t.child().emit({ type: 'done', payload: done('scan-1') })
    expect(t.service.start('D:\\', V)).toEqual({ scanId: 'scan-2' })

    expect(t.children).toHaveLength(1)
    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data', volume: V },
      { type: 'start', scanId: 'scan-2', root: 'D:\\', volume: V },
    ])
  })

  it('relays progress and done of the active scan to the window', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.child().emit({ type: 'progress', payload: progress('scan-1') })
    t.child().emit({ type: 'done', payload: done('scan-1') })

    expect(t.events).toEqual([
      ['scan:progress', progress('scan-1')],
      ['scan:done', done('scan-1')],
    ])
  })

  it('drops messages of other scans and malformed messages', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.child().emit({ type: 'progress', payload: progress('scan-0') })
    t.child().emit({ type: 'progress' })
    t.child().emit('garbage')
    t.child().emit({ type: 'other', payload: { scanId: 'scan-1' } })

    expect(t.events).toEqual([])
  })

  it('cancels the running scan when a new one starts, and relays only the new one', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.service.start('D:\\', V)
    t.child().emit({ type: 'done', payload: done('scan-1', 'canceled') })
    t.child().emit({ type: 'done', payload: done('scan-2') })

    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data', volume: V },
      { type: 'cancel', scanId: 'scan-1' },
      { type: 'start', scanId: 'scan-2', root: 'D:\\', volume: V },
    ])
    expect(t.events).toEqual([['scan:done', done('scan-2')]])
  })

  it('cancels the active scan and ignores unknown or finished scans', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.service.cancel('nope')
    t.service.cancel('scan-1')
    t.child().emit({ type: 'done', payload: done('scan-1', 'canceled') })
    t.service.cancel('scan-1')

    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data', volume: V },
      { type: 'cancel', scanId: 'scan-1' },
    ])
    expect(t.events).toEqual([['scan:done', done('scan-1', 'canceled')]])
  })

  it('relays a failed message of the active scan as scan:failed and ends the scan', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    const failed = { scanId: 'scan-1', message: 'The disk reader could not be loaded.' }
    t.child().emit({ type: 'failed', payload: failed })
    t.child().emit({ type: 'done', payload: done('scan-1') })

    expect(t.events).toEqual([['scan:failed', failed]])
  })

  it('turns an unexpected exit during a scan into scan:failed and forks anew next time', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.child().exit(1)

    expect(t.events).toEqual([['scan:failed', { scanId: 'scan-1', message: SCAN_CRASH_MESSAGE }]])

    t.service.start('C:\\Data', V)
    expect(t.children).toHaveLength(2)
    expect(t.child(1).posted).toEqual([
      { type: 'start', scanId: 'scan-2', root: 'C:\\Data', volume: V },
    ])
  })

  it('stays silent when an idle scanner exits', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.child().emit({ type: 'done', payload: done('scan-1') })
    t.child().exit(0)

    expect(t.events).toEqual([['scan:done', done('scan-1')]])
  })

  it('kills the scanner on quit and sends nothing afterwards', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.service.dispose()

    expect(t.child().killed).toBe(true)
    t.child().emit({ type: 'progress', payload: progress('scan-1') })
    t.child().exit(1)
    expect(t.events).toEqual([])
    expect(() => t.service.start('C:\\Data', V)).toThrow('shut down')
  })

  it('cancelActive cancels only a running scan', () => {
    const t = setup()
    t.service.cancelActive()
    expect(t.children).toHaveLength(0)

    t.service.start('C:\\Data', V)
    t.service.cancelActive()
    expect(t.child().posted.at(-1)).toEqual({ type: 'cancel', scanId: 'scan-1' })
  })

  it('remembers the current scan until the scanner exits', () => {
    const t = setup()
    expect(t.service.currentScan()).toBeNull()
    t.service.start('C:\\Data', V)
    expect(t.service.currentScan()).toEqual({ scanId: 'scan-1', root: 'C:\\Data' })
    expect(t.service.isScanning()).toBe(true)
    t.child().emit({ type: 'done', payload: done('scan-1') })
    expect(t.service.isScanning()).toBe(false)
    expect(t.service.currentScan()).toEqual({ scanId: 'scan-1', root: 'C:\\Data' })
    t.child().exit(0)
    expect(t.service.currentScan()).toBeNull()
  })

  it('sends queries to the scanner and resolves them with the matching reply', async () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    const first = t.service.query({ kind: 'totals', scanId: 'scan-1' })
    const second = t.service.query({ kind: 'expand', scanId: 'scan-1', nodeId: 'd0', levels: 1 })
    expect(t.child().posted.slice(1)).toEqual([
      { type: 'query', requestId: 1, query: { kind: 'totals', scanId: 'scan-1' } },
      {
        type: 'query',
        requestId: 2,
        query: { kind: 'expand', scanId: 'scan-1', nodeId: 'd0', levels: 1 },
      },
    ])
    t.child().emit({ type: 'reply', requestId: 2, ok: true, result: ['d0'] })
    t.child().emit({ type: 'reply', requestId: 1, ok: false, message: 'busy' })
    await expect(second).resolves.toEqual(['d0'])
    await expect(first).rejects.toThrow('busy')
    expect(t.timers).toHaveLength(0)
  })

  it('rejects queries when there is no scanner, when it exits and when it does not answer', async () => {
    const t = setup()
    await expect(t.service.query({ kind: 'totals', scanId: 'x' })).rejects.toThrow(
      SCANNER_GONE_MESSAGE,
    )
    t.service.start('C:\\Data', V)
    const lost = t.service.query({ kind: 'totals', scanId: 'scan-1' })
    t.child().exit(1)
    await expect(lost).rejects.toThrow(SCAN_CRASH_MESSAGE)

    t.service.start('C:\\Data', V)
    const slow = t.service.query({ kind: 'totals', scanId: 'scan-2' })
    t.timers[0]?.()
    await expect(slow).rejects.toThrow(QUERY_TIMEOUT_MESSAGE)
  })

  it('ignores a reply that arrives after its query timed out', async () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    const slow = t.service.query({ kind: 'totals', scanId: 'scan-1' })
    t.timers[0]?.()
    await expect(slow).rejects.toThrow(QUERY_TIMEOUT_MESSAGE)
    expect(() =>
      t.child().emit({ type: 'reply', requestId: 1, ok: true, result: null }),
    ).not.toThrow()
  })

  it('dispose rejects pending queries with the scanner-gone message', async () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    const pending = t.service.query({ kind: 'totals', scanId: 'scan-1' })
    t.service.dispose()
    await expect(pending).rejects.toThrow(SCANNER_GONE_MESSAGE)
    expect(t.timers).toHaveLength(0)
  })

  it('does not leak a pending query or its timer when postMessage throws', async () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.child().postMessage = () => {
      throw new Error('channel closed')
    }
    await expect(t.service.query({ kind: 'totals', scanId: 'scan-1' })).rejects.toThrow(
      'channel closed',
    )
    expect(t.timers).toHaveLength(0)
  })
})

import { describe, expect, it } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerRequest } from '@shared/scanner-protocol'
import type { SendEvent } from '../ipc/send-event'
import { createScanService, SCAN_CRASH_MESSAGE, type ScannerChild } from './scan-service'

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
    currentPath: 'C:\\Data',
    elapsedMs: 250,
    topFolders: [],
  }
}

function done(scanId: string, status: ScanDone['status'] = 'complete'): ScanDone {
  return {
    scanId,
    status,
    files: 1,
    folders: 0,
    bytes: 10,
    elapsedMs: 300,
    topFolders: [],
    errors: [],
    errorCount: 0,
  }
}

function setup() {
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
  return { service, children, events, child }
}

describe('createScanService', () => {
  it('forks the scanner on the first start only and posts each start request', () => {
    const t = setup()
    expect(t.children).toHaveLength(0)

    expect(t.service.start('C:\\Data')).toEqual({ scanId: 'scan-1' })
    t.child().emit({ type: 'done', payload: done('scan-1') })
    expect(t.service.start('D:\\')).toEqual({ scanId: 'scan-2' })

    expect(t.children).toHaveLength(1)
    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data' },
      { type: 'start', scanId: 'scan-2', root: 'D:\\' },
    ])
  })

  it('relays progress and done of the active scan to the window', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.child().emit({ type: 'progress', payload: progress('scan-1') })
    t.child().emit({ type: 'done', payload: done('scan-1') })

    expect(t.events).toEqual([
      ['scan:progress', progress('scan-1')],
      ['scan:done', done('scan-1')],
    ])
  })

  it('drops messages of other scans and malformed messages', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.child().emit({ type: 'progress', payload: progress('scan-0') })
    t.child().emit({ type: 'progress' })
    t.child().emit('garbage')
    t.child().emit({ type: 'other', payload: { scanId: 'scan-1' } })

    expect(t.events).toEqual([])
  })

  it('cancels the running scan when a new one starts, and relays only the new one', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.service.start('D:\\')
    t.child().emit({ type: 'done', payload: done('scan-1', 'canceled') })
    t.child().emit({ type: 'done', payload: done('scan-2') })

    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data' },
      { type: 'cancel', scanId: 'scan-1' },
      { type: 'start', scanId: 'scan-2', root: 'D:\\' },
    ])
    expect(t.events).toEqual([['scan:done', done('scan-2')]])
  })

  it('cancels the active scan and ignores unknown or finished scans', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.service.cancel('nope')
    t.service.cancel('scan-1')
    t.child().emit({ type: 'done', payload: done('scan-1', 'canceled') })
    t.service.cancel('scan-1')

    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data' },
      { type: 'cancel', scanId: 'scan-1' },
    ])
    expect(t.events).toEqual([['scan:done', done('scan-1', 'canceled')]])
  })

  it('turns an unexpected exit during a scan into scan:failed and forks anew next time', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.child().exit(1)

    expect(t.events).toEqual([['scan:failed', { scanId: 'scan-1', message: SCAN_CRASH_MESSAGE }]])

    t.service.start('C:\\Data')
    expect(t.children).toHaveLength(2)
    expect(t.child(1).posted).toEqual([{ type: 'start', scanId: 'scan-2', root: 'C:\\Data' }])
  })

  it('stays silent when an idle scanner exits', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.child().emit({ type: 'done', payload: done('scan-1') })
    t.child().exit(0)

    expect(t.events).toEqual([['scan:done', done('scan-1')]])
  })

  it('kills the scanner on quit and sends nothing afterwards', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.service.dispose()

    expect(t.child().killed).toBe(true)
    t.child().emit({ type: 'progress', payload: progress('scan-1') })
    t.child().exit(1)
    expect(t.events).toEqual([])
    expect(() => t.service.start('C:\\Data')).toThrow('shut down')
  })

  it('cancelActive cancels only a running scan', () => {
    const t = setup()
    t.service.cancelActive()
    expect(t.children).toHaveLength(0)

    t.service.start('C:\\Data')
    t.service.cancelActive()
    expect(t.child().posted.at(-1)).toEqual({ type: 'cancel', scanId: 'scan-1' })
  })
})

import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { InvalidIpcArgumentsError } from './parse-args'
import type { SendEvent } from './send-event'
import { fakeTreeService, NODES, SCAN, TOTALS } from './test/fake-tree-service'
import {
  createFolderRefresher,
  createTreeHandlers,
  folderIdOf,
  NOT_IN_SCAN_MESSAGE,
  resolveScanNode,
  SCAN_RUNNING_MESSAGE,
} from './tree-handlers'

const event = {} as IpcMainInvokeEvent

function setup(options: Parameters<typeof fakeTreeService>[0] = {}) {
  const fake = fakeTreeService(options)
  const events: Array<[string, unknown]> = []
  const sendEvent: SendEvent = (channel, payload) => {
    events.push([channel, payload])
  }
  const refreshFolder = createFolderRefresher(fake.service, sendEvent, fake.volumeFor)
  const handlers = createTreeHandlers({ scanService: fake.service, refreshFolder })
  return { ...fake, events, handlers, refreshFolder }
}

describe('tree query handlers', () => {
  it('validate their arguments before asking the scanner', () => {
    const { handlers } = setup()
    expect(() =>
      handlers['tree:children'].parseArgs([SCAN, 'd0', 'size', 'desc', 0, 5000]),
    ).toThrow(InvalidIpcArgumentsError)
    expect(() => handlers['tree:node'].parseArgs([SCAN, '../etc'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => handlers['treemap:layout'].parseArgs([SCAN, 'd0', 'size', 9, 1, 1])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => handlers['tree:expand-ids'].parseArgs([SCAN, 'd0'])).toThrow(
      InvalidIpcArgumentsError,
    )
  })

  it('forward each query to the scanner unchanged', async () => {
    const { handlers, queries } = setup()
    await handlers['tree:children'].handle(event, SCAN, 'd0', 'name', 'asc', 10, 20)
    await handlers['tree:node'].handle(event, SCAN, 'd1', 'size', 'desc')
    await handlers['tree:expand-ids'].handle(event, SCAN, 'd0', 3)
    await handlers['treemap:layout'].handle(event, SCAN, 'd0', 'files', 2, 640, 200)
    expect(queries).toEqual([
      {
        kind: 'children',
        scanId: SCAN,
        nodeId: 'd0',
        sortKey: 'name',
        sortDir: 'asc',
        offset: 10,
        limit: 20,
      },
      { kind: 'node', scanId: SCAN, nodeId: 'd1', sortKey: 'size', sortDir: 'desc' },
      { kind: 'expand', scanId: SCAN, nodeId: 'd0', levels: 3 },
      {
        kind: 'treemap',
        scanId: SCAN,
        nodeId: 'd0',
        mode: 'files',
        depth: 2,
        width: 640,
        height: 200,
      },
    ])
  })
})

describe('tree:refresh', () => {
  it('rescans the folder and sends tree:changed with the new totals', async () => {
    const { handlers, events } = setup()
    await expect(
      Promise.resolve(handlers['tree:refresh'].handle(event, SCAN, 'd1')),
    ).resolves.toEqual(NODES['d1'])
    expect(events).toEqual([['tree:changed', { scanId: SCAN, nodeId: 'd1', totals: TOTALS }]])
  })

  it('refuses while the scan runs and for another scan', async () => {
    await expect(setup({ scanning: true }).refreshFolder(SCAN, 'd1')).rejects.toThrow(
      SCAN_RUNNING_MESSAGE,
    )
    await expect(setup({ current: 'other' }).refreshFolder(SCAN, 'd1')).rejects.toThrow(
      NOT_IN_SCAN_MESSAGE,
    )
  })
})

describe('resolveScanNode', () => {
  it('returns the node of the current scan', async () => {
    const { service } = setup()
    await expect(resolveScanNode(service, SCAN, 'f7')).resolves.toEqual(NODES['f7'])
  })

  it('refuses another scan, no scan, and a node the scanner does not know', async () => {
    await expect(resolveScanNode(setup().service, 'other', 'd1')).rejects.toThrow(
      NOT_IN_SCAN_MESSAGE,
    )
    await expect(resolveScanNode(setup({ current: null }).service, SCAN, 'd1')).rejects.toThrow(
      NOT_IN_SCAN_MESSAGE,
    )
    await expect(resolveScanNode(setup().service, SCAN, 'd99')).rejects.toThrow(NOT_IN_SCAN_MESSAGE)
  })
})

describe('folderIdOf', () => {
  it('maps folders, "[N files]" rows and files to their folder', () => {
    expect(folderIdOf(NODES['d1']!)).toBe('d1')
    expect(folderIdOf(NODES['g1']!)).toBe('d1')
    expect(folderIdOf(NODES['f7']!)).toBe('d1')
  })
})

describe('refreshing the scan root', () => {
  it('starts a normal scan of the root instead of a hidden refresh', async () => {
    const { refreshFolder, start, volumeFor, queries, events } = setup()
    await expect(refreshFolder(SCAN, 'd0')).resolves.toBeNull()
    expect(volumeFor).toHaveBeenCalledWith('D:\\Data')
    expect(start).toHaveBeenCalledWith('D:\\Data', { clusterBytes: 8192, freeBytes: 77 })
    expect(queries.some((query) => query.kind === 'refresh')).toBe(false)
    expect(events).toEqual([['scan:restarted', { scanId: 'rescan-1', root: 'D:\\Data' }]])
  })

  it('treats a file or "[N files]" row directly under the root the same way', async () => {
    const fake = fakeTreeService()
    const refresh = createFolderRefresher(fake.service, () => undefined, fake.volumeFor)
    // g0 is the root's own "[N files]" row; it maps to folder d0.
    NODES['g0'] = { ...NODES['g1']!, row: { ...NODES['g1']!.row, id: 'g0', parentId: 'd0' } }
    try {
      await refresh(SCAN, 'g0')
    } finally {
      delete NODES['g0']
    }
    expect(fake.start).toHaveBeenCalledTimes(1)
  })

  it('does not take over a scan the user started while the volume lookup was pending', async () => {
    const fake = fakeTreeService()
    const events: Array<[string, unknown]> = []
    let scanning = false
    let current: string = SCAN
    fake.service.isScanning = () => scanning
    fake.service.currentScan = () => ({ scanId: current, root: 'D:\\Data' })
    const volumeFor = vi.fn(async () => {
      // The user presses Scan while the refresher waits for the volume details.
      scanning = true
      current = 'user-scan'
      return { clusterBytes: 8192, freeBytes: 77 }
    })
    const refresh = createFolderRefresher(
      fake.service,
      (channel, payload) => {
        events.push([channel, payload])
      },
      volumeFor,
    )
    await expect(refresh(SCAN, 'd0')).resolves.toBeNull()
    expect(fake.start).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('does not rescan the root while a scan runs', async () => {
    const { refreshFolder, start, events } = setup({ scanning: true })
    await expect(refreshFolder(SCAN, 'd0')).rejects.toThrow(SCAN_RUNNING_MESSAGE)
    expect(start).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})

describe('createFolderRefresher', () => {
  it('sends nothing when the folder no longer exists', async () => {
    const { refreshFolder, events } = setup()
    await expect(refreshFolder(SCAN, 'd99')).resolves.toBeNull()
    expect(events).toEqual([])
  })
})

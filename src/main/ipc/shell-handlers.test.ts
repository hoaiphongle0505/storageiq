import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeId, TreeNodeDetails } from '@shared/tree-types'
import type {
  ShellFinish,
  ShellMenuChoice,
  ShellMenuHost,
  ShellMenuRequest,
} from '../shell-menu/context-menu'
import { storageiqMenuLabels } from '../shell-menu/menu-commands'
import { ShellMenuError } from '../shell-menu/shell-menu-error'
import { ShellBusyError } from '../shell-menu/shell-worker-pool'
import { createItemWatcher, ITEM_POLL_INTERVAL_MS, ITEM_WATCH_TIMEOUT_MS } from './item-watcher'
import { InvalidIpcArgumentsError } from './parse-args'
import {
  createShellHandlers,
  SECOND_REFRESH_DELAY_MS,
  type ShellHandlerDeps,
} from './shell-handlers'
import { fakeTreeService, row, SCAN } from './test/fake-tree-service'
import { createFolderRefresher, NOT_IN_SCAN_MESSAGE, SCAN_RUNNING_MESSAGE } from './tree-handlers'

const event = {} as IpcMainInvokeEvent

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Shown = ReturnType<ShellMenuHost['show']>

/** A host whose menus close with `choice` at once and whose commands finish when told to. */
function fakeHost(choice: ShellMenuChoice) {
  const finishes: Array<(result: ShellFinish) => void> = []
  const requests: ShellMenuRequest[] = []
  const show = vi.fn((request: ShellMenuRequest): Shown => {
    requests.push(request)
    const finished = deferred<ShellFinish>()
    finishes.push(finished.resolve)
    return { chosen: Promise.resolve(choice), finished: finished.promise }
  })
  const empties: string[] = []
  const emptyBin = vi.fn((root: string): Promise<ShellFinish> => {
    empties.push(root)
    return Promise.resolve({ ok: true })
  })
  const deletes: Array<{ paths: string[]; permanent: boolean }> = []
  const deleteItems = vi.fn((paths: string[], permanent: boolean): Promise<ShellFinish> => {
    deletes.push({ paths, permanent })
    const finished = deferred<ShellFinish>()
    finishes.push(finished.resolve)
    return finished.promise
  })
  return {
    show,
    deleteItems,
    deletes,
    emptyBin,
    empties,
    requests,
    finishes,
    finish: (index = 0) => finishes[index]?.({ ok: true }),
  }
}

function setup(
  options: {
    choice?: ShellMenuChoice
    scanning?: boolean
    existing?: string[]
    extra?: Record<string, TreeNodeDetails>
  } = {},
) {
  const fake = fakeTreeService({ scanning: options.scanning ?? false, extra: options.extra })
  const pathExists = vi.fn<(target: string) => Promise<boolean>>(async () => true)
  const watcher = createItemWatcher({
    pathExists,
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
    now: () => Date.now(),
  })
  const host = fakeHost(options.choice ?? { kind: 'dismissed' })
  const deps: ShellHandlerDeps = {
    scanService: fake.service,
    refreshFolder: vi.fn(async (_scanId: string, nodeId: string) => fake.node(nodeId)),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    writeClipboard: vi.fn(),
    readdir: vi.fn(async () => options.existing ?? ['a.jpg']),
    mkdir: vi.fn(async () => undefined),
    showShellMenu: host.show,
    deleteShellItems: host.deleteItems,
    emptyRecycleBin: host.emptyBin,
    userSid: vi.fn(async () => 'S-1-5-21-1-2-3-1001'),
    realPath: vi.fn(async (target: string) => target),
    pathExists,
    watcher,
    warn: vi.fn(),
  }
  const handlers = createShellHandlers(deps)
  const remove = (ids: NodeId[], permanent = false, scanId = SCAN) =>
    Promise.resolve(handlers['shell:delete'].handle(event, scanId, ids, permanent))
  const menu = (ids: NodeId[], x = 0, y = 0, extended = false) =>
    Promise.resolve(handlers['shell:context-menu'].handle(event, SCAN, ids, x, y, extended))
  return { deps, fake, host, pathExists, watcher, handlers, menu, remove }
}

const DELETE: ShellMenuChoice = { kind: 'shell', verb: 'delete', changed: true }
const refreshCalls = (deps: ShellHandlerDeps) =>
  vi.mocked(deps.refreshFolder).mock.calls.map(([, nodeId]) => nodeId)

describe('shell:open-in-explorer', () => {
  it('opens a folder, and shows a file selected in its folder', async () => {
    const { handlers, deps } = setup()
    await handlers['shell:open-in-explorer'].handle(event, SCAN, 'd1')
    expect(deps.openPath).toHaveBeenCalledWith('D:\\Data\\Photos')
    await handlers['shell:open-in-explorer'].handle(event, SCAN, 'f7')
    expect(deps.showItemInFolder).toHaveBeenCalledWith('D:\\Data\\Photos\\a.jpg')
  })

  it('only opens paths of the current scan', async () => {
    const { handlers, deps } = setup()
    await expect(
      Promise.resolve().then(() => handlers['shell:open-in-explorer'].handle(event, 'other', 'd1')),
    ).rejects.toThrow(NOT_IN_SCAN_MESSAGE)
    expect(() => handlers['shell:open-in-explorer'].parseArgs([SCAN, 'C:\\Windows'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('reports Explorer’s error', async () => {
    const { handlers, deps } = setup()
    vi.mocked(deps.openPath).mockResolvedValue('Access is denied.')
    await expect(
      Promise.resolve().then(() => handlers['shell:open-in-explorer'].handle(event, SCAN, 'd1')),
    ).rejects.toThrow('Access is denied.')
  })
})

describe('shell:context-menu: requests', () => {
  it('resolves every id through the scan and passes only scanner paths to the host', async () => {
    const { menu, host, fake } = setup()
    await expect(menu(['f7', 'd2'], 40, 90, true)).resolves.toEqual({ kind: 'dismissed' })
    expect(
      fake.queries.filter((query) => query.kind === 'node').map((query) => query.nodeId),
    ).toEqual(['f7', 'd2'])
    expect(host.requests).toEqual([
      {
        paths: ['D:\\Data\\Photos\\a.jpg', 'D:\\Data\\Docs'],
        x: 40,
        y: 90,
        extended: true,
        hideDestructive: false,
      },
    ])
  })

  it('dedupes ids and drops descendants of a selected ancestor', async () => {
    const { menu, host } = setup()
    await menu(['d1', 'f7', 'd2', 'd1', 'd3'])
    expect(host.requests[0]?.paths).toEqual(['D:\\Data\\Photos', 'D:\\Data\\Docs'])
  })

  it('drops the root and group rows when several rows are requested', async () => {
    const { menu, host } = setup()
    await menu(['d0', 'g1', 'd1', 'd2'])
    expect(host.requests[0]?.paths).toEqual(['D:\\Data\\Photos', 'D:\\Data\\Docs'])
    // Only unactionable rows: nothing to do.
    await expect(menu(['d0', 'g1'])).resolves.toEqual({ kind: 'dismissed' })
    expect(host.show).toHaveBeenCalledTimes(1)
  })

  it('keeps a single root request and sends hideDestructive', async () => {
    const { menu, host } = setup()
    await menu(['d0'])
    expect(host.requests[0]).toMatchObject({ paths: ['D:\\Data'], hideDestructive: true })
    await menu(['g1'])
    expect(host.requests[1]).toMatchObject({ paths: ['D:\\Data\\Photos'], hideDestructive: false })
  })

  it('drops ids that no longer resolve and returns gone when none do', async () => {
    const { menu, host } = setup()
    await menu(['f7', 'f99'])
    expect(host.requests[0]?.paths).toEqual(['D:\\Data\\Photos\\a.jpg'])
    await expect(menu(['f98', 'f99'])).resolves.toEqual({ kind: 'gone' })
    expect(host.show).toHaveBeenCalledTimes(1)
  })

  it('drops vanished paths, refreshes their folder and continues with the rest', async () => {
    const { menu, host, pathExists, deps } = setup()
    pathExists.mockImplementation(async (target) => target !== 'D:\\Data\\Docs\\b.txt')
    await menu(['f7', 'f9'])
    expect(host.requests[0]?.paths).toEqual(['D:\\Data\\Photos\\a.jpg'])
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d2'])
  })

  it('a second menu on a missing path refreshes and returns gone', async () => {
    const { menu, host, pathExists, deps } = setup()
    pathExists.mockResolvedValue(false)
    await expect(menu(['f7'])).resolves.toEqual({ kind: 'gone' })
    expect(host.show).not.toHaveBeenCalled()
    expect(refreshCalls(deps)).toEqual(['d1'])
  })

  it.each([0x80070002, 0x80070003])(
    'a shell menu that reports file-not-found returns gone (0x%x)',
    async (hresult) => {
      const { menu, deps, host } = setup()
      host.show.mockImplementation(() => ({
        chosen: Promise.reject(new ShellMenuError('SHParseDisplayName', hresult)),
        finished: new Promise<ShellFinish>(() => undefined),
      }))
      await expect(menu(['f7'])).resolves.toEqual({ kind: 'gone' })
      expect(refreshCalls(deps)).toEqual(['d1'])
    },
  )

  it('with several rows a file-not-found retries once with the paths that remain', async () => {
    const { menu, deps, host, pathExists } = setup()
    host.show.mockImplementationOnce(() => {
      // The item vanishes while the menu is being built.
      pathExists.mockImplementation(async (target) => target !== 'D:\\Data\\Docs\\b.txt')
      return {
        chosen: Promise.reject(new ShellMenuError('QueryContextMenu', 0x80070002)),
        finished: new Promise<ShellFinish>(() => undefined),
      }
    })
    await expect(menu(['f7', 'f9'])).resolves.toEqual({ kind: 'dismissed' })
    expect(host.show).toHaveBeenCalledTimes(2)
    // (the first, failing call was replaced by the mock and recorded nothing)
    expect(host.requests[0]?.paths).toEqual(['D:\\Data\\Photos\\a.jpg'])
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d2'])
  })

  it('any other menu error still rejects', async () => {
    const { menu, deps, host } = setup()
    const error = new ShellMenuError('GetUIObjectOf', 0x80004005)
    host.show.mockImplementation(() => ({
      chosen: Promise.reject(error),
      finished: new Promise<ShellFinish>(() => undefined),
    }))
    await expect(menu(['f7'])).rejects.toBe(error)
    expect(deps.refreshFolder).not.toHaveBeenCalled()
  })

  it('a ShellBusyError returns the busy outcome', async () => {
    const { menu, host } = setup()
    host.show.mockImplementation(() => {
      throw new ShellBusyError()
    })
    await expect(menu(['f7'])).resolves.toEqual({ kind: 'busy' })
  })

  it('refuses a request for another scan', async () => {
    const { handlers, host } = setup()
    await expect(
      Promise.resolve().then(() =>
        handlers['shell:context-menu'].handle(event, 'other', ['f7'], 0, 0, false),
      ),
    ).rejects.toThrow(NOT_IN_SCAN_MESSAGE)
    expect(host.show).not.toHaveBeenCalled()
  })
})

describe('shell:context-menu: StorageIQ items', () => {
  it('runs StorageIQ’s items for one row', async () => {
    let t = setup({ choice: { kind: 'storageiq', item: 'copy-path' } })
    await expect(t.menu(['f7'])).resolves.toEqual({ kind: 'copied', count: 1 })
    expect(t.deps.writeClipboard).toHaveBeenCalledWith('D:\\Data\\Photos\\a.jpg')

    t = setup({ choice: { kind: 'storageiq', item: 'refresh' } })
    await expect(t.menu(['f7'])).resolves.toEqual({ kind: 'refreshed', nodeId: 'd1' })
    expect(t.deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')

    t = setup({ choice: { kind: 'storageiq', item: 'open' } })
    await expect(t.menu(['d1'])).resolves.toEqual({ kind: 'opened' })
    expect(t.deps.openPath).toHaveBeenCalledWith('D:\\Data\\Photos')

    t = setup({ choice: { kind: 'storageiq', item: 'new-folder' }, existing: ['New folder'] })
    await expect(t.menu(['d1'])).resolves.toEqual({
      kind: 'created',
      nodeId: 'd1',
      name: 'New folder (2)',
    })
    expect(t.deps.mkdir).toHaveBeenCalledWith('D:\\Data\\Photos\\New folder (2)')
  })

  it('copy-path with several rows writes all paths joined by CRLF in request order and returns the count', async () => {
    const { menu, deps } = setup({ choice: { kind: 'storageiq', item: 'copy-path' } })
    await expect(menu(['f9', 'd1', 'f7'])).resolves.toEqual({ kind: 'copied', count: 2 })
    // f7 sits inside the selected folder d1, so it is not part of the action.
    expect(deps.writeClipboard).toHaveBeenCalledWith('D:\\Data\\Docs\\b.txt\r\nD:\\Data\\Photos')
    const second = setup({ choice: { kind: 'storageiq', item: 'copy-path' } })
    await expect(second.menu(['f9', 'f7'])).resolves.toEqual({ kind: 'copied', count: 2 })
    expect(second.deps.writeClipboard).toHaveBeenCalledWith(
      'D:\\Data\\Docs\\b.txt\r\nD:\\Data\\Photos\\a.jpg',
    )
  })

  it('open-in-explorer and new-folder are not offered for several rows', async () => {
    expect(storageiqMenuLabels(2, true).map((entry) => entry.item)).toEqual([
      'refresh',
      'copy-path',
    ])
    // A stale choice of those items still does nothing for several rows.
    for (const item of ['open', 'new-folder'] as const) {
      const t = setup({ choice: { kind: 'storageiq', item } })
      await expect(t.menu(['f7', 'f9'])).resolves.toEqual({ kind: 'dismissed' })
      expect(t.deps.openPath).not.toHaveBeenCalled()
      expect(t.deps.mkdir).not.toHaveBeenCalled()
    }
  })

  it('refresh with several rows refreshes each distinct containing folder', async () => {
    const { menu, deps } = setup({ choice: { kind: 'storageiq', item: 'refresh' } })
    await expect(menu(['f7', 'f10', 'f9'])).resolves.toEqual({ kind: 'refreshed', nodeId: 'd1' })
    expect(refreshCalls(deps)).toEqual(['d1', 'd2'])
  })
})

describe('shell:context-menu: shell commands', () => {
  it('returns the shell outcome as soon as the menu closes while the command is still running', async () => {
    const { menu, host, deps } = setup({ choice: DELETE })
    await expect(menu(['f7', 'f9'])).resolves.toEqual({
      kind: 'shell',
      verb: 'delete',
      changed: true,
      count: 2,
      running: true,
    })
    expect(host.finishes).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_000)
    // Windows has not finished: nothing is refreshed yet.
    expect(deps.refreshFolder).not.toHaveBeenCalled()
  })

  it('a second request is served while the first is still running', async () => {
    const { menu, host } = setup({ choice: DELETE })
    await menu(['f7'])
    await expect(menu(['f9'])).resolves.toMatchObject({ kind: 'shell', count: 1 })
    expect(host.show).toHaveBeenCalledTimes(2)
  })

  it('delete: refreshes each affected parent once after finished, then once more after the delay', async () => {
    const { menu, host, deps } = setup({ choice: DELETE })
    await menu(['f7', 'f9'])
    host.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d1', 'd2'])
    await vi.advanceTimersByTimeAsync(SECOND_REFRESH_DELAY_MS)
    expect(refreshCalls(deps)).toEqual(['d1', 'd2', 'd1', 'd2'])
  })

  it('delete: a failed finished still refreshes and logs the error', async () => {
    const { menu, host, deps } = setup({ choice: DELETE })
    await menu(['f7'])
    host.finishes[0]?.({ ok: false, hresult: 0x80270000, step: 'InvokeCommand' })
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d1'])
    expect(deps.warn).toHaveBeenCalledWith(
      'Shell delete did not finish cleanly',
      expect.objectContaining({ message: expect.stringContaining('InvokeCommand') }),
    )
  })

  it('delete with items in 60 folders refreshes their common ancestor instead', async () => {
    const extra: Record<string, TreeNodeDetails> = {
      d100: {
        row: row({ id: 'd100', name: 'Many' }),
        path: 'D:\\Data\\Many',
        ancestorIds: ['d0'],
        locations: [],
      },
    }
    const ids: string[] = []
    for (let i = 0; i < 60; i += 1) {
      const folder = `d${200 + i}`
      const file = `f${300 + i}`
      ids.push(file)
      extra[file] = {
        row: row({ id: file, parentId: `g${200 + i}`, kind: 'file', name: `${i}.txt` }),
        path: `D:\\Data\\Many\\${i}\\${i}.txt`,
        ancestorIds: ['d0', 'd100', folder, `g${200 + i}`],
        locations: [],
      }
    }
    const { menu, host, deps } = setup({ choice: DELETE, extra })
    await menu(ids)
    host.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d100'])
  })

  it('delete with an item at the root refreshes the root once and only when an item is gone', async () => {
    const { menu, host, deps, pathExists } = setup({ choice: DELETE })
    await menu(['d1'])
    // The command was cancelled: the item is still there, so no full rescan.
    host.finish()
    await vi.advanceTimersByTimeAsync(SECOND_REFRESH_DELAY_MS + 10)
    expect(deps.refreshFolder).not.toHaveBeenCalled()

    const second = setup({ choice: DELETE })
    await second.menu(['d1'])
    second.pathExists.mockResolvedValue(false)
    second.host.finish()
    await vi.advanceTimersByTimeAsync(SECOND_REFRESH_DELAY_MS + 10)
    expect(refreshCalls(second.deps)).toEqual(['d0'])
    expect(pathExists).toHaveBeenCalled()
  })

  it('refreshes a parent that appears twice only once', async () => {
    const { menu, host, deps } = setup({ choice: DELETE })
    await menu(['f7', 'f10'])
    host.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d1'])
  })

  it('a refresh for the same folder is never started while another is in flight', async () => {
    const { menu, host, deps } = setup({ choice: DELETE })
    const first = deferred<TreeNodeDetails | null>()
    vi.mocked(deps.refreshFolder).mockImplementationOnce(() => first.promise)
    await menu(['f7'])
    host.finish(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d1'])
    // A second action touches the same folder while the first rescan still runs.
    await menu(['f10'])
    host.finish(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d1'])
    first.resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d1', 'd1'])
  })

  it('cut and rename start a watchMany on all paths and refresh on settle', async () => {
    for (const verb of ['cut', 'rename', null]) {
      const { menu, deps, pathExists, watcher } = setup({
        choice: { kind: 'shell', verb, changed: true },
      })
      await menu(['f7', 'f9'])
      expect(watcher.active).toBe(1)
      expect(deps.refreshFolder).not.toHaveBeenCalled()
      pathExists.mockImplementation(async (target) => target.endsWith('b.txt') === false)
      await vi.advanceTimersByTimeAsync(ITEM_POLL_INTERVAL_MS)
      expect(deps.refreshFolder).not.toHaveBeenCalled()
      pathExists.mockResolvedValue(false)
      await vi.advanceTimersByTimeAsync(ITEM_POLL_INTERVAL_MS)
      expect(refreshCalls(deps)).toEqual(['d1', 'd2'])
      expect(watcher.active).toBe(0)
    }
  })

  it('a cancelled cut at the root does not rescan the whole root when the watch times out', async () => {
    const { menu, deps, watcher } = setup({ choice: { kind: 'shell', verb: 'cut', changed: true } })
    await menu(['d1'])
    await vi.advanceTimersByTimeAsync(ITEM_WATCH_TIMEOUT_MS + ITEM_POLL_INTERVAL_MS)
    expect(watcher.active).toBe(0)
    expect(deps.refreshFolder).not.toHaveBeenCalled()
  })

  it('other changing verbs refresh now and once more after the delay', async () => {
    const { menu, deps, pathExists } = setup({
      choice: { kind: 'shell', verb: 'paste', changed: true },
    })
    await menu(['f7'])
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d1'])
    await vi.advanceTimersByTimeAsync(SECOND_REFRESH_DELAY_MS)
    expect(refreshCalls(deps)).toEqual(['d1', 'd1'])
    // Only the gone pre-check ran; the watcher never polled.
    expect(pathExists).toHaveBeenCalledTimes(1)
  })

  it('a read-only verb refreshes nothing', async () => {
    const { menu, deps, watcher } = setup({
      choice: { kind: 'shell', verb: 'properties', changed: false },
    })
    await expect(menu(['f7'])).resolves.toMatchObject({ kind: 'shell', changed: false })
    expect(deps.refreshFolder).not.toHaveBeenCalled()
    expect(watcher.active).toBe(0)
  })

  it('a new scan cancels the pending refreshes', async () => {
    const { menu, host, deps, fake } = setup({ choice: DELETE })
    await menu(['f7'])
    host.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d1'])
    fake.service.currentScan = () => ({ scanId: 'another-scan', root: 'D:\\Data' })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(refreshCalls(deps)).toEqual(['d1'])

    // A watch is cancelled too.
    const watched = setup({ choice: { kind: 'shell', verb: 'cut', changed: true } })
    await watched.menu(['f7'])
    expect(watched.watcher.active).toBe(1)
    watched.fake.service.currentScan = () => ({ scanId: 'another-scan', root: 'D:\\Data' })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(watched.watcher.active).toBe(0)
    expect(watched.deps.refreshFolder).not.toHaveBeenCalled()
  })

  it('refresh failures are logged, not swallowed', async () => {
    const { menu, deps } = setup({ choice: { kind: 'shell', verb: 'paste', changed: true } })
    const failure = new Error('rescan failed')
    vi.mocked(deps.refreshFolder).mockRejectedValue(failure)
    await expect(menu(['f7'])).resolves.toMatchObject({ kind: 'shell', verb: 'paste' })
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.warn).toHaveBeenCalledWith('Refresh after shell command failed', failure)
  })
})

describe('folder:create', () => {
  it('creates "New folder" in a folder, or in a file’s folder', async () => {
    const { handlers, deps } = setup()
    await expect(
      Promise.resolve(handlers['folder:create'].handle(event, SCAN, 'f7')),
    ).resolves.toEqual({
      parentId: 'd1',
      name: 'New folder',
    })
    expect(deps.readdir).toHaveBeenCalledWith('D:\\Data\\Photos')
    expect(deps.mkdir).toHaveBeenCalledWith('D:\\Data\\Photos\\New folder')
    expect(deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')
  })

  it('waits for the scan to finish', async () => {
    const { handlers, deps } = setup({ scanning: true })
    await expect(
      Promise.resolve().then(() => handlers['folder:create'].handle(event, SCAN, 'd1')),
    ).rejects.toThrow(SCAN_RUNNING_MESSAGE)
    expect(deps.mkdir).not.toHaveBeenCalled()
  })
})

describe('clipboard:copy-path', () => {
  it('copies the paths the scanner holds for the nodes, never renderer text', async () => {
    const { handlers, deps } = setup()
    await handlers['clipboard:copy-path'].handle(event, SCAN, ['f7'])
    expect(deps.writeClipboard).toHaveBeenCalledWith('D:\\Data\\Photos\\a.jpg')
    await handlers['clipboard:copy-path'].handle(event, SCAN, ['f9', 'd1', 'f7'])
    expect(deps.writeClipboard).toHaveBeenLastCalledWith(
      'D:\\Data\\Docs\\b.txt\r\nD:\\Data\\Photos\r\nD:\\Data\\Photos\\a.jpg',
    )
    expect(() => handlers['clipboard:copy-path'].parseArgs(['D:\\Data'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => handlers['clipboard:copy-path'].parseArgs([SCAN, ['C:\\Windows']])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => handlers['clipboard:copy-path'].parseArgs([SCAN, 'f7'])).toThrow(
      InvalidIpcArgumentsError,
    )
  })

  it('refuses a node of another scan', async () => {
    const { handlers, deps } = setup()
    await expect(
      Promise.resolve().then(() => handlers['clipboard:copy-path'].handle(event, 'other', ['d1'])),
    ).rejects.toThrow(NOT_IN_SCAN_MESSAGE)
    expect(deps.writeClipboard).not.toHaveBeenCalled()
  })
})

describe('menu refresh of the scan root', () => {
  it('announces the new scan with scan:restarted before its progress', async () => {
    const fake = fakeTreeService()
    const events: Array<[string, unknown]> = []
    const refreshFolder = createFolderRefresher(
      fake.service,
      (channel, payload) => {
        events.push([channel, payload])
      },
      fake.volumeFor,
    )
    const host = fakeHost(DELETE)
    let exists = true
    const handlers = createShellHandlers({
      scanService: fake.service,
      refreshFolder,
      openPath: async () => '',
      showItemInFolder: () => undefined,
      writeClipboard: () => undefined,
      readdir: async () => [],
      mkdir: async () => undefined,
      showShellMenu: host.show,
      deleteShellItems: host.deleteItems,
      emptyRecycleBin: host.emptyBin,
      userSid: vi.fn(async () => 'S-1-5-21-1-2-3-1001'),
      realPath: vi.fn(async (target: string) => target),
      pathExists: async () => exists,
      watcher: createItemWatcher({
        pathExists: async () => exists,
        schedule: () => () => undefined,
        now: () => 0,
      }),
      warn: () => undefined,
    })
    await handlers['shell:context-menu'].handle(event, SCAN, ['d1'], 0, 0, false)
    // Windows moved the item away, then reported that the command finished: the root is rescanned.
    exists = false
    host.finish()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() =>
      expect(events).toEqual([['scan:restarted', { scanId: 'rescan-1', root: 'D:\\Data' }]]),
    )
  })
})

describe('shell:delete', () => {
  it('resolves ids through the scan and sends only scanner paths with the permanent flag', async () => {
    const { remove, host } = setup()
    await expect(remove(['f7', 'd2'], true)).resolves.toEqual({
      kind: 'shell',
      verb: 'delete',
      changed: true,
      count: 2,
      running: true,
    })
    expect(host.deletes).toEqual([
      { paths: ['D:\\Data\\Photos\\a.jpg', 'D:\\Data\\Docs'], permanent: true },
    ])
    await remove(['f7'], false)
    expect(host.deletes[1]).toEqual({ paths: ['D:\\Data\\Photos\\a.jpg'], permanent: false })
  })

  it('never deletes the root, a group row or a drive root, even alone', async () => {
    const { remove, host } = setup()
    await expect(remove(['d0'])).resolves.toEqual({ kind: 'dismissed' })
    await expect(remove(['g1'])).resolves.toEqual({ kind: 'dismissed' })
    await remove(['d0', 'g1', 'd1'])
    expect(host.deletes).toEqual([{ paths: ['D:\\Data\\Photos'], permanent: false }])
  })

  it('drops descendants of a selected ancestor', async () => {
    const { remove, host } = setup()
    await remove(['d1', 'f7', 'd2'])
    expect(host.deletes[0]?.paths).toEqual(['D:\\Data\\Photos', 'D:\\Data\\Docs'])
  })

  it('returns gone when no id resolves or nothing exists on disk', async () => {
    const { remove, host, pathExists } = setup()
    await expect(remove(['f98'])).resolves.toEqual({ kind: 'gone' })
    pathExists.mockResolvedValue(false)
    await expect(remove(['f7'])).resolves.toEqual({ kind: 'gone' })
    expect(host.deleteItems).not.toHaveBeenCalled()
  })

  it('returns busy on ShellBusyError and rejects other errors', async () => {
    const { remove, host } = setup()
    host.deleteItems.mockImplementationOnce(() => {
      throw new ShellBusyError()
    })
    await expect(remove(['f7'])).resolves.toEqual({ kind: 'busy' })
    host.deleteItems.mockImplementationOnce(() => {
      throw new Error('disposed')
    })
    await expect(remove(['f7'])).rejects.toThrow('disposed')
  })

  it('refuses another scan and a running scan', async () => {
    const { remove, host } = setup()
    await expect(remove(['f7'], false, 'other')).rejects.toThrow(NOT_IN_SCAN_MESSAGE)
    const running = setup({ scanning: true })
    await expect(running.remove(['f7'])).rejects.toThrow(SCAN_RUNNING_MESSAGE)
    expect(host.deleteItems).not.toHaveBeenCalled()
    expect(running.host.deleteItems).not.toHaveBeenCalled()
  })

  it('refreshes the folders once the command finished, like a menu delete', async () => {
    const { remove, host, deps, pathExists } = setup()
    await remove(['f7'])
    expect(deps.refreshFolder).not.toHaveBeenCalled()
    pathExists.mockResolvedValue(false)
    host.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['d1'])
  })

  it('parses its arguments with the strict boolean', () => {
    const { handlers } = setup()
    expect(() => handlers['shell:delete'].parseArgs([SCAN, ['d1'], 'yes'])).toThrow(
      InvalidIpcArgumentsError,
    )
  })
})

describe('shell:delete: Recycle Bin folders', () => {
  const SID = 'S-1-5-21-1-2-3-1001'
  const node = (
    id: string,
    target: string,
    ancestorIds: string[] = ['d0'],
    kind: 'folder' | 'file' = 'folder',
  ): TreeNodeDetails => ({
    row: row({ id, kind, name: target.split('\\').at(-1) ?? target }),
    path: target,
    ancestorIds,
    locations: [],
  })
  const extra = {
    b1: node('b1', 'D:\\$RECYCLE.BIN'),
    b2: node('b2', `D:\\$recycle.bin\\${SID}`, ['d0', 'b1']),
    b3: node('b3', 'E:\\$RECYCLE.BIN'),
    b4: node('b4', `D:\\$RECYCLE.BIN\\${SID}\\sub`),
    other: node('other', 'D:\\$RECYCLE.BIN\\S-1-5-21-1-2-3-1002'),
    ini: node('ini', 'D:\\$RECYCLE.BIN\\desktop.ini', ['d0', 'b1'], 'file'),
    named: node('named', 'D:\\$RECYCLE.BIN\\Backup'),
  }

  it('empties the drive Recycle Bin instead of walking the folder', async () => {
    const { remove, host } = setup({ extra })
    await expect(remove(['b1'], false)).resolves.toMatchObject({ kind: 'shell', count: 1 })
    expect(host.empties).toEqual(['D:\\'])
    expect(host.deleteItems).not.toHaveBeenCalled()
  })

  it('does the same for Shift+Delete and for the current user folder in the bin', async () => {
    const { remove, host } = setup({ extra })
    await remove(['b2'], true)
    expect(host.empties).toEqual(['D:\\'])
    expect(host.deleteItems).not.toHaveBeenCalled()
  })

  it.each(['other', 'ini', 'named', 'b4'])(
    'anything else inside the bin (%s) is an ordinary delete of exactly that item',
    async (id) => {
      const { remove, host } = setup({ extra })
      await remove([id], false)
      expect(host.empties).toEqual([])
      expect(host.deletes[0]?.paths).toEqual([extra[id as keyof typeof extra].path])
    },
  )

  it('with an unknown user SID only the bin folder itself is emptied', async () => {
    const { remove, host, deps } = setup({ extra })
    vi.mocked(deps.userSid).mockResolvedValue(null)
    await remove(['b2'], false)
    expect(host.empties).toEqual([])
    await remove(['b1'], false)
    expect(host.empties).toEqual(['D:\\'])
  })

  it('a path whose real location is elsewhere (SUBST, junction) is an ordinary delete', async () => {
    const { remove, host, deps } = setup({ extra })
    vi.mocked(deps.realPath).mockResolvedValue('C:\\Backups\\OldDisk\\$RECYCLE.BIN')
    await remove(['b1'], false)
    expect(host.empties).toEqual([])
    expect(host.deletes[0]?.paths).toEqual(['D:\\$RECYCLE.BIN'])
    vi.mocked(deps.realPath).mockResolvedValue('E:\\$RECYCLE.BIN')
    await remove(['b1'], false)
    expect(host.empties).toEqual([])
    vi.mocked(deps.realPath).mockRejectedValue(new Error('EPERM'))
    await remove(['b1'], false)
    expect(host.empties).toEqual([])
  })

  it('empties each drive once, in order, and goes on after a failure', async () => {
    const { remove, host, deps } = setup({ extra })
    host.emptyBin.mockImplementationOnce(async (root) => {
      host.empties.push(root)
      return { ok: false, hresult: 5, step: 'SHEmptyRecycleBinW' }
    })
    await remove(['b1', 'b2', 'b3'], false)
    await vi.advanceTimersByTimeAsync(0)
    expect(host.empties).toEqual(['D:\\', 'E:\\'])
    expect(deps.warn).toHaveBeenCalledTimes(1)
  })

  it('refuses a bin selected together with other rows, and acts on nothing', async () => {
    const { remove, host } = setup({ extra })
    await expect(remove(['b1', 'd2'], false)).resolves.toEqual({ kind: 'bin-mixed' })
    expect(host.empties).toEqual([])
    expect(host.deleteItems).not.toHaveBeenCalled()
  })

  it('a busy pool returns busy', async () => {
    const { remove, host } = setup({ extra })
    host.emptyBin.mockImplementationOnce(() => {
      throw new ShellBusyError()
    })
    await expect(remove(['b1'], false)).resolves.toEqual({ kind: 'busy' })
  })

  it('refreshes the bin folder itself once it was emptied, not the drive root', async () => {
    const { remove, deps } = setup({ extra })
    await remove(['b1'], false)
    expect(deps.refreshFolder).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshCalls(deps)).toEqual(['b1'])
    await vi.advanceTimersByTimeAsync(SECOND_REFRESH_DELAY_MS)
    expect(refreshCalls(deps)).toEqual(['b1', 'b1'])
  })
})

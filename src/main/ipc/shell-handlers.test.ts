import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellMenuChoice } from '../shell-menu/context-menu'
import { ShellMenuError } from '../shell-menu/win-shell-menu'
import { createItemWatcher, ITEM_POLL_INTERVAL_MS, ITEM_WATCH_TIMEOUT_MS } from './item-watcher'
import { InvalidIpcArgumentsError } from './parse-args'
import {
  createShellHandlers,
  SECOND_REFRESH_DELAY_MS,
  type ShellHandlerDeps,
} from './shell-handlers'
import { createFolderRefresher } from './tree-handlers'
import { fakeTreeService, NODES, SCAN } from './test/fake-tree-service'
import { NOT_IN_SCAN_MESSAGE, SCAN_RUNNING_MESSAGE } from './tree-handlers'

const event = {} as IpcMainInvokeEvent

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function setup(
  options: { choice?: ShellMenuChoice; scanning?: boolean; existing?: string[] } = {},
) {
  const fake = fakeTreeService({ scanning: options.scanning ?? false })
  const pathExists = vi.fn(async () => true)
  const watcher = createItemWatcher({
    pathExists,
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
    now: () => Date.now(),
  })
  const deps: ShellHandlerDeps = {
    scanService: fake.service,
    refreshFolder: vi.fn(async (_scanId: string, nodeId: string) => NODES[nodeId] ?? null),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    writeClipboard: vi.fn(),
    readdir: vi.fn(async () => options.existing ?? ['a.jpg']),
    mkdir: vi.fn(async () => undefined),
    showShellMenu: vi.fn(
      async (): Promise<ShellMenuChoice> => options.choice ?? { kind: 'dismissed' },
    ),
    pathExists,
    watcher,
    warn: vi.fn(),
  }
  return { deps, fake, pathExists, watcher, handlers: createShellHandlers(deps) }
}

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

describe('shell:context-menu', () => {
  it('shows the menu for the node’s own path at the given window point', async () => {
    const { handlers, deps } = setup()
    await expect(
      Promise.resolve(handlers['shell:context-menu'].handle(event, SCAN, 'f7', 40, 90, true)),
    ).resolves.toEqual({ kind: 'dismissed' })
    expect(deps.showShellMenu).toHaveBeenCalledWith('D:\\Data\\Photos\\a.jpg', 40, 90, true)
  })

  it('runs StorageIQ’s items', async () => {
    let t = setup({ choice: { kind: 'storageiq', item: 'copy-path' } })
    await expect(
      t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false),
    ).resolves.toEqual({
      kind: 'copied',
    })
    expect(t.deps.writeClipboard).toHaveBeenCalledWith('D:\\Data\\Photos\\a.jpg')

    t = setup({ choice: { kind: 'storageiq', item: 'refresh' } })
    await expect(
      t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false),
    ).resolves.toEqual({
      kind: 'refreshed',
      nodeId: 'd1',
    })
    expect(t.deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')

    t = setup({ choice: { kind: 'storageiq', item: 'open' } })
    await expect(
      t.handlers['shell:context-menu'].handle(event, SCAN, 'd1', 0, 0, false),
    ).resolves.toEqual({
      kind: 'opened',
    })
    expect(t.deps.openPath).toHaveBeenCalledWith('D:\\Data\\Photos')

    t = setup({ choice: { kind: 'storageiq', item: 'new-folder' }, existing: ['New folder'] })
    await expect(
      t.handlers['shell:context-menu'].handle(event, SCAN, 'd1', 0, 0, false),
    ).resolves.toEqual({
      kind: 'created',
      nodeId: 'd1',
      name: 'New folder (2)',
    })
    expect(t.deps.mkdir).toHaveBeenCalledWith('D:\\Data\\Photos\\New folder (2)')
  })

  it('delete that completes late: the folder is refreshed after the item disappears', async () => {
    const { handlers, deps, pathExists, watcher } = setup({
      choice: { kind: 'shell', verb: 'delete', changed: true },
    })
    await handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(deps.refreshFolder).toHaveBeenCalledTimes(1)
    expect(deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(deps.refreshFolder).toHaveBeenCalledTimes(1)
    pathExists.mockResolvedValue(false)
    await vi.advanceTimersByTimeAsync(ITEM_POLL_INTERVAL_MS)
    expect(deps.refreshFolder).toHaveBeenCalledTimes(2)
    expect(deps.refreshFolder).toHaveBeenLastCalledWith(SCAN, 'd1')
    expect(watcher.active).toBe(0)
  })

  it('delete that never finishes is refreshed once at the timeout', async () => {
    const { handlers, deps } = setup({ choice: { kind: 'shell', verb: 'delete', changed: true } })
    await handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    await vi.advanceTimersByTimeAsync(ITEM_WATCH_TIMEOUT_MS)
    expect(deps.refreshFolder).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(deps.refreshFolder).toHaveBeenCalledTimes(2)
  })

  it('root-level delete does not queue two full rescans', async () => {
    const { handlers, deps, pathExists, watcher } = setup({
      choice: { kind: 'shell', verb: 'delete', changed: true },
    })
    await expect(
      Promise.resolve(handlers['shell:context-menu'].handle(event, SCAN, 'd1', 0, 0, false)),
    ).resolves.toEqual({ kind: 'shell', verb: 'delete', changed: true })
    expect(deps.refreshFolder).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    pathExists.mockResolvedValue(false)
    await vi.advanceTimersByTimeAsync(ITEM_POLL_INTERVAL_MS)
    expect(deps.refreshFolder).toHaveBeenCalledTimes(1)
    expect(deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd0')
    expect(watcher.active).toBe(0)
  })

  it('a cancelled root-level delete does not rescan the whole root when the watch times out', async () => {
    const { handlers, deps, watcher } = setup({
      choice: { kind: 'shell', verb: 'delete', changed: true },
    })
    await handlers['shell:context-menu'].handle(event, SCAN, 'd1', 0, 0, false)
    // The item never disappears (the user cancelled the dialog): the watch ends by timeout.
    await vi.advanceTimersByTimeAsync(ITEM_WATCH_TIMEOUT_MS + ITEM_POLL_INTERVAL_MS)
    expect(watcher.active).toBe(0)
    expect(deps.refreshFolder).not.toHaveBeenCalled()
  })

  it('a verb that leaves the item in place still refreshes twice', async () => {
    const { handlers, deps, pathExists } = setup({
      choice: { kind: 'shell', verb: 'paste', changed: true },
    })
    await handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(deps.refreshFolder).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(SECOND_REFRESH_DELAY_MS)
    expect(deps.refreshFolder).toHaveBeenCalledTimes(2)
    expect(deps.refreshFolder).toHaveBeenLastCalledWith(SCAN, 'd1')
    // Only the gone pre-check ran; the watcher never polled.
    expect(pathExists).toHaveBeenCalledTimes(1)
  })

  it('a second menu on a missing path refreshes and returns gone', async () => {
    const { handlers, deps, pathExists } = setup({ choice: { kind: 'dismissed' } })
    pathExists.mockResolvedValue(false)
    await expect(
      Promise.resolve(handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)),
    ).resolves.toEqual({ kind: 'gone' })
    expect(deps.showShellMenu).not.toHaveBeenCalled()
    expect(deps.refreshFolder).toHaveBeenCalledTimes(1)
    expect(deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')
  })

  it.each([0x80070002, 0x80070003])(
    'a shell menu that reports file-not-found returns gone (0x%x)',
    async (hresult) => {
      const { handlers, deps } = setup()
      vi.mocked(deps.showShellMenu).mockRejectedValue(
        new ShellMenuError('SHParseDisplayName', hresult),
      )
      await expect(
        Promise.resolve(handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)),
      ).resolves.toEqual({ kind: 'gone' })
      expect(deps.refreshFolder).toHaveBeenCalledTimes(1)
    },
  )

  it('any other menu error still rejects', async () => {
    const { handlers, deps } = setup()
    const error = new ShellMenuError('GetUIObjectOf', 0x80004005)
    vi.mocked(deps.showShellMenu).mockRejectedValue(error)
    await expect(
      Promise.resolve().then(() =>
        handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false),
      ),
    ).rejects.toBe(error)
    expect(deps.refreshFolder).not.toHaveBeenCalled()
  })

  it('the watcher is cancelled when a new scan starts', async () => {
    const { handlers, deps, fake, watcher } = setup({
      choice: { kind: 'shell', verb: 'delete', changed: true },
    })
    await handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(watcher.active).toBe(1)
    fake.service.currentScan = () => ({ scanId: 'another-scan', root: 'D:\\Data' })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(deps.refreshFolder).toHaveBeenCalledTimes(1)
    expect(watcher.active).toBe(0)
  })

  it('refresh failures are logged, not swallowed', async () => {
    const { handlers, deps } = setup({ choice: { kind: 'shell', verb: 'paste', changed: true } })
    const failure = new Error('rescan failed')
    vi.mocked(deps.refreshFolder).mockRejectedValue(failure)
    await expect(
      Promise.resolve(handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)),
    ).resolves.toEqual({ kind: 'shell', verb: 'paste', changed: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.warn).toHaveBeenCalledWith('Refresh after shell command failed', failure)
  })

  it('rescans a file’s own folder after a change, and nothing after a read-only verb', async () => {
    let t = setup({ choice: { kind: 'shell', verb: null, changed: true } })
    await t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(t.deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')

    t = setup({ choice: { kind: 'shell', verb: 'properties', changed: false } })
    await t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(t.deps.refreshFolder).not.toHaveBeenCalled()
    expect(t.watcher.active).toBe(0)
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
  it('copies the path the scanner holds for the node, never renderer text', async () => {
    const { handlers, deps } = setup()
    await handlers['clipboard:copy-path'].handle(event, SCAN, 'f7')
    expect(deps.writeClipboard).toHaveBeenCalledWith('D:\\Data\\Photos\\a.jpg')
    expect(() => handlers['clipboard:copy-path'].parseArgs(['D:\\Data'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => handlers['clipboard:copy-path'].parseArgs([SCAN, 'C:\\Windows'])).toThrow(
      InvalidIpcArgumentsError,
    )
  })

  it('refuses a node of another scan', async () => {
    const { handlers, deps } = setup()
    await expect(
      Promise.resolve().then(() => handlers['clipboard:copy-path'].handle(event, 'other', 'd1')),
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
    const handlers = createShellHandlers({
      scanService: fake.service,
      refreshFolder,
      openPath: async () => '',
      showItemInFolder: () => undefined,
      writeClipboard: () => undefined,
      readdir: async () => [],
      mkdir: async () => undefined,
      showShellMenu: async () => ({ kind: 'shell', verb: 'delete', changed: true }),
      // The item is already gone, so the watcher settles at once and rescans the root.
      pathExists: async () => false,
      watcher: createItemWatcher({
        pathExists: async () => false,
        schedule: () => () => undefined,
        now: () => 0,
      }),
      warn: () => undefined,
    })
    await handlers['shell:context-menu'].handle(event, SCAN, 'd1', 0, 0, false)
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() =>
      expect(events).toEqual([['scan:restarted', { scanId: 'rescan-1', root: 'D:\\Data' }]]),
    )
  })
})

import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ShellMenuChoice } from '../shell-menu/context-menu'
import { InvalidIpcArgumentsError } from './parse-args'
import {
  createShellHandlers,
  SECOND_REFRESH_DELAY_MS,
  type ShellHandlerDeps,
} from './shell-handlers'
import { fakeTreeService, NODES, SCAN } from './test/fake-tree-service'
import { NOT_IN_SCAN_MESSAGE, SCAN_RUNNING_MESSAGE } from './tree-handlers'

const event = {} as IpcMainInvokeEvent

function setup(
  options: { choice?: ShellMenuChoice; scanning?: boolean; existing?: string[] } = {},
) {
  const fake = fakeTreeService({ scanning: options.scanning ?? false })
  const timers: Array<{ callback: () => void; ms: number }> = []
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
    later: (callback, ms) => {
      timers.push({ callback, ms })
    },
  }
  return { deps, timers, handlers: createShellHandlers(deps) }
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

  it('rescans the parent folder now and again shortly after a shell command that changes files', async () => {
    const { handlers, deps, timers } = setup({
      choice: { kind: 'shell', verb: 'delete', changed: true },
    })
    await expect(
      Promise.resolve(handlers['shell:context-menu'].handle(event, SCAN, 'd1', 0, 0, false)),
    ).resolves.toEqual({ kind: 'shell', verb: 'delete', changed: true })
    // The parent is the scan root: one rescan, no delayed second full pass.
    expect(deps.refreshFolder).toHaveBeenCalledTimes(1)
    expect(deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd0')
    expect(timers).toEqual([])
  })

  it('rescans a non-root parent folder now and again shortly after', async () => {
    const { handlers, deps, timers } = setup({
      choice: { kind: 'shell', verb: 'delete', changed: true },
    })
    await handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')
    expect(timers.map((timer) => timer.ms)).toEqual([SECOND_REFRESH_DELAY_MS])
    timers[0]?.callback()
    expect(deps.refreshFolder).toHaveBeenCalledTimes(2)
  })

  it('rescans a file’s own folder after a change, and nothing after a read-only verb', async () => {
    let t = setup({ choice: { kind: 'shell', verb: null, changed: true } })
    await t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(t.deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')

    t = setup({ choice: { kind: 'shell', verb: 'properties', changed: false } })
    await t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(t.deps.refreshFolder).not.toHaveBeenCalled()
    expect(t.timers).toEqual([])
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

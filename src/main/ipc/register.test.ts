import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppInfo } from '@shared/ipc-contract'
import {
  childrenArgs,
  contextMenuArgs,
  expandArgs,
  InvalidIpcArgumentsError,
  nodeArgs,
  noArgs,
  oneString,
  scanNodeArgs,
  treemapArgs,
} from './parse-args'
import {
  type IpcHandlerMap,
  type IpcRegistrar,
  registerIpcHandlers,
  UntrustedSenderError,
} from './register'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const appInfo: AppInfo = {
  name: 'StorageIQ',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '38.0.0',
}

function createHandlers(overrides: Partial<IpcHandlerMap> = {}): IpcHandlerMap {
  return {
    'app:get-info': { parseArgs: noArgs, handle: () => appInfo },
    'app:quit': { parseArgs: noArgs, handle: () => undefined },
    'dialog:select-folder': { parseArgs: noArgs, handle: () => ({ canceled: true }) },
    'drives:list': { parseArgs: noArgs, handle: () => [] },
    'drive:info': { parseArgs: oneString, handle: () => null },
    'places:list': { parseArgs: noArgs, handle: () => ({ places: [], recent: [] }) },
    'scan:start': { parseArgs: oneString, handle: () => ({ scanId: 'scan-1' }) },
    'scan:cancel': { parseArgs: oneString, handle: () => undefined },
    'tree:children': { parseArgs: childrenArgs, handle: () => null },
    'tree:node': { parseArgs: nodeArgs, handle: () => null },
    'tree:expand-ids': { parseArgs: expandArgs, handle: () => [] },
    'tree:refresh': { parseArgs: scanNodeArgs, handle: () => null },
    'treemap:layout': { parseArgs: treemapArgs, handle: () => null },
    'shell:open-in-explorer': { parseArgs: scanNodeArgs, handle: () => undefined },
    'shell:context-menu': { parseArgs: contextMenuArgs, handle: () => ({ kind: 'dismissed' }) },
    'folder:create': { parseArgs: scanNodeArgs, handle: () => ({ parentId: 'd0', name: 'x' }) },
    'clipboard:copy-path': { parseArgs: scanNodeArgs, handle: () => undefined },
    ...overrides,
  }
}

function createFakeIpc(): IpcRegistrar & { listeners: Map<string, Listener> } {
  const listeners = new Map<string, Listener>()
  return {
    listeners,
    handle(channel, listener) {
      listeners.set(channel, listener)
    },
  }
}

function eventFrom(url: string): IpcMainInvokeEvent {
  return { senderFrame: { url } } as unknown as IpcMainInvokeEvent
}

const TRUSTED = 'app://trusted/index.html'
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED

function call(
  ipc: ReturnType<typeof createFakeIpc>,
  channel: string,
  url: string,
  args: unknown[],
) {
  const listener = ipc.listeners.get(channel)
  if (!listener) throw new Error(`no listener for ${channel}`)
  return Promise.resolve(listener(eventFrom(url), ...args))
}

describe('registerIpcHandlers', () => {
  it('registers exactly one listener per contract channel', () => {
    const ipc = createFakeIpc()
    registerIpcHandlers(ipc, createHandlers(), isTrusted)
    expect([...ipc.listeners.keys()].sort()).toEqual([
      'app:get-info',
      'app:quit',
      'clipboard:copy-path',
      'dialog:select-folder',
      'drive:info',
      'drives:list',
      'folder:create',
      'places:list',
      'scan:cancel',
      'scan:start',
      'shell:context-menu',
      'shell:open-in-explorer',
      'tree:children',
      'tree:expand-ids',
      'tree:node',
      'tree:refresh',
      'treemap:layout',
    ])
  })

  it('forwards calls from trusted senders to the handler', async () => {
    const ipc = createFakeIpc()
    registerIpcHandlers(ipc, createHandlers(), isTrusted)
    await expect(call(ipc, 'app:get-info', TRUSTED, [])).resolves.toEqual(appInfo)
  })

  it('rejects calls from untrusted senders without parsing or running the handler', async () => {
    const ipc = createFakeIpc()
    const parseArgs = vi.fn(noArgs)
    const handle = vi.fn(() => appInfo)
    registerIpcHandlers(ipc, createHandlers({ 'app:get-info': { parseArgs, handle } }), isTrusted)

    await expect(call(ipc, 'app:get-info', 'https://evil.example/', [])).rejects.toThrow(
      UntrustedSenderError,
    )
    expect(parseArgs).not.toHaveBeenCalled()
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects malformed arguments without running the handler', async () => {
    const ipc = createFakeIpc()
    const handle = vi.fn(() => appInfo)
    registerIpcHandlers(
      ipc,
      createHandlers({ 'app:get-info': { parseArgs: noArgs, handle } }),
      isTrusted,
    )

    await expect(call(ipc, 'app:get-info', TRUSTED, ['unexpected'])).rejects.toThrow(
      InvalidIpcArgumentsError,
    )
    expect(handle).not.toHaveBeenCalled()
  })

  it('waits for an asynchronous parseArgs and stops when it rejects', async () => {
    const ipc = createFakeIpc()
    const handle = vi.fn(() => appInfo)
    const parseArgs = vi.fn(async (): Promise<[]> =>
      Promise.reject(new InvalidIpcArgumentsError('not today')),
    )
    registerIpcHandlers(ipc, createHandlers({ 'app:get-info': { parseArgs, handle } }), isTrusted)

    await expect(call(ipc, 'app:get-info', TRUSTED, [])).rejects.toThrow(
      'Invalid IPC arguments: not today',
    )
    expect(parseArgs).toHaveBeenCalledWith([])
    expect(handle).not.toHaveBeenCalled()
  })

  it('passes the parsed arguments, not the raw ones, to the handler', async () => {
    const ipc = createFakeIpc()
    const handle = vi.fn(() => ({ scanId: 'scan-1' }))
    registerIpcHandlers(
      ipc,
      createHandlers({
        'scan:start': { parseArgs: (args) => [String(args[0]).toUpperCase()], handle },
      }),
      isTrusted,
    )

    await call(ipc, 'scan:start', TRUSTED, ['c:\\data'])

    expect(handle).toHaveBeenCalledWith(expect.anything(), 'C:\\DATA')
  })
})

import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppInfo } from '@shared/ipc-contract'
import {
  childrenArgs,
  contextMenuArgs,
  expandArgs,
  iconNodesArgs,
  iconTypesArgs,
  InvalidIpcArgumentsError,
  nodeArgs,
  noArgs,
  aboutLinkArg,
  oneString,
  scanNodeArgs,
  scanNodesArgs,
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
  chromeVersion: '140.0.0',
  channel: 'Stable',
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
    'icons:for-nodes': {
      parseArgs: iconNodesArgs,
      handle: () => ({ keys: {}, images: {}, pending: [] }),
    },
    'icons:for-types': { parseArgs: iconTypesArgs, handle: () => ({}) },
    'update:install': { parseArgs: noArgs, handle: () => undefined },
    'update:get-state': { parseArgs: noArgs, handle: () => ({ kind: 'idle' }) },
    'update:check': { parseArgs: noArgs, handle: () => ({ kind: 'idle' }) },
    'update:download': { parseArgs: noArgs, handle: () => undefined },
    'update:get-release-notes': { parseArgs: noArgs, handle: () => null },
    'app:get-changelog': { parseArgs: noArgs, handle: () => [] },
    'app:open-notices': { parseArgs: noArgs, handle: () => ({ opened: true }) },
    'app:open-link': { parseArgs: aboutLinkArg, handle: () => undefined },
    'app:get-whats-new-due': { parseArgs: noArgs, handle: () => null },
    'app:mark-whats-new-seen': { parseArgs: noArgs, handle: () => undefined },
    'shell:open-in-explorer': { parseArgs: scanNodeArgs, handle: () => undefined },
    'shell:context-menu': { parseArgs: contextMenuArgs, handle: () => ({ kind: 'dismissed' }) },
    'folder:create': { parseArgs: scanNodeArgs, handle: () => ({ parentId: 'd0', name: 'x' }) },
    'clipboard:copy-path': { parseArgs: scanNodesArgs, handle: () => undefined },
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
      'app:get-changelog',
      'app:get-info',
      'app:get-whats-new-due',
      'app:mark-whats-new-seen',
      'app:open-link',
      'app:open-notices',
      'app:quit',
      'clipboard:copy-path',
      'dialog:select-folder',
      'drive:info',
      'drives:list',
      'folder:create',
      'icons:for-nodes',
      'icons:for-types',
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
      'update:check',
      'update:download',
      'update:get-release-notes',
      'update:get-state',
      'update:install',
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

  it.each([
    ['update:get-state', []],
    ['update:check', []],
    ['update:download', []],
    ['update:get-release-notes', []],
    ['app:get-changelog', []],
    ['app:open-notices', []],
    ['app:open-link', ['repo']],
    ['app:get-whats-new-due', []],
    ['app:mark-whats-new-seen', []],
  ])(
    'refuses an untrusted sender on every update and about channel (%s)',
    async (channel, args) => {
      const ipc = createFakeIpc()
      const handle = vi.fn(() => undefined)
      const parseArgs = vi.fn((a: readonly unknown[]) => a as never)
      registerIpcHandlers(
        ipc,
        createHandlers({ [channel]: { parseArgs, handle } } as Partial<IpcHandlerMap>),
        isTrusted,
      )
      await expect(call(ipc, channel, 'https://evil.example/', args)).rejects.toThrow(
        UntrustedSenderError,
      )
      expect(handle).not.toHaveBeenCalled()
    },
  )

  it('refuses an untrusted sender on update:install', async () => {
    const ipc = createFakeIpc()
    const handle = vi.fn(() => undefined)
    registerIpcHandlers(
      ipc,
      createHandlers({ 'update:install': { parseArgs: noArgs, handle } }),
      isTrusted,
    )
    await expect(call(ipc, 'update:install', 'https://evil.example/', [])).rejects.toThrow(
      UntrustedSenderError,
    )
    expect(handle).not.toHaveBeenCalled()
    await expect(call(ipc, 'update:install', TRUSTED, [])).resolves.toBeUndefined()
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('icons channels reject a sender that is not the main window', async () => {
    const ipc = createFakeIpc()
    const forNodes = vi.fn(() => ({ keys: {}, images: {}, pending: [] }))
    const forTypes = vi.fn(() => ({}))
    registerIpcHandlers(
      ipc,
      createHandlers({
        'icons:for-nodes': { parseArgs: iconNodesArgs, handle: forNodes },
        'icons:for-types': { parseArgs: iconTypesArgs, handle: forTypes },
      }),
      isTrusted,
    )
    await expect(
      call(ipc, 'icons:for-nodes', 'https://evil.example/', ['0d6b2f6e-8a3c', ['f1']]),
    ).rejects.toThrow(UntrustedSenderError)
    await expect(call(ipc, 'icons:for-types', 'https://evil.example/', [['dir']])).rejects.toThrow(
      UntrustedSenderError,
    )
    expect(forNodes).not.toHaveBeenCalled()
    expect(forTypes).not.toHaveBeenCalled()
    await expect(call(ipc, 'icons:for-types', TRUSTED, [['dir']])).resolves.toEqual({})
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

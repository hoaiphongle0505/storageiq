import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppInfo } from '@shared/ipc-contract'
import { InvalidIpcArgumentsError, noArgs, oneString } from './parse-args'
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
    'dialog:select-folder': { parseArgs: noArgs, handle: () => ({ canceled: true }) },
    'scan:start': { parseArgs: oneString, handle: () => ({ scanId: 'scan-1' }) },
    'scan:cancel': { parseArgs: oneString, handle: () => undefined },
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
      'dialog:select-folder',
      'scan:cancel',
      'scan:start',
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

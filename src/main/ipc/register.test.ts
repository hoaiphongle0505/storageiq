import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppInfo } from '@shared/ipc-contract'
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

const handlers: IpcHandlerMap = {
  'app:get-info': () => appInfo,
  'dialog:select-folder': () => ({ canceled: true }),
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

const isTrusted = (event: IpcMainInvokeEvent) =>
  event.senderFrame?.url === 'app://trusted/index.html'

describe('registerIpcHandlers', () => {
  it('registers exactly one listener per contract channel', () => {
    const ipc = createFakeIpc()
    registerIpcHandlers(ipc, handlers, isTrusted)
    expect([...ipc.listeners.keys()].sort()).toEqual(['app:get-info', 'dialog:select-folder'])
  })

  it('forwards calls from trusted senders to the handler', async () => {
    const ipc = createFakeIpc()
    registerIpcHandlers(ipc, handlers, isTrusted)
    const listener = ipc.listeners.get('app:get-info')
    await expect(
      Promise.resolve(listener?.(eventFrom('app://trusted/index.html'))),
    ).resolves.toEqual(appInfo)
  })

  it('rejects calls from untrusted senders without running the handler', () => {
    const ipc = createFakeIpc()
    const getInfo = vi.fn(() => appInfo)
    registerIpcHandlers(ipc, { ...handlers, 'app:get-info': getInfo }, isTrusted)
    const listener = ipc.listeners.get('app:get-info')
    expect(() => listener?.(eventFrom('https://evil.example/'))).toThrow(UntrustedSenderError)
    expect(getInfo).not.toHaveBeenCalled()
  })
})

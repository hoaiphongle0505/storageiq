import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { OptionsChangeResult, OptionsState } from '@shared/ipc-contract'
import { createOptionsHandlers } from './options-handlers'
import { InvalidIpcArgumentsError } from './parse-args'
import { type IpcHandlerMap, type IpcRegistrar, registerIpcHandlers } from './register'
import { UntrustedSenderError } from './register'

const event = {} as IpcMainInvokeEvent
const state: OptionsState = {
  available: true,
  explorerMenu: true,
  runAsAdmin: false,
  runAsAdminLocked: false,
}
const change: OptionsChangeResult = { state, error: null }

function setup() {
  const service = {
    getState: vi.fn(() => state),
    setExplorerMenu: vi.fn(() => change),
    setRunAsAdmin: vi.fn(() => change),
  }
  const autoUpdate = { get: vi.fn(() => true), set: vi.fn(async (value: boolean) => value) }
  return { service, autoUpdate, handlers: createOptionsHandlers(service, autoUpdate) }
}

describe('options handlers', () => {
  it('get-state takes no arguments', () => {
    const { handlers } = setup()
    expect(handlers['options:get-state'].parseArgs([])).toEqual([])
    expect(() => handlers['options:get-state'].parseArgs([true])).toThrow(InvalidIpcArgumentsError)
  })

  it('set-explorer-menu parses a strict boolean', () => {
    const { handlers, service } = setup()
    expect(handlers['options:set-explorer-menu'].parseArgs([false])).toEqual([false])
    handlers['options:set-explorer-menu'].handle(event, true)
    expect(service.setExplorerMenu).toHaveBeenCalledWith(true)
  })

  it('set-run-as-admin parses a strict boolean', () => {
    const { handlers, service } = setup()
    expect(handlers['options:set-run-as-admin'].parseArgs([true])).toEqual([true])
    handlers['options:set-run-as-admin'].handle(event, false)
    expect(service.setRunAsAdmin).toHaveBeenCalledWith(false)
  })

  it('rejects a non-boolean before the service runs', async () => {
    const { handlers, service } = setup()
    const listeners = new Map<string, (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown>()
    const ipc: IpcRegistrar = { handle: (channel, listener) => listeners.set(channel, listener) }
    registerIpcHandlers(ipc, handlers as unknown as IpcHandlerMap, () => true)
    for (const bad of [1, 'true', null, undefined, {}]) {
      await expect(listeners.get('options:set-explorer-menu')?.(event, bad)).rejects.toThrow(
        InvalidIpcArgumentsError,
      )
      await expect(listeners.get('options:set-run-as-admin')?.(event, bad)).rejects.toThrow(
        InvalidIpcArgumentsError,
      )
    }
    expect(service.setExplorerMenu).not.toHaveBeenCalled()
    expect(service.setRunAsAdmin).not.toHaveBeenCalled()
  })

  it('returns the service result unchanged', () => {
    const { handlers } = setup()
    expect(handlers['options:get-state'].handle(event)).toBe(state)
    expect(handlers['options:set-explorer-menu'].handle(event, true)).toBe(change)
    expect(handlers['options:set-run-as-admin'].handle(event, true)).toBe(change)
  })

  it('an untrusted sender is refused (through registerIpcHandlers)', async () => {
    const { handlers, service } = setup()
    const listeners = new Map<string, (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown>()
    const ipc: IpcRegistrar = { handle: (channel, listener) => listeners.set(channel, listener) }
    registerIpcHandlers(ipc, handlers as unknown as IpcHandlerMap, () => false)
    for (const channel of [
      'options:get-state',
      'options:set-explorer-menu',
      'options:set-run-as-admin',
      'options:get-auto-update',
      'options:set-auto-update',
    ]) {
      await expect(listeners.get(channel)?.(event, true)).rejects.toThrow(UntrustedSenderError)
    }
    expect(service.getState).not.toHaveBeenCalled()
    expect(service.setExplorerMenu).not.toHaveBeenCalled()
  })
})

describe('auto-update options handlers', () => {
  it('get takes no arguments and returns the setting', async () => {
    const { handlers, autoUpdate } = setup()
    expect(handlers['options:get-auto-update'].parseArgs([])).toEqual([])
    expect(() => handlers['options:get-auto-update'].parseArgs([true])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(handlers['options:get-auto-update'].handle(event)).toBe(true)
    expect(autoUpdate.get).toHaveBeenCalled()
  })

  it('set parses a strict boolean and stores it', async () => {
    const { handlers, autoUpdate } = setup()
    expect(handlers['options:set-auto-update'].parseArgs([false])).toEqual([false])
    await expect(handlers['options:set-auto-update'].handle(event, false)).resolves.toBe(false)
    expect(autoUpdate.set).toHaveBeenCalledWith(false)
  })

  it('rejects a non-boolean through the registry before the setting changes', async () => {
    const { handlers, autoUpdate } = setup()
    const listeners = new Map<string, (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown>()
    const ipc: IpcRegistrar = { handle: (channel, listener) => listeners.set(channel, listener) }
    registerIpcHandlers(ipc, handlers as unknown as IpcHandlerMap, () => true)
    for (const bad of [1, 'false', null, undefined, {}]) {
      await expect(listeners.get('options:set-auto-update')?.(event, bad)).rejects.toThrow(
        InvalidIpcArgumentsError,
      )
    }
    expect(autoUpdate.set).not.toHaveBeenCalled()
  })
})

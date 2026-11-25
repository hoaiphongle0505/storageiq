import { describe, expect, it, vi } from 'vitest'
import { createFakeRegistry } from '../registry/fake-registry'
import { enableExplorerMenu, EXPLORER_KEY_ROOTS, explorerCommand } from './explorer-menu'
import { createOptionsService } from './options-service'
import { LAYERS_KEY } from './run-as-admin'

const EXE = 'C:\\Program Files\\StorageIQ\\StorageIQ.exe'

function setup(options: { isPackaged?: boolean; platform?: NodeJS.Platform } = {}) {
  const registry = createFakeRegistry()
  const warn = vi.fn()
  const service = createOptionsService({
    registry,
    exePath: EXE,
    isPackaged: options.isPackaged ?? true,
    platform: options.platform ?? 'win32',
    warn,
  })
  return { registry, warn, service }
}

describe('createOptionsService', () => {
  it('unpackaged returns available false and writes nothing', () => {
    const { registry, service } = setup({ isPackaged: false })
    const get = vi.spyOn(registry, 'getString')
    expect(service.getState()).toEqual({
      available: false,
      explorerMenu: false,
      runAsAdmin: false,
      runAsAdminLocked: false,
    })
    expect(get).not.toHaveBeenCalled()
    expect(service.setExplorerMenu(true).error).toBe('Available in the installed app')
    expect(service.setRunAsAdmin(true).error).toBe('Available in the installed app')
    service.repairExplorerMenu()
    expect(registry.writes).toEqual([])
    expect(registry.entries().size).toBe(0)
  })

  it('non-Windows returns available false', () => {
    const { service } = setup({ platform: 'linux' })
    expect(service.getState().available).toBe(false)
    expect(service.setExplorerMenu(true).error).toBe('Available in the installed app')
  })

  it('re-registers all three keys when the exe path changed', () => {
    const { registry, service } = setup()
    enableExplorerMenu(registry, 'C:\\Old\\StorageIQ.exe')
    service.repairExplorerMenu()
    for (const root of EXPLORER_KEY_ROOTS) {
      expect(registry.getString('HKCU', `${root}\\command`, '')).toBe(explorerCommand(EXE))
    }
    expect(service.getState().explorerMenu).toBe(true)
  })

  it('repair does nothing when no key exists', () => {
    const { registry, service } = setup()
    service.repairExplorerMenu()
    expect(registry.writes).toEqual([])
  })

  it('repair rewrites a partial set', () => {
    const { registry, service } = setup()
    enableExplorerMenu(registry, EXE)
    registry.deleteTree(EXPLORER_KEY_ROOTS[0] ?? '')
    registry.deleteTree(EXPLORER_KEY_ROOTS[2] ?? '')
    service.repairExplorerMenu()
    expect(service.getState().explorerMenu).toBe(true)
  })

  it('repair never throws when the registry fails', () => {
    const { registry, service, warn } = setup()
    registry.failWith(new Error('policy'))
    expect(() => service.repairExplorerMenu()).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a registry failure returns the real state and a calm error', () => {
    const { registry, service, warn } = setup()
    enableExplorerMenu(registry, EXE)
    const write = vi.spyOn(registry, 'setString').mockImplementation(() => {
      throw new Error('RegistryError 5 access denied')
    })
    const result = service.setRunAsAdmin(true)
    expect(write).toHaveBeenCalled()
    expect(result.error).toBe('Windows did not allow that change. Your settings are unchanged.')
    expect(result.state).toMatchObject({ available: true, explorerMenu: true, runAsAdmin: false })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('setters return the refreshed state', () => {
    const { registry, service } = setup()
    const on = service.setExplorerMenu(true)
    expect(on).toEqual({
      error: null,
      state: { available: true, explorerMenu: true, runAsAdmin: false, runAsAdminLocked: false },
    })
    expect(service.setExplorerMenu(false).state.explorerMenu).toBe(false)
    expect(service.setRunAsAdmin(true).state.runAsAdmin).toBe(true)
    expect(registry.getString('HKCU', LAYERS_KEY, EXE)).toBe('~ RUNASADMIN')
    expect(service.setRunAsAdmin(false).state.runAsAdmin).toBe(false)
    registry.seed('HKLM', LAYERS_KEY, EXE, '~ RUNASADMIN')
    expect(service.getState()).toMatchObject({ runAsAdmin: true, runAsAdminLocked: true })
  })
})

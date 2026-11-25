import type { OptionsChangeResult, OptionsState } from '@shared/ipc-contract'
import type { RegistryAdapter } from '../registry/registry-adapter'
import {
  disableExplorerMenu,
  enableExplorerMenu,
  explorerMenuState,
  explorerMenuTraces,
} from './explorer-menu'
import { disableRunAsAdmin, enableRunAsAdmin, readRunAsAdmin } from './run-as-admin'

export const UNAVAILABLE_MESSAGE = 'Available in the installed app'
export const CHANGE_REFUSED_MESSAGE =
  'Windows did not allow that change. Your settings are unchanged.'

export interface OptionsService {
  getState(): OptionsState
  setExplorerMenu(enabled: boolean): OptionsChangeResult
  setRunAsAdmin(enabled: boolean): OptionsChangeResult
  /** Startup: when the menu is on but a key is missing or points at another exe, rewrite all three. Never throws. */
  repairExplorerMenu(): void
}

const UNAVAILABLE: OptionsState = {
  available: false,
  explorerMenu: false,
  runAsAdmin: false,
  runAsAdminLocked: false,
}

export function createOptionsService(deps: {
  registry: RegistryAdapter
  exePath: string // process.execPath
  isPackaged: boolean
  /** Defaults to `process.platform`; a seam for tests. */
  platform?: NodeJS.Platform
  warn(message: string, error: unknown): void
}): OptionsService {
  const { registry, exePath } = deps
  // A development run would register electron.exe, so only the installed app writes anything.
  const available = deps.isPackaged && (deps.platform ?? process.platform) === 'win32'

  const readState = (): OptionsState => {
    if (!available) return UNAVAILABLE
    const admin = readRunAsAdmin(registry, exePath)
    return {
      available: true,
      explorerMenu: explorerMenuState(registry, exePath),
      runAsAdmin: admin.enabled,
      runAsAdminLocked: admin.locked,
    }
  }

  /** The state, or what is known when even reading fails (never throws). */
  const safeState = (): OptionsState => {
    try {
      return readState()
    } catch (error) {
      deps.warn('StorageIQ could not read its Windows options', error)
      return { ...UNAVAILABLE, readFailed: true }
    }
  }

  const change = (apply: () => void): OptionsChangeResult => {
    if (!available) return { state: UNAVAILABLE, error: UNAVAILABLE_MESSAGE }
    try {
      apply()
    } catch (error) {
      deps.warn('StorageIQ could not change a Windows option', error)
      return { state: safeState(), error: CHANGE_REFUSED_MESSAGE }
    }
    return { state: safeState(), error: null }
  }

  return {
    getState: safeState,
    setExplorerMenu: (enabled) =>
      change(() => {
        if (enabled) enableExplorerMenu(registry, exePath)
        else disableExplorerMenu(registry)
      }),
    setRunAsAdmin: (enabled) =>
      change(() => {
        if (enabled) enableRunAsAdmin(registry, exePath)
        else disableRunAsAdmin(registry, exePath)
      }),
    repairExplorerMenu() {
      if (!available) return
      try {
        if (explorerMenuTraces(registry) && !explorerMenuState(registry, exePath)) {
          enableExplorerMenu(registry, exePath)
        }
      } catch (error) {
        deps.warn('StorageIQ could not repair its Explorer menu entry', error)
      }
    },
  }
}

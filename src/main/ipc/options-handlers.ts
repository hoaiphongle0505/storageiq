import type { OptionsService } from '../options/options-service'
import { noArgs, oneBoolean } from './parse-args'
import type { IpcHandlerMap } from './register'

export type OptionsHandlers = Pick<
  IpcHandlerMap,
  | 'options:get-state'
  | 'options:set-explorer-menu'
  | 'options:set-run-as-admin'
  | 'options:get-auto-update'
  | 'options:set-auto-update'
>

/** "Check for updates automatically": main owns the value; `set` returns what is now in effect. */
export interface AutoUpdateSetting {
  get(): boolean
  set(enabled: boolean): Promise<boolean>
}

/** The service never throws for registry failures; it answers with the real state and a message. */
export function createOptionsHandlers(
  service: Pick<OptionsService, 'getState' | 'setExplorerMenu' | 'setRunAsAdmin'>,
  autoUpdate: AutoUpdateSetting,
): OptionsHandlers {
  return {
    'options:get-state': { parseArgs: noArgs, handle: () => service.getState() },
    'options:set-explorer-menu': {
      parseArgs: oneBoolean,
      handle: (_event, enabled) => service.setExplorerMenu(enabled),
    },
    'options:get-auto-update': { parseArgs: noArgs, handle: () => autoUpdate.get() },
    'options:set-auto-update': {
      parseArgs: oneBoolean,
      handle: (_event, enabled) => autoUpdate.set(enabled),
    },
    'options:set-run-as-admin': {
      parseArgs: oneBoolean,
      handle: (_event, enabled) => service.setRunAsAdmin(enabled),
    },
  }
}

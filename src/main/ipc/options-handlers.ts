import type { OptionsService } from '../options/options-service'
import { noArgs, oneBoolean } from './parse-args'
import type { IpcHandlerMap } from './register'

export type OptionsHandlers = Pick<
  IpcHandlerMap,
  'options:get-state' | 'options:set-explorer-menu' | 'options:set-run-as-admin'
>

/** The service never throws for registry failures; it answers with the real state and a message. */
export function createOptionsHandlers(
  service: Pick<OptionsService, 'getState' | 'setExplorerMenu' | 'setRunAsAdmin'>,
): OptionsHandlers {
  return {
    'options:get-state': { parseArgs: noArgs, handle: () => service.getState() },
    'options:set-explorer-menu': {
      parseArgs: oneBoolean,
      handle: (_event, enabled) => service.setExplorerMenu(enabled),
    },
    'options:set-run-as-admin': {
      parseArgs: oneBoolean,
      handle: (_event, enabled) => service.setRunAsAdmin(enabled),
    },
  }
}

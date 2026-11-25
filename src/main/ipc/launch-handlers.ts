import type { LaunchCoordinator } from '../launch/launch-coordinator'
import { noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

export type LaunchHandlers = Pick<IpcHandlerMap, 'launch:take-request'>

/** Returns (once) the request main already validated; it is the only path main hands out. */
export function createLaunchHandlers(coordinator: Pick<LaunchCoordinator, 'take'>): LaunchHandlers {
  return {
    'launch:take-request': { parseArgs: noArgs, handle: () => coordinator.take() },
  }
}

import type { ReleaseNotes, UpdateState } from '@shared/ipc-contract'
import { noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

export interface UpdateHandlerDeps {
  getUpdateState(): UpdateState
  checkForUpdates(): UpdateState
  downloadUpdate(): void
  getReleaseNotes(): ReleaseNotes | null
}

export type UpdateHandlers = Pick<
  IpcHandlerMap,
  'update:get-state' | 'update:check' | 'update:download' | 'update:get-release-notes'
>

/** The updater's state machine lives in main; these only read it or ask it to move. */
export function createUpdateHandlers(deps: UpdateHandlerDeps): UpdateHandlers {
  return {
    'update:get-state': { parseArgs: noArgs, handle: () => deps.getUpdateState() },
    'update:check': { parseArgs: noArgs, handle: () => deps.checkForUpdates() },
    'update:download': {
      parseArgs: noArgs,
      handle: () => {
        deps.downloadUpdate()
      },
    },
    'update:get-release-notes': { parseArgs: noArgs, handle: () => deps.getReleaseNotes() },
  }
}

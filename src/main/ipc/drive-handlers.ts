import type { DriveInfo } from '@shared/scan-types'
import { noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

export type DriveHandlers = Pick<IpcHandlerMap, 'drives:list'>

export function createDriveHandlers(deps: { listDrives(): Promise<DriveInfo[]> }): DriveHandlers {
  return {
    'drives:list': { parseArgs: noArgs, handle: () => deps.listDrives() },
  }
}

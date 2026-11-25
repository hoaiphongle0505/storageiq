import type { DriveDetails, DriveInfo, Places } from '@shared/scan-types'
import { driveRootArgs, noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

export type DriveHandlers = Pick<IpcHandlerMap, 'drives:list' | 'drive:info' | 'places:list'>

export interface DriveHandlerDeps {
  listDrives(): Promise<DriveInfo[]>
  driveDetails(root: string): Promise<DriveDetails | null>
  listPlaces(): Promise<Places>
}

export function createDriveHandlers(deps: DriveHandlerDeps): DriveHandlers {
  return {
    'drives:list': { parseArgs: noArgs, handle: () => deps.listDrives() },
    'drive:info': { parseArgs: driveRootArgs, handle: (_event, root) => deps.driveDetails(root) },
    'places:list': { parseArgs: noArgs, handle: () => deps.listPlaces() },
  }
}

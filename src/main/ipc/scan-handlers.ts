import path from 'node:path'
import type { ScanVolume } from '@shared/scanner-protocol'
import type { ScanService } from '../scan/scan-service'
import { InvalidIpcArgumentsError, oneString } from './parse-args'
import type { IpcHandlerMap } from './register'

export interface ScanHandlerDeps {
  scanService: Pick<ScanService, 'start' | 'cancel'>
  stat(path: string): Promise<{ isDirectory(): boolean }>
  /** Cluster size and free space for the drive holding `root` (koffi), with safe fallbacks. */
  volumeFor(root: string): Promise<ScanVolume>
  /** Remembers `root` in the "Recently scanned" list. Never throws. */
  addRecent(root: string): Promise<void>
}

export type ScanHandlers = Pick<IpcHandlerMap, 'scan:start' | 'scan:cancel'>

/** `C:\…` or `C:/…`: a drive letter, a colon and a separator. */
const DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/

/** `scan:start` rule: one string; absolute; not UNC; an existing directory. */
export async function parseScanRoot(
  args: readonly unknown[],
  stat: ScanHandlerDeps['stat'],
): Promise<[string]> {
  const [root] = oneString(args)
  if (root.startsWith('\\\\') || root.startsWith('//')) {
    throw new InvalidIpcArgumentsError('network (UNC) paths cannot be scanned')
  }
  if (!DRIVE_ABSOLUTE.test(root)) {
    throw new InvalidIpcArgumentsError('the path must be absolute, like C:\\Folder')
  }
  let isDirectory: boolean
  try {
    isDirectory = (await stat(root)).isDirectory()
  } catch {
    isDirectory = false
  }
  if (!isDirectory) {
    throw new InvalidIpcArgumentsError('the path is not an existing folder')
  }
  return [path.win32.normalize(root)]
}

export function createScanHandlers(deps: ScanHandlerDeps): ScanHandlers {
  return {
    'scan:start': {
      parseArgs: (args) => parseScanRoot(args, deps.stat),
      handle: async (_event, root) => {
        const volume = await deps.volumeFor(root)
        const started = deps.scanService.start(root, volume)
        void deps.addRecent(root)
        return started
      },
    },
    'scan:cancel': {
      parseArgs: oneString,
      handle: (_event, scanId) => {
        deps.scanService.cancel(scanId)
      },
    },
  }
}

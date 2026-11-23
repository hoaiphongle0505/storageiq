import path from 'node:path'
import type { DriveDetails } from '@shared/scan-types'
import type { DriveApi } from './drive-api'

/** `C:\Users\Me` → `C:\`; anything without a drive letter → null. */
export function driveRootOf(target: string): string | null {
  const match = /^([A-Za-z]):/.exec(path.win32.normalize(target))
  return match === null ? null : `${(match[1] ?? '').toUpperCase()}:\\`
}

/** True when `target` is a drive root itself (`C:\`), not a folder on it. */
export function isDriveRoot(target: string): boolean {
  return /^[A-Za-z]:[\\/]?$/.test(target)
}

/** Space, cluster size and file system of `root`, or null when the drive cannot be read. */
export async function readDriveDetails(api: DriveApi, root: string): Promise<DriveDetails | null> {
  let space
  try {
    space = await api.statfs(root)
  } catch {
    return null
  }
  const volume = api.getVolumeDetails(root)
  if (volume === null || volume.clusterBytes <= 0) return null
  return {
    root,
    totalBytes: space.blocks * space.bsize,
    freeBytes: space.bavail * space.bsize,
    clusterBytes: volume.clusterBytes,
    fileSystem: volume.fileSystem,
  }
}

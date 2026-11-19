import type { DriveInfo, DriveKind } from '@shared/scan-types'
import { DRIVE_FIXED, DRIVE_REMOVABLE, type DriveApi, type DriveSpace } from './drive-api'

const DEFAULT_LABEL: Record<DriveKind, string> = { fixed: 'Local Disk', removable: 'USB Drive' }

function driveKind(type: number): DriveKind | null {
  if (type === DRIVE_FIXED) return 'fixed'
  if (type === DRIVE_REMOVABLE) return 'removable'
  return null
}

/** `GetLogicalDrives` mask → `['A:\', 'C:\', …]`. */
export function driveRoots(mask: number): string[] {
  const roots: string[] = []
  for (let bit = 0; bit < 26; bit += 1) {
    if ((mask >>> bit) & 1) roots.push(`${String.fromCharCode(65 + bit)}:\\`)
  }
  return roots
}

/** Fixed and removable drives with label and space. Network, optical and RAM disks are left out. */
export async function listDrives(api: DriveApi): Promise<DriveInfo[]> {
  const drives: DriveInfo[] = []
  for (const root of driveRoots(api.getLogicalDrives())) {
    const kind = driveKind(api.getDriveType(root))
    if (kind === null) continue
    let space: DriveSpace
    try {
      space = await api.statfs(root)
    } catch {
      continue // for example a card reader without a card
    }
    const label = api.getVolumeLabel(root)?.trim() ?? ''
    drives.push({
      root,
      label: label === '' ? DEFAULT_LABEL[kind] : label,
      kind,
      totalBytes: space.blocks * space.bsize,
      freeBytes: space.bavail * space.bsize,
    })
  }
  return drives
}

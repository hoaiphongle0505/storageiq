/** `GetDriveTypeW` results that StorageIQ keeps (winbase.h). Everything else is left out. */
export const DRIVE_REMOVABLE = 2
export const DRIVE_FIXED = 3

export interface DriveSpace {
  bsize: number
  blocks: number
  bavail: number
}

/** The Windows calls drive listing needs. The app passes koffi + `fs.statfs`; tests pass a fake. */
export interface DriveApi {
  /** Bit mask of existing drive letters (bit 0 = A:). */
  getLogicalDrives(): number
  getDriveType(root: string): number
  /** The volume label, `''` when the volume has none, or `null` when it cannot be read. */
  getVolumeLabel(root: string): string | null
  statfs(root: string): Promise<DriveSpace>
}

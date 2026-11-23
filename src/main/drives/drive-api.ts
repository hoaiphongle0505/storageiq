/** `GetDriveTypeW` results that StorageIQ keeps (winbase.h). Everything else is left out. */
export const DRIVE_REMOVABLE = 2
export const DRIVE_FIXED = 3

export interface DriveSpace {
  bsize: number
  blocks: number
  bavail: number
}

/** Cluster size and file system of a volume. */
export interface VolumeDetails {
  /** Sectors per cluster × bytes per sector (`GetDiskFreeSpaceW`). */
  clusterBytes: number
  /** For example `NTFS`, `exFAT`, `FAT32` (`GetVolumeInformationW`); `''` when unreadable. */
  fileSystem: string
}

/** The Windows calls drive listing needs. The app passes koffi + `fs.statfs`; tests pass a fake. */
export interface DriveApi {
  /** Bit mask of existing drive letters (bit 0 = A:). */
  getLogicalDrives(): number
  getDriveType(root: string): number
  /** The volume label, `''` when the volume has none, or `null` when it cannot be read. */
  getVolumeLabel(root: string): string | null
  /** Cluster size and file system, or `null` when the volume cannot be read. */
  getVolumeDetails(root: string): VolumeDetails | null
  statfs(root: string): Promise<DriveSpace>
}

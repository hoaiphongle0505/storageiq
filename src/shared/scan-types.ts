/** Drives StorageIQ lists: fixed disks and removable (USB) drives. Network and optical are left out. */
export type DriveKind = 'fixed' | 'removable'

export interface DriveInfo {
  /** Drive root with a trailing backslash, for example `C:\`. */
  root: string
  /** Volume label, or `Local Disk` / `USB Drive` when the volume has none. */
  label: string
  kind: DriveKind
  totalBytes: number
  freeBytes: number
}

/** `drive:info`: space and cluster size of the drive that holds a scanned path. */
export interface DriveDetails {
  root: string
  totalBytes: number
  freeBytes: number
  /** Bytes per cluster (sectors per cluster × bytes per sector), from `GetDiskFreeSpaceW`. */
  clusterBytes: number
  /** File system name from `GetVolumeInformationW`, for example `NTFS`; `''` when unknown. */
  fileSystem: string
}

export type PlaceKind = 'documents' | 'onedrive'

/** One entry of the Select menu's "Documents and cloud" section. */
export interface Place {
  kind: PlaceKind
  label: string
  path: string
}

/** `places:list`: everything the Select menu shows besides the drives. */
export interface Places {
  places: Place[]
  /** Most recent first, at most `MAX_RECENT_SCANS`. */
  recent: string[]
}

export const MAX_RECENT_SCANS = 5

export type ScanErrorReason = 'access-denied' | 'path-too-long' | 'not-found' | 'other'

/** Whether the entry that failed is a folder or a file (known from the directory listing). */
export type ScanErrorKind = 'file' | 'folder'

export interface ScanError {
  path: string
  kind: ScanErrorKind
  reason: ScanErrorReason
  /** The Node.js error code, for example `EPERM`. */
  code: string
}

export interface ScanProgress {
  scanId: string
  files: number
  /** Folders found below the scanned root (the root itself is not counted). */
  folders: number
  bytes: number
  allocatedBytes: number
  currentPath: string
  elapsedMs: number
  /** Entries that could not be read so far. */
  errorCount: number
}

export type ScanStatus = 'complete' | 'canceled'

export interface ScanDone {
  scanId: string
  status: ScanStatus
  files: number
  folders: number
  bytes: number
  allocatedBytes: number
  elapsedMs: number
  /** At most 1000 entries, in the order they happened; `errorCount` is the exact total. */
  errors: ScanError[]
  errorCount: number
  /** Walker threads used by the scan (1 = the single-thread walk); informational. */
  walkers?: number
}

export interface ScanFailed {
  scanId: string
  message: string
}

/** `scan:restarted`: main started a new scan of the same root (a root refresh); follow `scanId`. */
export interface ScanRestarted {
  scanId: string
  root: string
}

export interface ScanStartResult {
  scanId: string
}

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

/** One row of the largest-folders list: a direct child of the scanned root, or the remainder. */
export interface FolderSummary {
  kind: 'folder' | 'everything-else'
  name: string
  /** Full path of the folder; for `everything-else`, the scanned root. */
  path: string
  /** Logical size (`stat.size`) of every file below the folder. */
  bytes: number
  files: number
  /** Folders below this one, not counting itself. */
  folders: number
}

export type ScanErrorReason = 'access-denied' | 'path-too-long' | 'not-found' | 'other'

export interface ScanError {
  path: string
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
  currentPath: string
  elapsedMs: number
  topFolders: FolderSummary[]
}

export type ScanStatus = 'complete' | 'canceled'

export interface ScanDone {
  scanId: string
  status: ScanStatus
  files: number
  folders: number
  bytes: number
  elapsedMs: number
  topFolders: FolderSummary[]
  /** At most 1000 entries, in the order they happened; `errorCount` is the exact total. */
  errors: ScanError[]
  errorCount: number
}

export interface ScanFailed {
  scanId: string
  message: string
}

export interface ScanStartResult {
  scanId: string
}

import path from 'node:path'
import type { ScanError, ScanErrorReason } from '@shared/scan-types'
import type { WalkSink } from './walk'

export const MAX_SCAN_ERRORS = 1000

/** A folder in the scan tree. Folders only: files are summed into their parent. */
export interface FolderNode {
  readonly name: string
  readonly parent: FolderNode | null
  readonly children: FolderNode[]
  /** Totals for everything below this folder. */
  bytes: number
  files: number
  /** Folders below this one, not counting itself. */
  folders: number
}

export interface ScanTotals {
  files: number
  folders: number
  bytes: number
}

export interface ScanTree extends WalkSink<FolderNode> {
  readonly rootPath: string
  readonly root: FolderNode
  /** The folder the walk is listing now. */
  readonly currentPath: string
  /** Exact number of errors, including those beyond `MAX_SCAN_ERRORS`. */
  readonly errorCount: number
  /** The first `MAX_SCAN_ERRORS` errors, in the order they happened. */
  readonly errors: readonly ScanError[]
  totals(): ScanTotals
  pathOf(node: FolderNode): string
}

export function scanErrorReason(code: string): ScanErrorReason {
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return 'access-denied'
    case 'ENAMETOOLONG':
      return 'path-too-long'
    case 'ENOENT':
      return 'not-found'
    default:
      return 'other'
  }
}

export function createScanTree(rootPath: string): ScanTree {
  const root: FolderNode = {
    name: rootPath,
    parent: null,
    children: [],
    bytes: 0,
    files: 0,
    folders: 0,
  }
  const errors: ScanError[] = []
  let errorCount = 0
  let currentPath = rootPath

  return {
    rootPath,
    root,
    errors,
    get currentPath() {
      return currentPath
    },
    get errorCount() {
      return errorCount
    },

    folder(parent, name) {
      const node: FolderNode = { name, parent, children: [], bytes: 0, files: 0, folders: 0 }
      parent.children.push(node)
      let ancestor: FolderNode | null = parent
      while (ancestor !== null) {
        ancestor.folders += 1
        ancestor = ancestor.parent
      }
      return node
    },

    file(parent, bytes) {
      let ancestor: FolderNode | null = parent
      while (ancestor !== null) {
        ancestor.files += 1
        ancestor.bytes += bytes
        ancestor = ancestor.parent
      }
    },

    error(errorPath, code) {
      errorCount += 1
      if (errors.length < MAX_SCAN_ERRORS) {
        errors.push({ path: errorPath, reason: scanErrorReason(code), code })
      }
    },

    visiting(dirPath) {
      currentPath = dirPath
    },

    totals: () => ({ files: root.files, folders: root.folders, bytes: root.bytes }),

    pathOf(node) {
      const names: string[] = []
      let current = node
      while (current.parent !== null) {
        names.push(current.name)
        current = current.parent
      }
      return path.join(rootPath, ...names.reverse())
    },
  }
}

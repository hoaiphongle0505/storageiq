import path from 'node:path'
import type { ScanError, ScanErrorKind, ScanErrorReason } from '@shared/scan-types'
import { CATEGORY_COUNT, fileCategoryIndex } from '@shared/file-category'
import type { TreeTotals } from '@shared/tree-types'
import type { WalkSink } from './walk'

export const MAX_SCAN_ERRORS = 1000
/** No folder or file. */
export const NONE = -1
/** `parent` of an entry removed by `resetFolder`: it is no longer part of the tree. */
export const DETACHED = -2

const INITIAL_FOLDERS = 1024
const INITIAL_FILES = 8192

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

/**
 * Space a file takes on disk: whole clusters, `ceil(size / clusterBytes) * clusterBytes`.
 * 0-byte files take 0. This ignores NTFS compression, sparse files and files small enough to
 * live inside the MFT record (Phase 7 reads the real on-disk size).
 */
export function allocatedSize(size: number, clusterBytes: number): number {
  if (size <= 0) return 0
  if (clusterBytes <= 0) return size
  return Math.ceil(size / clusterBytes) * clusterBytes
}

function grownF64(array: Float64Array, length: number): Float64Array<ArrayBuffer> {
  const next = new Float64Array(length)
  next.set(array)
  return next
}

function grownI32(array: Int32Array, length: number): Int32Array<ArrayBuffer> {
  const next = new Int32Array(length)
  next.set(array)
  return next
}

/**
 * The scan tree in columnar form: one typed-array slot per folder and per file, plus one string
 * per entry name. Folder 0 is the scanned root. Children are singly linked lists (newest first);
 * the query layer sorts them. Every total is kept for the whole subtree, so a row never needs a
 * walk to be read. Memory is 21 bytes per file plus its name (about 125 bytes per file in all), and 160 bytes
 * per folder for the logical bytes of each file type (total and direct).
 */
export class TreeStore implements WalkSink<number> {
  readonly rootPath: string
  readonly clusterBytes: number
  /** Free bytes on the drive when the root is a drive root (for the treemap), else null. */
  readonly freeBytes: number | null
  /** Increments on every change; caches compare against it. */
  version = 0
  currentPath: string
  errorCount = 0
  readonly errors: ScanError[] = []

  folderLength = 0
  fileLength = 0

  // Per folder.
  private fParent = new Int32Array(INITIAL_FOLDERS)
  private fFirstChild = new Int32Array(INITIAL_FOLDERS)
  private fNextSibling = new Int32Array(INITIAL_FOLDERS)
  private fFirstFile = new Int32Array(INITIAL_FOLDERS)
  private fChildCount = new Int32Array(INITIAL_FOLDERS)
  private fDirectFiles = new Int32Array(INITIAL_FOLDERS)
  private fSize = new Float64Array(INITIAL_FOLDERS)
  private fAllocated = new Float64Array(INITIAL_FOLDERS)
  private fFiles = new Float64Array(INITIAL_FOLDERS)
  private fFolders = new Float64Array(INITIAL_FOLDERS)
  private fModified = new Float64Array(INITIAL_FOLDERS)
  private fOwnModified = new Float64Array(INITIAL_FOLDERS)
  private fDirectSize = new Float64Array(INITIAL_FOLDERS)
  private fDirectAllocated = new Float64Array(INITIAL_FOLDERS)
  private fDirectModified = new Float64Array(INITIAL_FOLDERS)
  // CATEGORY_COUNT slots per folder: logical bytes per file type, whole subtree and direct files.
  private fCategoryBytes = new Float64Array(INITIAL_FOLDERS * CATEGORY_COUNT)
  private fDirectCategoryBytes = new Float64Array(INITIAL_FOLDERS * CATEGORY_COUNT)
  private readonly folderNames: string[] = []

  // Per file: 21 bytes. Allocated size is derived from size; modification time is kept in
  // whole seconds (enough for a date column, and it halves that column).
  private pParent = new Int32Array(INITIAL_FILES)
  private pNext = new Int32Array(INITIAL_FILES)
  private pSize = new Float64Array(INITIAL_FILES)
  private pModifiedSeconds = new Uint32Array(INITIAL_FILES)
  private pCategory = new Uint8Array(INITIAL_FILES)
  private readonly fileNames: string[] = []

  constructor(rootPath: string, clusterBytes: number, freeBytes: number | null = null) {
    this.rootPath = rootPath
    this.clusterBytes = clusterBytes
    this.freeBytes = freeBytes
    this.currentPath = rootPath
    this.addFolderSlot(NONE, rootPath, 0)
  }

  // ---- WalkSink ---------------------------------------------------------------------------

  folder(parent: number, name: string, modifiedMs: number): number {
    const index = this.addFolderSlot(parent, name, modifiedMs)
    this.fNextSibling[index] = this.fFirstChild[parent] ?? NONE
    this.fFirstChild[parent] = index
    this.fChildCount[parent] = (this.fChildCount[parent] ?? 0) + 1
    for (let a = parent; a >= 0; a = this.fParent[a] ?? NONE) {
      this.fFolders[a] = (this.fFolders[a] ?? 0) + 1
      if ((this.fModified[a] ?? 0) < modifiedMs) this.fModified[a] = modifiedMs
    }
    return index
  }

  file(parent: number, bytes: number, name: string, modifiedMs: number): void {
    if (this.fileLength === this.pParent.length) this.growFiles()
    const index = this.fileLength
    this.fileLength += 1
    const allocated = allocatedSize(bytes, this.clusterBytes)
    this.pParent[index] = parent
    this.pNext[index] = this.fFirstFile[parent] ?? NONE
    this.fFirstFile[parent] = index
    this.pSize[index] = bytes
    this.pModifiedSeconds[index] = Math.min(0xffffffff, Math.max(0, Math.floor(modifiedMs / 1000)))
    const category = fileCategoryIndex(name)
    this.pCategory[index] = category
    this.fileNames.push(name)

    this.fDirectFiles[parent] = (this.fDirectFiles[parent] ?? 0) + 1
    this.fDirectSize[parent] = (this.fDirectSize[parent] ?? 0) + bytes
    this.fDirectAllocated[parent] = (this.fDirectAllocated[parent] ?? 0) + allocated
    if ((this.fDirectModified[parent] ?? 0) < modifiedMs) this.fDirectModified[parent] = modifiedMs
    const directSlot = parent * CATEGORY_COUNT + category
    this.fDirectCategoryBytes[directSlot] = (this.fDirectCategoryBytes[directSlot] ?? 0) + bytes
    for (let a = parent; a >= 0; a = this.fParent[a] ?? NONE) {
      this.fFiles[a] = (this.fFiles[a] ?? 0) + 1
      this.fSize[a] = (this.fSize[a] ?? 0) + bytes
      this.fAllocated[a] = (this.fAllocated[a] ?? 0) + allocated
      const slot = a * CATEGORY_COUNT + category
      this.fCategoryBytes[slot] = (this.fCategoryBytes[slot] ?? 0) + bytes
      if ((this.fModified[a] ?? 0) < modifiedMs) this.fModified[a] = modifiedMs
    }
    this.version += 1
  }

  error(errorPath: string, code: string, kind: ScanErrorKind): void {
    this.errorCount += 1
    if (this.errors.length < MAX_SCAN_ERRORS) {
      this.errors.push({ path: errorPath, kind, reason: scanErrorReason(code), code })
    }
  }

  visiting(dirPath: string): void {
    this.currentPath = dirPath
  }

  // ---- Reads --------------------------------------------------------------------------------

  totals(): TreeTotals {
    return {
      files: this.fFiles[0] ?? 0,
      folders: this.fFolders[0] ?? 0,
      bytes: this.fSize[0] ?? 0,
      allocatedBytes: this.fAllocated[0] ?? 0,
    }
  }

  folderParent(index: number): number {
    return this.fParent[index] ?? NONE
  }
  folderName(index: number): string {
    return this.folderNames[index] ?? ''
  }
  folderSize(index: number): number {
    return this.fSize[index] ?? 0
  }
  folderAllocated(index: number): number {
    return this.fAllocated[index] ?? 0
  }
  folderFiles(index: number): number {
    return this.fFiles[index] ?? 0
  }
  folderFolders(index: number): number {
    return this.fFolders[index] ?? 0
  }
  folderModified(index: number): number {
    return this.fModified[index] ?? 0
  }
  folderChildCount(index: number): number {
    return this.fChildCount[index] ?? 0
  }
  directFiles(index: number): number {
    return this.fDirectFiles[index] ?? 0
  }
  directSize(index: number): number {
    return this.fDirectSize[index] ?? 0
  }
  directAllocated(index: number): number {
    return this.fDirectAllocated[index] ?? 0
  }
  directModified(index: number): number {
    return this.fDirectModified[index] ?? 0
  }

  fileParent(index: number): number {
    return this.pParent[index] ?? NONE
  }
  fileName(index: number): string {
    return this.fileNames[index] ?? ''
  }
  fileSize(index: number): number {
    return this.pSize[index] ?? 0
  }
  fileAllocated(index: number): number {
    return allocatedSize(this.pSize[index] ?? 0, this.clusterBytes)
  }
  /** Index into `FILE_CATEGORIES` of the file's type. */
  fileCategoryOf(index: number): number {
    return this.pCategory[index] ?? CATEGORY_COUNT - 1
  }
  /**
   * Logical bytes per file type below folder `index`, `CATEGORY_COUNT` entries. A view into the
   * store: read it at once and do not keep it across writes.
   */
  folderCategoryBytes(index: number): Float64Array {
    return this.fCategoryBytes.subarray(index * CATEGORY_COUNT, (index + 1) * CATEGORY_COUNT)
  }
  /** Like `folderCategoryBytes`, for the files directly in folder `index` only. */
  directCategoryBytes(index: number): Float64Array {
    return this.fDirectCategoryBytes.subarray(index * CATEGORY_COUNT, (index + 1) * CATEGORY_COUNT)
  }
  /** Modification time in ms, to the second. */
  fileModified(index: number): number {
    return (this.pModifiedSeconds[index] ?? 0) * 1000
  }

  /** Child folders of `index`, in no particular order. */
  childFolders(index: number): number[] {
    const children: number[] = []
    for (let c = this.fFirstChild[index] ?? NONE; c !== NONE; c = this.fNextSibling[c] ?? NONE) {
      children.push(c)
    }
    return children
  }

  /** Files directly in folder `index`, in no particular order. */
  filesIn(index: number): number[] {
    const files: number[] = []
    for (let f = this.fFirstFile[index] ?? NONE; f !== NONE; f = this.pNext[f] ?? NONE) {
      files.push(f)
    }
    return files
  }

  /** True when the folder exists and is still attached to the root. */
  isLiveFolder(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.folderLength) return false
    for (let a = index; a !== 0; a = this.fParent[a] ?? DETACHED) {
      if (a < 0) return false
    }
    return true
  }

  isLiveFile(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.fileLength) return false
    return this.isLiveFolder(this.pParent[index] ?? DETACHED)
  }

  /** Folders from the root down to `index`, both included. */
  folderChain(index: number): number[] {
    const chain: number[] = []
    for (let a = index; a >= 0; a = this.fParent[a] ?? NONE) chain.push(a)
    return chain.reverse()
  }

  folderPath(index: number): string {
    const names = this.folderChain(index)
      .slice(1)
      .map((folder) => this.folderName(folder))
    return names.length === 0 ? this.rootPath : path.join(this.rootPath, ...names)
  }

  filePath(index: number): string {
    return path.join(this.folderPath(this.fileParent(index)), this.fileName(index))
  }

  // ---- Refresh ------------------------------------------------------------------------------

  /**
   * Empties folder `index` so a new walk can fill it again: its totals leave every ancestor, its
   * children and files are detached (their slots are not reused), and the ancestors' newest
   * modification time is recomputed from what is left.
   */
  resetFolder(index: number): void {
    const files = this.fFiles[index] ?? 0
    const folders = this.fFolders[index] ?? 0
    const size = this.fSize[index] ?? 0
    const allocated = this.fAllocated[index] ?? 0
    const own = this.folderCategoryBytes(index)
    for (let a = this.fParent[index] ?? NONE; a >= 0; a = this.fParent[a] ?? NONE) {
      for (let c = 0; c < CATEGORY_COUNT; c += 1) {
        const slot = a * CATEGORY_COUNT + c
        this.fCategoryBytes[slot] = (this.fCategoryBytes[slot] ?? 0) - (own[c] ?? 0)
      }
      this.fFiles[a] = (this.fFiles[a] ?? 0) - files
      this.fFolders[a] = (this.fFolders[a] ?? 0) - folders
      this.fSize[a] = (this.fSize[a] ?? 0) - size
      this.fAllocated[a] = (this.fAllocated[a] ?? 0) - allocated
    }
    for (const child of this.childFolders(index)) this.fParent[child] = DETACHED
    for (const file of this.filesIn(index)) this.pParent[file] = DETACHED
    this.fFirstChild[index] = NONE
    this.fFirstFile[index] = NONE
    this.fChildCount[index] = 0
    this.fDirectFiles[index] = 0
    this.fDirectSize[index] = 0
    this.fDirectAllocated[index] = 0
    this.fDirectModified[index] = 0
    this.fFiles[index] = 0
    this.fFolders[index] = 0
    this.fSize[index] = 0
    this.fAllocated[index] = 0
    own.fill(0)
    this.directCategoryBytes(index).fill(0)
    this.fModified[index] = this.fOwnModified[index] ?? 0
    for (let a = this.fParent[index] ?? NONE; a >= 0; a = this.fParent[a] ?? NONE) {
      let newest = Math.max(this.fOwnModified[a] ?? 0, this.fDirectModified[a] ?? 0)
      for (const child of this.childFolders(a))
        newest = Math.max(newest, this.fModified[child] ?? 0)
      this.fModified[a] = newest
    }
    this.version += 1
  }

  // ---- Storage ------------------------------------------------------------------------------

  private addFolderSlot(parent: number, name: string, modifiedMs: number): number {
    if (this.folderLength === this.fParent.length) this.growFolders()
    const index = this.folderLength
    this.folderLength += 1
    this.fParent[index] = parent
    this.fFirstChild[index] = NONE
    this.fNextSibling[index] = NONE
    this.fFirstFile[index] = NONE
    this.fModified[index] = modifiedMs
    this.fOwnModified[index] = modifiedMs
    this.folderNames.push(name)
    this.version += 1
    return index
  }

  private growFolders(): void {
    const length = Math.ceil(this.fParent.length * 1.5)
    this.fParent = grownI32(this.fParent, length)
    this.fFirstChild = grownI32(this.fFirstChild, length)
    this.fNextSibling = grownI32(this.fNextSibling, length)
    this.fFirstFile = grownI32(this.fFirstFile, length)
    this.fChildCount = grownI32(this.fChildCount, length)
    this.fDirectFiles = grownI32(this.fDirectFiles, length)
    this.fSize = grownF64(this.fSize, length)
    this.fAllocated = grownF64(this.fAllocated, length)
    this.fFiles = grownF64(this.fFiles, length)
    this.fFolders = grownF64(this.fFolders, length)
    this.fModified = grownF64(this.fModified, length)
    this.fOwnModified = grownF64(this.fOwnModified, length)
    this.fDirectSize = grownF64(this.fDirectSize, length)
    this.fDirectAllocated = grownF64(this.fDirectAllocated, length)
    this.fDirectModified = grownF64(this.fDirectModified, length)
    this.fCategoryBytes = grownF64(this.fCategoryBytes, length * CATEGORY_COUNT)
    this.fDirectCategoryBytes = grownF64(this.fDirectCategoryBytes, length * CATEGORY_COUNT)
  }

  private growFiles(): void {
    const length = Math.ceil(this.pParent.length * 1.5)
    this.pParent = grownI32(this.pParent, length)
    this.pNext = grownI32(this.pNext, length)
    this.pSize = grownF64(this.pSize, length)
    const seconds = new Uint32Array(length)
    seconds.set(this.pModifiedSeconds)
    this.pModifiedSeconds = seconds
    const categories = new Uint8Array(length)
    categories.set(this.pCategory)
    this.pCategory = categories
  }
}

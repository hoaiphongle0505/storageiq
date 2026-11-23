import type { DirectoryLister, DirectoryListing, ListedEntry, SyncLister } from './walk'

/**
 * Directory listing through kernel32 `FindFirstFileExW`, bound with koffi.
 *
 * Why not `lstat` per entry: every `lstat` opens the file, which triggers a real-time antivirus
 * scan, so a walk of a system drive ran at 1.3-13k files/s. The directory listing already
 * carries attributes, size and modification time, so no file is opened at all (31-63k files/s
 * measured on the same trees).
 *
 * Async decision: `FindFirstFileExW` is the call that blocks on the directory open (and on the
 * antivirus scan that open triggers), so it goes through koffi's `.async` and is the only call
 * per directory that leaves the JS thread. The `FindNextFileW` loop and `FindClose` then run
 * synchronously: `FIND_FIRST_EX_LARGE_FETCH` makes the first call read a large buffer and the
 * next calls are served from it in microseconds. An async call per entry would cost a
 * thread-pool hop per file and lose the measured throughput. One listing therefore returns the
 * whole directory in one array, and up to `MAX_DIRECTORIES_IN_FLIGHT` opens overlap.
 *
 * Error codes: `GetLastError` is thread-local, so it is not valid after an async call (koffi
 * reports 0 there). When the async open fails, the open is repeated once synchronously, which
 * is cheap because a failed open is quick, and `GetLastError` is read right after it on the
 * same thread. Verified on `C:\System Volume Information` (5) and a missing path (3).
 */

export const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000
export const FIND_EX_INFO_BASIC = 1
export const FIND_EX_SEARCH_NAME_MATCH = 0
export const FIND_FIRST_EX_LARGE_FETCH = 2
export const FILE_ATTRIBUTE_DIRECTORY = 0x10
export const FILE_ATTRIBUTE_REPARSE_POINT = 0x400
export const IO_REPARSE_TAG_SYMLINK = 0xa000000c
export const IO_REPARSE_TAG_MOUNT_POINT = 0xa0000003
export const ERROR_NO_MORE_FILES = 18
/**
 * Historic threshold, kept for the tests: `findPattern` now gives every drive pattern the `\\?\`
 * prefix, short or long (MAX_PATH is 260, minus room for names), so nothing branches on it.
 */
export const LONG_PATH_PREFIX_AT = 248
/** `sizeof(WIN32_FIND_DATAW)` on x64: 4 + 24 + 16 + 520 + 28. */
export const FIND_DATA_SIZE = 592

const TWO_POW_32 = 2 ** 32
const LONG_PREFIX = '\\\\?\\'

/** FILETIME (two 32-bit halves, 100 ns ticks since 1601) to ms since the Unix epoch, never < 0. */
export function filetimeToMs(low: number, high: number): number {
  const ms = Math.floor((high * TWO_POW_32 + low) / 10_000 - FILETIME_EPOCH_OFFSET_MS)
  return ms > 0 ? ms : 0
}

/** Maps a Win32 error number to the Node-style code `scanErrorReason` understands. */
export function win32ErrorToCode(error: number): string {
  switch (error) {
    case 5:
      return 'EACCES'
    case 2:
    case 3:
    case 53:
      return 'ENOENT'
    case 206:
      return 'ENAMETOOLONG'
    case 267:
      return 'ENOTDIR'
    default:
      // 32 (sharing violation) and 1920 (cannot access file) are deliberately not mapped.
      return `WIN32_${error}`
  }
}

/**
 * The search pattern for a folder: `<dir>\*`, always with `\\?\` in front for drive-absolute
 * paths (`\\?\UNC\server\share` for UNC). Without the prefix Win32 normalisation strips a
 * trailing period or space from every segment, so a folder named `foo.` would list `foo`. The
 * prefix also lifts the 260-character limit; the form is not normalised, so forward slashes
 * become backslashes. Already-prefixed paths are left alone; the tree keeps unprefixed paths.
 */
export function findPattern(dirPath: string): string {
  const clean = dirPath.replace(/\//g, '\\')
  const pattern = clean.endsWith('\\') ? `${clean}*` : `${clean}\\*`
  if (pattern.startsWith(LONG_PREFIX)) return pattern
  if (/^[A-Za-z]:\\/.test(pattern)) return `${LONG_PREFIX}${pattern}`
  if (pattern.startsWith('\\\\')) return `${LONG_PREFIX}UNC\\${pattern.slice(2)}`
  return pattern
}

/** Error code for the `GetLastError` read after `FindNextFileW` returned FALSE; null at the end. */
export function endOfListingError(lastError: number): string | null {
  return lastError === ERROR_NO_MORE_FILES || lastError === 0 ? null : win32ErrorToCode(lastError)
}

interface FileTime {
  low: number
  high: number
}

interface FindData {
  dwFileAttributes: number
  ftLastWriteTime: FileTime
  nFileSizeHigh: number
  nFileSizeLow: number
  dwReserved0: number
  cFileName: string
}

/** Used to compare the handle: koffi returns a number for `intptr_t` (or a BigInt for large). */
const INVALID_HANDLE = -1

export function toEntry(data: FindData): ListedEntry | null {
  const name = data.cFileName
  if (name === '.' || name === '..') return null
  const attributes = data.dwFileAttributes
  const isDirectory = (attributes & FILE_ATTRIBUTE_DIRECTORY) !== 0
  const isLink =
    (attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0 &&
    (data.dwReserved0 === IO_REPARSE_TAG_SYMLINK || data.dwReserved0 === IO_REPARSE_TAG_MOUNT_POINT)
  return {
    name,
    isDirectory,
    isLink,
    size: isDirectory || isLink ? 0 : data.nFileSizeHigh * TWO_POW_32 + data.nFileSizeLow,
    modifiedMs: filetimeToMs(data.ftLastWriteTime.low, data.ftLastWriteTime.high),
  }
}

let shared: Promise<DirectoryLister> | null = null

/**
 * Loads koffi lazily (like the drive API), so a broken native module fails here, not at import.
 * koffi type names are global per thread, so the bindings are declared once per thread and shared
 * by the async and the sync lister.
 */
export function createWinFindLister(): Promise<DirectoryLister> {
  if (shared === null) {
    const attempt = buildLister()
    shared = attempt
    attempt.catch(() => {
      if (shared === attempt) shared = null // a failed load may be retried
    })
  }
  return shared
}

/**
 * The synchronous lister the walker worker threads use: the open is a plain blocking
 * `FindFirstFileExW`, so `GetLastError` is valid right after it on the same thread (no retry
 * trick). One koffi instance exists per worker thread, so each worker calls this once.
 */
export async function createWinFindSyncLister(): Promise<SyncLister> {
  const api = await loadApi()
  return {
    listSync(dirPath): DirectoryListing {
      const pattern = findPattern(dirPath)
      const data = emptyFindData()
      const handle = api.findFirst(
        pattern,
        FIND_EX_INFO_BASIC,
        data,
        FIND_EX_SEARCH_NAME_MATCH,
        null,
        FIND_FIRST_EX_LARGE_FETCH,
      )
      if (isInvalid(handle)) {
        return { entries: [], errorCode: win32ErrorToCode(Number(api.getLastError())) }
      }
      const entries: ListedEntry[] = []
      let errorCode: string | null
      try {
        const first = toEntry(data)
        if (first !== null) entries.push(first)
        while (api.findNext(handle, data) !== 0) {
          const entry = toEntry(data)
          if (entry !== null) entries.push(entry)
        }
        errorCode = endOfListingError(Number(api.getLastError()))
      } finally {
        api.findClose(handle)
      }
      return { entries, errorCode }
    },
  }
}

const isInvalid = (handle: number | bigint): boolean => Number(handle) === INVALID_HANDLE

function emptyFindData(): FindData {
  return {
    dwFileAttributes: 0,
    ftLastWriteTime: { low: 0, high: 0 },
    nFileSizeHigh: 0,
    nFileSizeLow: 0,
    dwReserved0: 0,
    cFileName: '',
  }
}

interface Api {
  findFirst: (...args: unknown[]) => number | bigint
  findNext: (handle: number | bigint, data: object) => number
  findClose: (handle: number | bigint) => number
  getLastError: () => number
  // koffi function objects also carry `.async`
  findFirstFn: { async: (...args: unknown[]) => unknown }
}

let apiPromise: Promise<Api> | null = null

function loadApi(): Promise<Api> {
  if (apiPromise === null) {
    const attempt = bindApi()
    apiPromise = attempt
    attempt.catch(() => {
      if (apiPromise === attempt) apiPromise = null
    })
  }
  return apiPromise
}

async function bindApi(): Promise<Api> {
  const { default: koffi } = await import('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const fileTime = koffi.struct('SIQ_FILETIME', { low: 'uint32_t', high: 'uint32_t' })
  const findData = koffi.struct('SIQ_FIND_DATAW', {
    dwFileAttributes: 'uint32_t',
    ftCreationTime: fileTime,
    ftLastAccessTime: fileTime,
    ftLastWriteTime: fileTime,
    nFileSizeHigh: 'uint32_t',
    nFileSizeLow: 'uint32_t',
    dwReserved0: 'uint32_t',
    dwReserved1: 'uint32_t',
    cFileName: koffi.array('char16_t', 260, 'String'),
    cAlternateFileName: koffi.array('char16_t', 14, 'String'),
  })
  if (koffi.sizeof(findData) !== FIND_DATA_SIZE) {
    throw new Error(`SIQ_FIND_DATAW is ${koffi.sizeof(findData)} bytes, expected ${FIND_DATA_SIZE}`)
  }
  const findFirstFn = kernel32.func(
    'intptr_t __stdcall FindFirstFileExW(const char16_t *lpFileName, int fInfoLevelId, ' +
      '_Out_ SIQ_FIND_DATAW *lpFindFileData, int fSearchOp, void *lpSearchFilter, ' +
      'uint32_t dwAdditionalFlags)',
  )
  const findNext = kernel32.func(
    'int __stdcall FindNextFileW(intptr_t hFindFile, _Out_ SIQ_FIND_DATAW *lpFindFileData)',
  )
  const findClose = kernel32.func('int __stdcall FindClose(intptr_t hFindFile)')
  const getLastError = kernel32.func('uint32_t __stdcall GetLastError()')
  return {
    findFirst: findFirstFn,
    findNext,
    findClose,
    getLastError,
    findFirstFn,
  }
}

async function buildLister(): Promise<DirectoryLister> {
  const api = await loadApi()
  const { findFirst, findNext, findClose, getLastError, findFirstFn } = api

  const openAsync = (pattern: string, data: object): Promise<number | bigint> =>
    new Promise((resolve, reject) => {
      findFirstFn.async(
        pattern,
        FIND_EX_INFO_BASIC,
        data,
        FIND_EX_SEARCH_NAME_MATCH,
        null,
        FIND_FIRST_EX_LARGE_FETCH,
        (error: unknown, handle: number | bigint) => (error ? reject(error) : resolve(handle)),
      )
    })

  return {
    async list(dirPath): Promise<DirectoryListing> {
      const pattern = findPattern(dirPath)
      const data = emptyFindData()
      const handle = await openAsync(pattern, data)
      if (isInvalid(handle)) {
        // GetLastError is thread-local: repeat the (quick, failing) open on this thread.
        const retry = findFirst(
          pattern,
          FIND_EX_INFO_BASIC,
          data,
          FIND_EX_SEARCH_NAME_MATCH,
          null,
          FIND_FIRST_EX_LARGE_FETCH,
        )
        const error = Number(getLastError())
        if (!isInvalid(retry)) {
          // The folder became readable between the two opens: release the handle, report a
          // transient failure (the entries are not read twice).
          findClose(retry)
          return { entries: [], errorCode: 'EBUSY' }
        }
        return { entries: [], errorCode: win32ErrorToCode(error) }
      }
      const entries: ListedEntry[] = []
      let errorCode: string | null
      try {
        const first = toEntry(data)
        if (first !== null) entries.push(first)
        while (findNext(handle, data) !== 0) {
          const entry = toEntry(data)
          if (entry !== null) entries.push(entry)
        }
        errorCode = endOfListingError(Number(getLastError()))
      } finally {
        findClose(handle)
      }
      return { entries, errorCode }
    },
  }
}
